// Playback position (lyrics sync): anchoring robust to Spotify's
// stale measures.
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

test('fresh measure: extrapolated from its time', () => {
  const [p] = run([[{ ...base, newTrack: true, status: 'Playing', position: 94, updated: T - 1960 }, T]]);
  near(p, 95.96, 0.01);
});

test('resume after a pause with a stale time: no jump forward', () => {
  const r = run([
    [{ ...base, newTrack: true, status: 'Playing', position: 90, updated: T }, T],
    [{ ...base, status: 'Paused', position: 100, updated: T + 10000 }, T + 10000],
    // 60 s later, Spotify announces "playing" with the time of the pause.
    [{ ...base, status: 'Playing', position: 100, updated: T + 10000 }, T + 70000],
  ]);
  near(r[2], 100);
});

test('"playing" measure older than 6 s: raw position', () => {
  const [p] = run([[{ ...base, newTrack: true, status: 'Playing', position: 50, updated: T - 30000 }, T]]);
  near(p, 50, 0.01);
});

test("small gaps (Spotify's rounding): anchor kept, no jitter", () => {
  let state = {};
  const step = (msg, now) => {
    state = { ...msg, ...anchor(state, msg, now) };
    return state;
  };
  step({ ...base, newTrack: true, status: 'Playing', position: 10, updated: T }, T);
  const first = state.anchorAt;
  step({ ...base, status: 'Playing', position: 14.5, updated: T + 4300 }, T + 4300); // gap 0.2 s
  assert.equal(state.anchorAt, first);
});

test('jump within the track and new track: the new position is followed', () => {
  const r = run([
    [{ ...base, newTrack: true, status: 'Playing', position: 10, updated: T }, T],
    [{ ...base, status: 'Playing', position: 150, updated: T + 2000 }, T + 2000],
    [{ ...base, newTrack: true, title: 'B', status: 'Playing', position: 0, updated: T + 3000 }, T + 3300],
  ]);
  near(r[1], 150);
  near(r[2], 0.3, 0.01);
});

test('inactive: raw position, anchored at now', () => {
  const a = anchor({}, { active: false }, T);
  assert.deepEqual(a, { anchorPos: 0, anchorAt: T });
  const b = anchor({}, { ...base, active: false, status: 'Playing', position: 12 }, T);
  assert.deepEqual(b, { anchorPos: 12, anchorAt: T });
});

test('updated at 0 (unknown): raw position, no extrapolation', () => {
  const [p] = run([[{ ...base, newTrack: true, status: 'Playing', position: 42, updated: 0 }, T]]);
  near(p, 42, 0.01);
});

test('same measure repeated during playback: the anchor does not go back', () => {
  let state = {};
  const step = (msg, now) => {
    state = { ...msg, ...anchor(state, msg, now) };
    return state;
  };
  step({ ...base, newTrack: true, status: 'Playing', position: 10, updated: T }, T);
  const first = { pos: state.anchorPos, at: state.anchorAt };
  // 3 s later, Spotify sends the same measure again (position 10, same time):
  // without a guard, the estimate (10 + 6 s fresh) would move forward or back.
  step({ ...base, status: 'Playing', position: 10, updated: T }, T + 20000);
  assert.deepEqual({ pos: state.anchorPos, at: state.anchorAt }, first);
});

test('new track with the same time: the anchor is not kept', () => {
  let state = {};
  const step = (msg, now) => {
    state = { ...msg, ...anchor(state, msg, now) };
    return state;
  };
  step({ ...base, newTrack: true, status: 'Playing', position: 10, updated: T }, T);
  step({ ...base, newTrack: true, title: 'B', status: 'Playing', position: 0, updated: T }, T + 500);
  assert.equal(state.anchorAt, T + 500);
});

// ---- currentPosition (interface side): engine.js loaded in an empty context ----
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadEngine() {
  const window = { SillonCatalog: require('../src/renderer/shared/catalog.js') };
  const ctx = vm.createContext({ window, console });
  for (const f of ['audio-engine', 'colors', 'visualizers', 'engine']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, `../src/renderer/shared/${f}.js`), 'utf8'), ctx);
  }
  return window.SV;
}
const { currentPosition } = loadEngine();

test('currentPosition: player without a known duration, the position still moves', () => {
  const m = { active: true, status: 'Paused', position: 42, duration: 0 };
  near(currentPosition(m), 42, 0.001);
  const playing = { active: true, status: 'Playing', anchorPos: 10, anchorAt: Date.now() - 3000, duration: 0 };
  near(currentPosition(playing), 13, 0.2);
});

test('currentPosition: inactive → 0; capped by the duration when it is known', () => {
  assert.equal(currentPosition({ active: false, position: 9, duration: 100 }), 0);
  assert.equal(currentPosition(null), 0);
  assert.equal(currentPosition({ active: true, status: 'Paused', position: 500, duration: 100 }), 100);
  assert.equal(currentPosition({ active: true, status: 'Paused', position: -5, duration: 100 }), 0);
});
