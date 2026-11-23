// File d'attente et commandes de lecture : sérialisation d'aléatoire /
// répétition, relance des requêtes, résultats périmés, pause sur 429.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

// Electron (importé par spotify-api) et le diagnostic sont simulés.
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Faux SpotifyApi : tout est configurable par test.
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
      await sleep(5);
      sp.calls.setShuffle.push(on);
    },
    setRepeat: async (mode) => {
      await sleep(5);
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

test('nextRepeat : cycle None -> List -> Track -> None', () => {
  assert.equal(queue.nextRepeat('None'), 'List');
  assert.equal(queue.nextRepeat('List'), 'Track');
  assert.equal(queue.nextRepeat('Track'), 'None');
  assert.equal(queue.nextRepeat(undefined), 'List');
});

test('mediaCommand : deux clics rapides sur aléatoire = deux bascules', async (t) => {
  const { spotify } = setup(t);
  await Promise.all([queue.mediaCommand('shuffle'), queue.mediaCommand('shuffle')]);
  assert.deepEqual(spotify.calls.setShuffle, [true, false]);
  assert.equal(S.playerState.shuffle, false);
});

test('mediaCommand : répétition enchaînée sur l’état à jour', async (t) => {
  const { spotify } = setup(t);
  await Promise.all([queue.mediaCommand('repeat'), queue.mediaCommand('repeat'), queue.mediaCommand('repeat')]);
  assert.deepEqual(spotify.calls.setRepeat, ['List', 'Track', 'None']);
});

test('mediaCommand : une commande en échec ne bloque pas les suivantes', async (t) => {
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

test('mediaCommand : lecture / suivant passent par Windows, sans Spotify', async (t) => {
  const { spotify } = setup(t);
  await queue.mediaCommand('next');
  assert.deepEqual(S.media.commands, ['next']);
  assert.equal(spotify.calls.player, 0);
});

test('mediaCommand : aléatoire sans compte connecté -> ignoré et noté', async (t) => {
  setup(t, fakeSpotify({ canControl: () => false }));
  await queue.mediaCommand('shuffle');
  assert.ok(notes.some((n) => n.includes('non connecté')));
});

test('mediaCommand : interdit par Spotify -> pas d’appel', async (t) => {
  const { spotify } = setup(
    t,
    fakeSpotify({ player: async () => ({ shuffle: false, repeat: 'None', shuffleAllowed: false }) }),
  );
  await queue.mediaCommand('shuffle');
  assert.equal(spotify.calls.setShuffle.length, 0);
});

test('refreshQueue : une demande pendant la requête relance à la fin', async (t) => {
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
  await queue.refreshQueue(); // arrive pendant la requête : marquée, pas perdue
  assert.equal(spotify.calls.queue, 1);
  release();
  await a;
  assert.equal(spotify.calls.queue, 2);
});

test('refreshQueue : résultat périmé (morceau changé) non publié, puis relance', async (t) => {
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
  S.lastMedia = { ...S.lastMedia, title: 'B' }; // le morceau change pendant la requête
  release();
  await p;
  const titles = sent.filter(([ch]) => ch === 'queue').map(([, q]) => q.items[0].title);
  assert.deepEqual(titles, ['Nouveau']);
  assert.equal(n, 2);
});

test('refreshQueue : session fermée pendant la requête -> rien publié', async (t) => {
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

test('refreshQueue : file identique à la précédente -> pas renvoyée', async (t) => {
  const { sent } = setup(t);
  await queue.refreshQueue();
  await queue.refreshQueue();
  assert.equal(sent.filter(([ch]) => ch === 'queue').length, 1);
});

test('refreshPlayer : 429 avec retryAfter -> plus de requête pendant la pause', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 5_000_000 });
  const { spotify } = setup(
    t,
    fakeSpotify({
      player: async () => {
        spotify.calls.player++;
        throw Object.assign(new Error('trop de requêtes'), { retryAfter: 30 });
      },
    }),
  );
  await queue.refreshPlayer();
  assert.equal(spotify.calls.player, 1);
  await queue.refreshPlayer();
  assert.equal(spotify.calls.player, 1);
  await queue.refreshQueue(); // la file respecte la même pause
  assert.equal(spotify.calls.queue, 0);
  t.mock.timers.tick(31_000);
  await queue.refreshPlayer();
  assert.equal(spotify.calls.player, 2);
  assert.ok(notes.some((n) => n.includes('trop de requêtes')));
});

test('refreshPlayer : backoff exponentiel sur erreurs (2 s, 4 s, ...)', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 5_000_000 });
  const { spotify } = setup(
    t,
    fakeSpotify({
      player: async () => {
        spotify.calls.player++;
        throw new Error('réseau');
      },
    }),
  );
  await queue.refreshPlayer();
  await queue.refreshPlayer(); // trop tôt
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

test('refreshPlayer : appels simultanés = une seule requête', async (t) => {
  const { spotify } = setup(t);
  await Promise.all([queue.refreshPlayer(), queue.refreshPlayer(), queue.refreshPlayer()]);
  assert.equal(spotify.calls.player, 1);
});
