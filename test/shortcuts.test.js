// Raccourcis clavier globaux : enregistrement, combinaisons prises, libération
// (src/main/app/shortcuts.js) et choix des touches (src/renderer/shared/shortcuts.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createShortcuts } = require('../src/main/app/shortcuts');
const { SHORTCUTS, BY_ID } = require('../src/renderer/shared/shortcuts');

// Faux globalShortcut : `taken` liste les combinaisons déjà prises ailleurs.
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

test('touches : uniques, Ctrl+Alt, jamais une touche AltGr ou système', () => {
  const accs = SHORTCUTS.map((s) => s.accelerator);
  assert.equal(new Set(accs).size, accs.length, 'combinaison en double');
  assert.equal(new Set(SHORTCUTS.map((s) => s.id)).size, SHORTCUTS.length, 'identifiant en double');
  for (const s of SHORTCUTS) {
    const key = s.accelerator.replace('CommandOrControl+Alt+', '');
    assert.ok(s.accelerator.startsWith('CommandOrControl+Alt+'), s.id);
    // Lettre, sauf E, Q, M qui tapent € @ µ avec AltGr (ni Espace, souvent pris ailleurs).
    assert.match(key, /^[A-DF-LNOPR-Z]$/, `${s.id} : ${key}`);
    assert.ok(s.label && s.display.startsWith('Ctrl+Alt+'), s.id);
  }
  assert.equal(BY_ID.fullscreen.display, 'Ctrl+Alt+F');
  assert.equal(BY_ID.veille.display, 'Ctrl+Alt+L');
  assert.equal(BY_ID.playpause.display, 'Ctrl+Alt+P');
});

test('apply(true) enregistre tout, le raccourci appelle son action', () => {
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

test('combinaison déjà prise : signalée une fois, les autres marchent, nouvel essai possible', () => {
  const g = fakeGlobal([BY_ID.playpause.accelerator]);
  const notes = [];
  const sc = createShortcuts({ globalShortcut: g, actions: allActions(), note: (m) => notes.push(m) });
  sc.apply(true);
  assert.equal(g.map.size, SHORTCUTS.length - 1);
  assert.equal(sc.status().items.find((i) => i.id === 'playpause').state, 'taken');
  assert.equal(sc.acceleratorOf('playpause'), undefined);
  sc.status({ retry: true }); // toujours prise : pas de seconde note
  assert.equal(notes.length, 1);
  assert.ok(notes[0].startsWith('Ctrl+Alt+P '), notes[0]);
  g.taken.clear(); // l'autre application l'a libérée
  assert.equal(sc.status({ retry: true }).items.find((i) => i.id === 'playpause').state, 'ok');
});

test('register qui lève une exception : traité comme une combinaison prise', () => {
  const g = fakeGlobal();
  g.register = () => {
    throw new Error('accélérateur invalide');
  };
  const sc = createShortcuts({ globalShortcut: g, actions: allActions() });
  assert.doesNotThrow(() => sc.apply(true));
  assert.ok(sc.status().items.every((i) => i.state === 'taken'));
});

test('apply(false) et unregisterAll libèrent ce qui a été pris', () => {
  const g = fakeGlobal();
  const sc = createShortcuts({ globalShortcut: g, actions: allActions() });
  sc.apply(true);
  sc.apply(false);
  assert.equal(g.map.size, 0);
  const st = sc.status({ retry: true }); // désactivés : pas de nouvel essai
  assert.equal(st.enabled, false);
  assert.ok(st.items.every((i) => i.state === 'off'));
  assert.equal(g.map.size, 0);
  sc.apply(true);
  sc.apply(true); // deux fois de suite : pas de double enregistrement
  assert.equal(g.map.size, SHORTCUTS.length);
  sc.unregisterAll();
  assert.equal(g.map.size, 0);
});

test('action qui échoue : erreur notée, rien ne remonte', () => {
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

test('raccourci sans action : pas enregistré', () => {
  const g = fakeGlobal();
  const sc = createShortcuts({ globalShortcut: g, actions: { next: () => {} } });
  sc.apply(true);
  assert.deepEqual([...g.map.keys()], [BY_ID.next.accelerator]);
});
