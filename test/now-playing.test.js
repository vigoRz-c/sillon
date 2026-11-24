// Lyrics of the current track: duration updated after the title, new
// attempts after a network error. Simulated media source, lyrics and covers.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const { EventEmitter } = require('events');

const root = path.join(__dirname, '..', 'src', 'main');
const stub = (rel, exports) => {
  const file = path.join(root, rel);
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
const lookups = [];
let lookupImpl = async () => null;
class FakeSource extends EventEmitter {
  start() {}
  setVolumeTarget() {}
}
stub('media/media.js', { WindowsMediaSource: FakeSource });
stub('media/lyrics.js', {
  lookupLyrics: (m, opts) => {
    lookups.push({ duration: m.duration, volatile: !!(opts && opts.volatile) });
    return lookupImpl(m);
  },
});
stub('media/cover-lookup.js', { lookupCover: async () => null });
stub('app/diagnostic.js', { note: () => {} });
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return {};
  return realLoad.call(this, request, ...rest);
};
const S = require('../src/main/app/state');
const nowPlaying = require('../src/main/media/now-playing');
Module._load = realLoad;

const tick = () => new Promise((r) => setImmediate(r));
const track = (over) => ({
  active: true,
  app: 'Spotify.exe',
  title: 'A',
  artist: 'X',
  album: 'Y',
  status: 'Playing',
  ...over,
});

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  lookups.length = 0;
  lookupImpl = async () => null;
  const sent = [];
  S.settings = { get: () => ({}) };
  S.widget = { isDestroyed: () => false, webContents: { send: (ch, d) => sent.push([ch, d]) } };
  S.fullscreen = S.editorWin = S.controlsWin = null;
  S.actions.audioOnMedia = () => {};
  S.actions.buildTray = () => {};
  S.actions.refreshPlayer = () => {};
  S.actions.refreshQueue = () => {};
  nowPlaying.startMedia();
  const emit = (m) => S.media.emit('media', m);
  const lyrics = () => sent.filter(([ch]) => ch === 'lyrics').map(([, l]) => l);
  t.after(() => {
    S.widget = null;
    S.media = null;
  });
  return { emit, lyrics };
}

test('lyrics: the right track duration arrives after the title -> new search', async (t) => {
  const { emit } = setup(t);
  emit(track({ title: 'Précédent', duration: 200 }));
  await tick();
  lookups.length = 0;
  emit(track({ title: 'Nouveau', duration: 200 })); // duration of the previous track: suspicious
  emit(track({ title: 'Nouveau', duration: 201 })); // gap <= 2 s: no new search
  assert.deepEqual(lookups, [{ duration: 200, volatile: true }]);
  emit(track({ title: 'Nouveau', duration: 245 })); // the real duration
  assert.deepEqual(lookups[1], { duration: 245, volatile: false });
  emit(track({ title: 'Nouveau', duration: 245 }));
  assert.equal(lookups.length, 2);
});

test('lyrics: network error -> two new attempts (10 s then 20 s) then give up', async (t) => {
  const { emit, lyrics } = setup(t);
  lookupImpl = async () => ({ error: true });
  emit(track({ duration: 200 }));
  await tick();
  assert.equal(lookups.length, 1);
  t.mock.timers.tick(10000);
  await tick();
  assert.equal(lookups.length, 2);
  t.mock.timers.tick(20000);
  await tick();
  assert.equal(lookups.length, 3);
  t.mock.timers.tick(120000);
  await tick();
  assert.equal(lookups.length, 3);
  assert.ok(lyrics().at(-1).error);
});

test('lyrics: a successful attempt stops the new attempts', async (t) => {
  const { emit, lyrics } = setup(t);
  let n = 0;
  lookupImpl = async () => (++n === 1 ? { error: true } : { lines: [{ t: 1, end: 2, text: 'Salut', words: null }] });
  emit(track({ duration: 200 }));
  await tick();
  t.mock.timers.tick(10000);
  await tick();
  t.mock.timers.tick(60000);
  await tick();
  assert.equal(lookups.length, 2);
  assert.equal(lyrics().at(-1).lines[0].text, 'Salut');
});

test('lyrics: the track changes before the new attempt -> no new attempt for the old one', async (t) => {
  const { emit } = setup(t);
  lookupImpl = async () => ({ error: true });
  emit(track({ title: 'A', duration: 200 }));
  await tick();
  lookupImpl = async () => null;
  emit(track({ title: 'B', duration: 150 }));
  await tick();
  const before = lookups.length;
  t.mock.timers.tick(60000);
  await tick();
  assert.equal(lookups.length, before);
});
