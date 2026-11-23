// Vue des paroles (lyrics-view.js) : chargée dans un faux DOM minimal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Élément factice : juste ce que LyricsView utilise.
function makeEl() {
  const el = {
    children: [],
    parent: null,
    attrs: {},
    props: {},
    classes: new Set(),
    offsetHeight: 10,
    textContent: '',
    style: {
      setProperty(k, v) {
        el.props[k] = v;
      },
      removeProperty(k) {
        delete el.props[k];
      },
    },
    classList: {
      add: (...c) => c.forEach((x) => el.classes.add(x)),
      remove: (...c) => c.forEach((x) => el.classes.delete(x)),
      contains: (c) => el.classes.has(c),
    },
    appendChild(c) {
      c.parent = el;
      el.children.push(c);
      return c;
    },
    setAttribute(k, v) {
      el.attrs[k] = v;
    },
    remove() {
      if (el.parent) el.parent.children = el.parent.children.filter((c) => c !== el);
    },
    querySelectorAll(sel) {
      const want = sel.split('.').filter(Boolean);
      const out = [];
      const walk = (n) => {
        for (const c of n.children) {
          if (want.every((w) => c.classes.has(w))) out.push(c);
          walk(c);
        }
      };
      walk(el);
      return out;
    },
  };
  Object.defineProperty(el, 'className', {
    get: () => [...el.classes].join(' '),
    set(v) {
      el.classes = new Set(String(v).split(/\s+/).filter(Boolean));
    },
  });
  return el;
}

function load() {
  const window = {};
  const ctx = vm.createContext({
    window,
    document: { createElement: makeEl },
    getComputedStyle: () => ({ fontSize: '16px' }),
    setTimeout: () => 0, // les retraits différés ne servent pas ici
  });
  const file = path.join(__dirname, '../src/renderer/shared/lyrics-view.js');
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  return window.LyricsView;
}

const LyricsView = load();
const media = { active: true, title: 'T', artist: 'A' };
const lines = () => [
  {
    t: 0,
    end: 10,
    text: 'un deux trois quatre',
    words: [
      { text: 'un', t: 0 },
      { text: 'deux', t: 2 },
      { text: 'trois', t: 4 },
      { text: 'quatre', t: 6 },
    ],
  },
  { t: 20, end: 30, text: 'suite' },
];
const words = (v) => v.current._words;

test('retour en arrière dans la ligne : les mots déjà colorés sont réinitialisés', () => {
  const v = new LyricsView(makeEl());
  v.set({ title: 'T', artist: 'A', lines: lines() });
  v.update(media, 7);
  assert.ok(words(v)[0].classes.has('full'));
  assert.ok(words(v)[3].classes.has('on'));
  v.update(media, 1); // seek en arrière, même ligne
  const [w0, w1, w2, w3] = words(v);
  assert.ok(w0.classes.has('on') && !w0.classes.has('full'));
  for (const w of [w1, w2, w3]) {
    assert.ok(!w.classes.has('on') && !w.classes.has('full'));
    assert.equal(w._p, -1);
    assert.equal(w.props['--p'], undefined);
  }
});

test('retour en arrière au milieu d’un mot déjà complet : le mot se recolore partiellement', () => {
  const v = new LyricsView(makeEl());
  v.set({ title: 'T', artist: 'A', lines: lines() });
  v.update(media, 7);
  v.update(media, 2.7); // dans « deux » (2 à 4 s)
  const w1 = words(v)[1];
  assert.ok(!w1.classes.has('full'));
  assert.ok(w1._p > 0 && w1._p < 100);
});

test('mêmes paroles, nouveau décalage : la ligne n’est pas reconstruite', () => {
  const v = new LyricsView(makeEl());
  v.set({ title: 'T', artist: 'A', lines: lines(), offset: 0 });
  v.update(media, 5);
  const node = v.current;
  const count = v.el.children.length;
  v.set({ title: 'T', artist: 'A', lines: lines(), offset: 0.25 });
  v.update(media, 5);
  assert.equal(v.current, node);
  assert.equal(v.el.children.length, count);
  assert.equal(v.data.offset, 0.25);
});

test('paroles d’un autre morceau ou autres lignes : reconstruction normale', () => {
  const v = new LyricsView(makeEl());
  v.set({ title: 'T', artist: 'A', lines: lines() });
  v.update(media, 5);
  const node = v.current;
  const other = lines();
  other[0].text = 'autre';
  v.set({ title: 'T', artist: 'A', lines: other });
  v.update(media, 5);
  assert.notEqual(v.current, node);
  v.set({ title: 'U', artist: 'A', lines: lines() });
  assert.equal(v.index, -2);
});
