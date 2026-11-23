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
  const step = (msg, now) => { state = { ...msg, ...anchor(state, msg, now) }; return state; };
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
