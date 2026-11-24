// Queue and playback commands: serialization of shuffle /
// repeat, restarting requests, stale results, pause on 429.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

// Electron (imported by spotify-api) and the diagnostic are simulated.
const notes = [];
const diagPath = path.join(__dirname, '..', 'src', 'main', 'app', 'diagnostic.js');
require.cache[diagPath] = {
  id: diagPath,
  filename: diagPath,
  loaded: true,
  exports: { note: (kind, text) => notes.push(`${kind}: ${text}`) },
};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { app: { getPath: () => __dirname }, shell: {}, safeStorage: {} };
  return realLoad.call(this, request, ...rest);
};
const S = require('../src/main/app/state');
const queue = require('../src/main/media/queue');
Module._load = realLoad;

const tick = () => new Promise((r) => setImmediate(r));
// Asynchronous call that yields for a few turns (without a real clock):
// enough for two commands to overlap if nothing serializes them.
const yieldTurns = async (n = 3) => {
  for (let i = 0; i < n; i++) await tick();
};

// Fake SpotifyApi: everything is configurable per test.
function fakeSpotify(over = {}) {
  const sp = {
    calls: { player: 0, queue: 0, setShuffle: [], setRepeat: [], clearError: 0 },
    errors: [],
    connected: true,
    canControl: () => true,
    status: () => ({ connected: sp.connected, error: sp.errors.at(-1) || '' }),
    setError: (e) => sp.errors.push(e),
    clearError: () => sp.calls.clearError++,
    player: async () => {
      sp.calls.player++;
      return { shuffle: false, repeat: 'None', shuffleAllowed: true, repeatAllowed: true };
    },
    queue: async () => {
      sp.calls.queue++;
      return [{ title: 'Suivant', artist: 'X', image: null }];
    },
    setShuffle: async (on) => {
      await yieldTurns();
      sp.calls.setShuffle.push(on);
    },
    setRepeat: async (mode) => {
      await yieldTurns();
      sp.calls.setRepeat.push(mode);
    },
    ...over,
  };
  return sp;
}

function setup(t, spotify = fakeSpotify()) {
  queue.resetForTests();
  notes.length = 0;
  const sent = [];
  const rebroadcasts = [];
  S.spotify = spotify;
  S.playerState = null;
  S.lastQueue = { items: [], connected: false };
  S.lastMedia = { active: true, app: 'Spotify.exe', title: 'A', artist: 'X', album: 'Y', status: 'Playing' };
  S.actions.rebroadcast = () => rebroadcasts.push(S.playerState);
  S.widget = { isDestroyed: () => false, webContents: { send: (ch, d) => sent.push([ch, d]) } };
  S.editorWin = null;
  S.media = {
    commands: [],
    command(c) {
      this.commands.push(c);
    },
  };
  t.after(() => {
    S.spotify = null;
    S.widget = null;
    S.media = null;
  });
  return { spotify, sent, rebroadcasts };
}

test('nextRepeat: cycle None -> List -> Track -> None', () => {
  assert.equal(queue.nextRepeat('None'), 'List');
  assert.equal(queue.nextRepeat('List'), 'Track');
  assert.equal(queue.nextRepeat('Track'), 'None');
  assert.equal(queue.nextRepeat(undefined), 'List');
});

test('mediaCommand: two quick clicks on shuffle = two toggles', async (t) => {
  const { spotify } = setup(t);
  await Promise.all([queue.mediaCommand('shuffle'), queue.mediaCommand('shuffle')]);
  assert.deepEqual(spotify.calls.setShuffle, [true, false]);
  assert.equal(S.playerState.shuffle, false);
});

test('mediaCommand: repeat chained on the up-to-date state', async (t) => {
  const { spotify } = setup(t);
  await Promise.all([queue.mediaCommand('repeat'), queue.mediaCommand('repeat'), queue.mediaCommand('repeat')]);
  assert.deepEqual(spotify.calls.setRepeat, ['List', 'Track', 'None']);
});

