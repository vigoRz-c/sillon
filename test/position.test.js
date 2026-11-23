// Position de lecture (synchronisation des paroles) : ancrage robuste aux
// mesures périmées de Spotify.
const test = require('node:test');
const assert = require('node:assert/strict');
const { anchor } = require('../src/main/media/media');

const T = 1_000_000;
const base = { active: true, title: 'A', artist: 'X' };
const estimate = (s, now) => s.anchorPos + (s.status === 'Playing' ? (now - s.anchorAt) / 1000 : 0);

function run(steps) {
  let state = {};
  return steps.map(([msg, now]) => {
    state = { ...msg, ...anchor(state, msg, now) };
    return estimate(state, now);
  });
}

const near = (a, b, tol = 0.4) => assert.ok(Math.abs(a - b) < tol, `${a} ≉ ${b}`);

test('mesure fraîche : extrapolée depuis son heure', () => {
  const [p] = run([[{ ...base, newTrack: true, status: 'Playing', position: 94, updated: T - 1960 }, T]]);
  near(p, 95.96, 0.01);
});

test('reprise après une pause avec une heure périmée : pas de bond en avant', () => {
  const r = run([
    [{ ...base, newTrack: true, status: 'Playing', position: 90, updated: T }, T],
    [{ ...base, status: 'Paused', position: 100, updated: T + 10000 }, T + 10000],
    // 60 s plus tard, Spotify annonce « en lecture » avec l'heure de la pause.
    [{ ...base, status: 'Playing', position: 100, updated: T + 10000 }, T + 70000],
  ]);
  near(r[2], 100);
});

test('mesure "en lecture" vieille de plus de 6 s : position brute', () => {
  const [p] = run([[{ ...base, newTrack: true, status: 'Playing', position: 50, updated: T - 30000 }, T]]);
  near(p, 50, 0.01);
});

test('petits écarts (arrondi de Spotify) : ancrage conservé, pas de sautillement', () => {
  let state = {};
  const step = (msg, now) => {
    state = { ...msg, ...anchor(state, msg, now) };
    return state;
  };
  step({ ...base, newTrack: true, status: 'Playing', position: 10, updated: T }, T);
  const first = state.anchorAt;
  step({ ...base, status: 'Playing', position: 14.5, updated: T + 4300 }, T + 4300); // écart 0,2 s
  assert.equal(state.anchorAt, first);
});

test('saut dans le morceau et nouveau morceau : on suit la nouvelle position', () => {
  const r = run([
    [{ ...base, newTrack: true, status: 'Playing', position: 10, updated: T }, T],
    [{ ...base, status: 'Playing', position: 150, updated: T + 2000 }, T + 2000],
    [{ ...base, newTrack: true, title: 'B', status: 'Playing', position: 0, updated: T + 3000 }, T + 3300],
  ]);
  near(r[1], 150);
  near(r[2], 0.3, 0.01);
});

test('inactif : position brute, ancrage à maintenant', () => {
  const a = anchor({}, { active: false }, T);
  assert.deepEqual(a, { anchorPos: 0, anchorAt: T });
  const b = anchor({}, { ...base, active: false, status: 'Playing', position: 12 }, T);
  assert.deepEqual(b, { anchorPos: 12, anchorAt: T });
});

test('updated à 0 (inconnu) : position brute, pas d’extrapolation', () => {
  const [p] = run([[{ ...base, newTrack: true, status: 'Playing', position: 42, updated: 0 }, T]]);
  near(p, 42, 0.01);
});

test('même mesure répétée en cours de lecture : l’ancrage ne recule pas', () => {
  let state = {};
  const step = (msg, now) => {
    state = { ...msg, ...anchor(state, msg, now) };
    return state;
  };
  step({ ...base, newTrack: true, status: 'Playing', position: 10, updated: T }, T);
  const first = { pos: state.anchorPos, at: state.anchorAt };
  // 3 s plus tard, Spotify renvoie la même mesure (position 10, même heure) :
  // sans garde, l'estimation (10 + 6 s fraîche) ferait avancer ou reculer.
  step({ ...base, status: 'Playing', position: 10, updated: T }, T + 20000);
  assert.deepEqual({ pos: state.anchorPos, at: state.anchorAt }, first);
});

test('nouveau morceau avec la même heure : on ne garde pas l’ancrage', () => {
  let state = {};
  const step = (msg, now) => {
    state = { ...msg, ...anchor(state, msg, now) };
    return state;
  };
  step({ ...base, newTrack: true, status: 'Playing', position: 10, updated: T }, T);
  step({ ...base, newTrack: true, title: 'B', status: 'Playing', position: 0, updated: T }, T + 500);
  assert.equal(state.anchorAt, T + 500);
});

// ---- currentPosition (côté interface) : engine.js chargé dans un contexte vide ----
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadEngine() {
  const window = { SillonCatalog: require('../src/renderer/shared/catalog.js') };
  const ctx = vm.createContext({ window, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/shared/engine.js'), 'utf8'), ctx);
  return window.SV;
}
const { currentPosition } = loadEngine();

test('currentPosition : lecteur sans durée connue, la position avance quand même', () => {
  const m = { active: true, status: 'Paused', position: 42, duration: 0 };
  near(currentPosition(m), 42, 0.001);
  const playing = { active: true, status: 'Playing', anchorPos: 10, anchorAt: Date.now() - 3000, duration: 0 };
  near(currentPosition(playing), 13, 0.2);
});

test('currentPosition : inactif → 0 ; plafonnée par la durée quand elle est connue', () => {
  assert.equal(currentPosition({ active: false, position: 9, duration: 100 }), 0);
  assert.equal(currentPosition(null), 0);
  assert.equal(currentPosition({ active: true, status: 'Paused', position: 500, duration: 100 }), 100);
  assert.equal(currentPosition({ active: true, status: 'Paused', position: -5, duration: 100 }), 0);
});
