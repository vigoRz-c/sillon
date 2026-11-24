// Global keyboard shortcuts: registration, taken combinations, release
// (src/main/app/shortcuts.js) and choice of keys (src/renderer/shared/shortcuts.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createShortcuts } = require('../src/main/app/shortcuts');
const { SHORTCUTS, BY_ID } = require('../src/renderer/shared/shortcuts');

// Fake globalShortcut: `taken` lists the combinations already taken elsewhere.
function fakeGlobal(taken = []) {
  const map = new Map();
  return {
    map,
    taken: new Set(taken),
    register(acc, fn) {
      if (this.taken.has(acc) || map.has(acc)) return false;
      map.set(acc, fn);
      return true;
    },
    unregister(acc) {
      map.delete(acc);
    },
  };
}
const allActions = (calls = []) => Object.fromEntries(SHORTCUTS.map((s) => [s.id, () => calls.push(s.id)]));

test('keys: unique, Ctrl+Alt, never an AltGr or system key', () => {
  const accs = SHORTCUTS.map((s) => s.accelerator);
  assert.equal(new Set(accs).size, accs.length, 'combinaison en double');
  assert.equal(new Set(SHORTCUTS.map((s) => s.id)).size, SHORTCUTS.length, 'identifiant en double');
  for (const s of SHORTCUTS) {
    const key = s.accelerator.replace('CommandOrControl+Alt+', '');
    assert.ok(s.accelerator.startsWith('CommandOrControl+Alt+'), s.id);
    // Letter, except E, Q, M which type € @ µ with AltGr (nor Space, often taken elsewhere).
    assert.match(key, /^[A-DF-LNOPR-Z]$/, `${s.id} : ${key}`);
    assert.ok(s.label && s.display.startsWith('Ctrl+Alt+'), s.id);
  }
  assert.equal(BY_ID.fullscreen.display, 'Ctrl+Alt+F');
  assert.equal(BY_ID.veille.display, 'Ctrl+Alt+L');
  assert.equal(BY_ID.playpause.display, 'Ctrl+Alt+P');
});

test('apply(true) registers everything, the shortcut calls its action', () => {
  const g = fakeGlobal();
  const calls = [];
  const sc = createShortcuts({ globalShortcut: g, actions: allActions(calls) });
  sc.apply(true);
  assert.equal(g.map.size, SHORTCUTS.length);
  g.map.get(BY_ID.next.accelerator)();
  assert.deepEqual(calls, ['next']);
  const st = sc.status();
  assert.equal(st.enabled, true);
  assert.ok(st.items.every((i) => i.state === 'ok'));
  assert.equal(sc.acceleratorOf('next'), BY_ID.next.accelerator);
});

test('combination already taken: reported once, the others work, new attempt possible', () => {
  const g = fakeGlobal([BY_ID.playpause.accelerator]);
  const notes = [];
  const sc = createShortcuts({ globalShortcut: g, actions: allActions(), note: (m) => notes.push(m) });
  sc.apply(true);
  assert.equal(g.map.size, SHORTCUTS.length - 1);
  assert.equal(sc.status().items.find((i) => i.id === 'playpause').state, 'taken');
  assert.equal(sc.acceleratorOf('playpause'), undefined);
  sc.status({ retry: true }); // still taken: no second note
  assert.equal(notes.length, 1);
  assert.ok(notes[0].startsWith('Ctrl+Alt+P '), notes[0]);
  g.taken.clear(); // the other application freed it
  assert.equal(sc.status({ retry: true }).items.find((i) => i.id === 'playpause').state, 'ok');
});

test('register that throws: handled as a taken combination', () => {
  const g = fakeGlobal();
  g.register = () => {
    throw new Error('invalid accelerator');
  };
  const sc = createShortcuts({ globalShortcut: g, actions: allActions() });
  assert.doesNotThrow(() => sc.apply(true));
  assert.ok(sc.status().items.every((i) => i.state === 'taken'));
});

test('apply(false) and unregisterAll free what was taken', () => {
  const g = fakeGlobal();
  const sc = createShortcuts({ globalShortcut: g, actions: allActions() });
  sc.apply(true);
  sc.apply(false);
  assert.equal(g.map.size, 0);
  const st = sc.status({ retry: true }); // off: no new attempt
  assert.equal(st.enabled, false);
  assert.ok(st.items.every((i) => i.state === 'off'));
  assert.equal(g.map.size, 0);
  sc.apply(true);
  sc.apply(true); // twice in a row: no double registration
  assert.equal(g.map.size, SHORTCUTS.length);
  sc.unregisterAll();
  assert.equal(g.map.size, 0);
});

test('failing action: error noted, nothing goes up', () => {
  const g = fakeGlobal();
  const notes = [];
  const actions = allActions();
  actions.settings = () => {
    throw new Error('boum');
  };
  const sc = createShortcuts({ globalShortcut: g, actions, note: (m) => notes.push(m) });
  sc.apply(true);
  const errors = console.error;
  console.error = () => {};
  try {
    assert.doesNotThrow(() => g.map.get(BY_ID.settings.accelerator)());
  } finally {
    console.error = errors;
  }
  assert.match(notes.at(-1), /boum/);
});

test('shortcut without an action: not registered', () => {
  const g = fakeGlobal();
  const sc = createShortcuts({ globalShortcut: g, actions: { next: () => {} } });
  sc.apply(true);
  assert.deepEqual([...g.map.keys()], [BY_ID.next.accelerator]);
});