test('mediaCommand: a failing command does not block the next ones', async (t) => {
  let fail = true;
  const { spotify } = setup(
    t,
    fakeSpotify({
      setShuffle: async (on) => {
        if (fail) throw new Error('boum');
        spotify.calls.setShuffle.push(on);
      },
    }),
  );
  await queue.mediaCommand('shuffle');
  fail = false;
  await queue.mediaCommand('shuffle');
  assert.equal(spotify.calls.setShuffle.length, 1);
  assert.ok(notes.some((n) => n.includes('boum')));
});

test('mediaCommand: play / next go through Windows, without Spotify', async (t) => {
  const { spotify } = setup(t);
  await queue.mediaCommand('next');
  assert.deepEqual(S.media.commands, ['next']);
  assert.equal(spotify.calls.player, 0);
});

test('mediaCommand: shuffle without a connected account -> ignored and noted', async (t) => {
  setup(t, fakeSpotify({ canControl: () => false }));
  await queue.mediaCommand('shuffle');
  assert.ok(notes.some((n) => n.includes('not connected')));
});

test('mediaCommand: forbidden by Spotify -> no call', async (t) => {
  const { spotify } = setup(
    t,
    fakeSpotify({ player: async () => ({ shuffle: false, repeat: 'None', shuffleAllowed: false }) }),
  );
  await queue.mediaCommand('shuffle');
  assert.equal(spotify.calls.setShuffle.length, 0);
});

test('refreshQueue: a request during the query restarts at the end', async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  let first = true;
  const { spotify } = setup(
    t,
    fakeSpotify({
      queue: async function () {
        spotify.calls.queue++;
        if (first) {
          first = false;
          await gate;
        }
        return [];
      },
    }),
  );
  const a = queue.refreshQueue();
  await tick();
  await queue.refreshQueue(); // arrives during the query: marked, not lost
  assert.equal(spotify.calls.queue, 1);
  release();
  await a;
  assert.equal(spotify.calls.queue, 2);
});

test('refreshQueue: stale result (track changed) not published, then restart', async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  let n = 0;
  const { sent } = setup(
    t,
    fakeSpotify({
      queue: async () => {
        n++;
        if (n === 1) {
          await gate;
          return [{ title: 'Ancien', artist: 'X', image: null }];
        }
        return [{ title: 'Nouveau', artist: 'X', image: null }];
      },
    }),
  );
  const p = queue.refreshQueue();
  await tick();
  S.lastMedia = { ...S.lastMedia, title: 'B' }; // the track changes during the query
  release();
  await p;
  const titles = sent.filter(([ch]) => ch === 'queue').map(([, q]) => q.items[0].title);
  assert.deepEqual(titles, ['Nouveau']);
  assert.equal(n, 2);
});

test('refreshQueue: session closed during the query -> nothing published', async (t) => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { spotify, sent } = setup(
    t,
    fakeSpotify({
      queue: async () => {
        await gate;
        return [{ title: 'Ancien', artist: 'X', image: null }];
      },
    }),
  );
  const p = queue.refreshQueue();
  await tick();
  spotify.connected = false;
  release();
  await p;
  assert.ok(!sent.some(([ch, q]) => ch === 'queue' && q.items.length));
});

test('refreshQueue: same queue as before -> not sent again', async (t) => {
  const { sent } = setup(t);
  await queue.refreshQueue();
  await queue.refreshQueue();
  assert.equal(sent.filter(([ch]) => ch === 'queue').length, 1);
});

test('refreshPlayer: 429 with retryAfter -> no more requests during the pause', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 5_000_000 });
  const { spotify } = setup(
    t,
    fakeSpotify({
      player: async () => {
        spotify.calls.player++;
        throw Object.assign(new Error('too many requests'), { retryAfter: 30 });
      },
    }),
  );
  await queue.refreshPlayer();
  assert.equal(spotify.calls.player, 1);
  await queue.refreshPlayer();
  assert.equal(spotify.calls.player, 1);
  await queue.refreshQueue(); // the queue respects the same pause
  assert.equal(spotify.calls.queue, 0);
  t.mock.timers.tick(31_000);
  await queue.refreshPlayer();
  assert.equal(spotify.calls.player, 2);
  assert.ok(notes.some((n) => n.includes('too many requests')));
});

test('refreshPlayer: exponential backoff on errors (2 s, 4 s, ...)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 5_000_000 });
  const { spotify } = setup(
    t,
    fakeSpotify({
      player: async () => {
        spotify.calls.player++;
        throw new Error('network');
      },
    }),
  );
  await queue.refreshPlayer();
  await queue.refreshPlayer(); // too early
  assert.equal(spotify.calls.player, 1);
  t.mock.timers.tick(2000);
  await queue.refreshPlayer();
  assert.equal(spotify.calls.player, 2);
  t.mock.timers.tick(3999);
  await queue.refreshPlayer();
  assert.equal(spotify.calls.player, 2);
  t.mock.timers.tick(1);
  await queue.refreshPlayer();
  assert.equal(spotify.calls.player, 3);
  assert.equal(S.playerState, null);
});

test('refreshPlayer: simultaneous calls = a single request', async (t) => {
  const { spotify } = setup(t);
  await Promise.all([queue.refreshPlayer(), queue.refreshPlayer(), queue.refreshPlayer()]);
  assert.equal(spotify.calls.player, 1);
});

test('refreshQueue: token unavailable (queue = null) -> error not cleared, queue kept', async (t) => {
  const { spotify, sent } = setup(t, fakeSpotify({ queue: async () => null }));
  S.lastQueue = { items: [{ title: 'Ancien', artist: 'X', image: null }], connected: true };
  await queue.refreshQueue();
  assert.equal(spotify.calls.clearError, 0);
  assert.ok(!sent.some(([ch]) => ch === 'queue'));
  assert.equal(S.lastQueue.items.length, 1);
});

test('refreshQueue: real success -> error cleared', async (t) => {
  const { spotify } = setup(t);
  spotify.errors.push('ancienne erreur');
  await queue.refreshQueue();
  assert.equal(spotify.calls.clearError, 1);
});

test('mediaCommand: playpause becomes play (paused) or pause (playing)', async (t) => {
  setup(t);
  S.lastMedia = { ...S.lastMedia, status: 'Paused' };
  await queue.mediaCommand('playpause');
  S.lastMedia = { ...S.lastMedia, status: 'Playing' };
  await queue.mediaCommand('playpause');
  S.lastMedia = { active: false, status: 'Stopped' };
  await queue.mediaCommand('playpause');
  assert.deepEqual(S.media.commands, ['play', 'pause', 'play']);
});

test('mediaCommand: play ignored by Spotify -> Spotify API on the computer', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const played = [];
  setup(
    t,
    fakeSpotify({
      playbackDevice: async () => ({ id: 'pc', active: false }),
      play: async (id) => played.push(id),
    }),
  );
  S.lastMedia = { ...S.lastMedia, status: 'Paused' };
  await queue.mediaCommand('playpause');
  t.mock.timers.tick(1500); // still paused: restart through the API
  for (let i = 0; i < 5; i++) await tick(); // lets the chain finish
  assert.deepEqual(played, ['pc']);
  assert.ok(notes.some((n) => n.includes('Spotify API')));
});

test('mediaCommand: successful play (playback resumed) or other player -> no API call', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const played = [];
  setup(t, fakeSpotify({ playbackDevice: async () => null, play: async (id) => played.push(id) }));
  S.lastMedia = { ...S.lastMedia, status: 'Paused' };
  await queue.mediaCommand('play');
  S.lastMedia = { ...S.lastMedia, status: 'Playing' }; // Windows a bien repris
  t.mock.timers.tick(1500);
  S.lastMedia = { ...S.lastMedia, app: 'Chrome', status: 'Paused' };
  await queue.mediaCommand('play');
  t.mock.timers.tick(1500); // browser: no Spotify
  for (let i = 0; i < 5; i++) await tick();
  assert.deepEqual(played, []);
});
