// SpotifyApi : jetons (rafraîchissement unique, persistance, déconnexion),
// codes de réponse de l'API, serveur de retour OAuth. Electron et le réseau
// sont simulés.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { mock } = require('node:test');

const CLIENT_ID = 'a'.repeat(32);
const state = { dir: null, encryption: true, openedUrls: [], encryptGate: null };

const fakeElectron = {
  app: { getPath: () => state.dir },
  shell: { openExternal: (u) => state.openedUrls.push(u) },
  safeStorage: {
    isAsyncEncryptionAvailable: async () => state.encryption,
    encryptStringAsync: async (s) => {
      if (state.encryptGate) await state.encryptGate;
      return Buffer.from(`enc:${s}`);
    },
    decryptStringAsync: async (buf) => {
      const t = buf.toString('utf8');
      if (!t.startsWith('enc:')) throw new Error('déchiffrement impossible');
      return { result: t.slice(4), shouldReEncrypt: false };
    },
  },
};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === 'electron' ? fakeElectron : realLoad.call(this, request, ...rest);
};
const { SpotifyApi } = require('../src/main/media/spotify-api');
Module._load = realLoad;

const json = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (h) => headers[h.toLowerCase()] ?? null },
  json: async () => body,
});

// Routeur réseau : { api: (url, n) => res, token: (n) => res } avec compteurs.
function net({ api, token }) {
  const c = { api: 0, token: 0 };
  const m = mock.method(global, 'fetch', async (url) => {
    if (String(url).includes('/api/token')) return token(++c.token);
    return api(String(url), ++c.api);
  });
  return { c, restore: () => m.mock.restore() };
}

const goodToken = (n = 1) =>
  json({ access_token: `acc${n}`, refresh_token: `ref${n}`, expires_in: 3600, scope: 'user-modify-playback-state' });

async function makeApi(t, tokens) {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sillon-spotify-'));
  state.encryption = true;
  state.encryptGate = null;
  state.openedUrls = [];
  t.after(() => {
    mock.restoreAll();
    fs.rmSync(state.dir, { recursive: true, force: true });
  });
  t.mock.method(console, 'error', () => {});
  const api = new SpotifyApi(() => ({ custom: true, clientId: CLIENT_ID }));
  await api.ready;
  if (tokens) api.tokens = { clientId: CLIENT_ID, scope: 'user-modify-playback-state', ...tokens };
  return api;
}
const fresh = { access: 'acc0', refresh: 'ref0', expiresAt: Date.now() + 3600_000 };
const expired = { access: 'old', refresh: 'ref0', expiresAt: 0 };

test('204 -> null, 200 -> JSON', async (t) => {
  const api = await makeApi(t, fresh);
  let status = 204;
  const n = net({ api: () => (status === 204 ? json(null, 204) : json({ ok: 1 })), token: goodToken });
  assert.equal(await api.get('/me/player'), null);
  status = 200;
  assert.deepEqual(await api.get('/me/player'), { ok: 1 });
  n.restore();
});

test('401 : un seul nouvel essai après rafraîchissement', async (t) => {
  const api = await makeApi(t, fresh);
  const n = net({ api: () => json({}, 401), token: goodToken });
  await assert.rejects(api.get('/me/player'), /Spotify 401/);
  assert.equal(n.c.api, 2);
  assert.equal(n.c.token, 1);
  n.restore();
});

test('401 puis 200 : la requête réussit au second essai', async (t) => {
  const api = await makeApi(t, fresh);
  const n = net({ api: (u, i) => (i === 1 ? json({}, 401) : json({ ok: 1 })), token: goodToken });
  assert.deepEqual(await api.get('/me/player'), { ok: 1 });
  assert.equal(n.c.api, 2);
  n.restore();
});

test('429 : retryAfter transmis (30 s par défaut)', async (t) => {
  const api = await makeApi(t, fresh);
  let headers = { 'retry-after': '12' };
  const n = net({ api: () => json({}, 429, headers), token: goodToken });
  await assert.rejects(api.get('/x'), (e) => e.retryAfter === 12);
  headers = {};
  await assert.rejects(api.get('/x'), (e) => e.retryAfter === 30);
  n.restore();
});

test('403 : message explicite, avec la raison de Spotify', async (t) => {
  const api = await makeApi(t, fresh);
  const n = net({ api: () => json({ error: { reason: 'PREMIUM_REQUIRED' } }, 403), token: goodToken });
  await assert.rejects(api.get('/x'), /PREMIUM_REQUIRED/);
  n.restore();
});

test('rafraîchissement concurrent : une seule requête de jeton', async (t) => {
  const api = await makeApi(t, expired);
  const n = net({ api: () => json({ ok: 1 }), token: goodToken });
  const r = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')]);
  assert.equal(r.length, 3);
  assert.equal(n.c.token, 1);
  assert.equal(api.refreshing, null);
  assert.equal(api.tokens.refresh, 'ref1');
  n.restore();
});

test('invalid_grant au rafraîchissement : déconnexion et message', async (t) => {
  const api = await makeApi(t, expired);
  const n = net({ api: () => json({}), token: () => json({ error: 'invalid_grant' }, 400) });
  assert.equal(await api.get('/a'), null);
  assert.equal(api.tokens, null);
  assert.match(api.status().error, /invalid_grant/);
  n.restore();
});

test('save : jetons chiffrés sur disque, relus au démarrage', async (t) => {
  const api = await makeApi(t);
  await api.save({ ...fresh, clientId: CLIENT_ID });
  assert.equal(fs.readFileSync(api.file, 'utf8').startsWith('enc:'), true);
  const again = new SpotifyApi(() => ({ custom: true, clientId: CLIENT_ID }));
  await again.ready;
  assert.equal(again.tokens.refresh, 'ref0');
  assert.equal(again.status().error, '');
});

test('logout pendant save : rien n’est écrit, jetons non rétablis', async (t) => {
  const api = await makeApi(t);
  let release;
  state.encryptGate = new Promise((r) => (release = r));
  const saving = api.save({ ...fresh, clientId: CLIENT_ID });
  await new Promise((r) => setImmediate(r));
  api.logout();
  release();
  assert.equal(await saving, false);
  assert.equal(fs.existsSync(api.file), false);
  assert.equal(api.tokens, null);
});

test('logout : ne tait que ENOENT', async (t) => {
  const api = await makeApi(t);
  api.logout(); // fichier absent : silencieux
  assert.equal(api.status().error, '');
  await api.save({ ...fresh, clientId: CLIENT_ID });
  t.mock.method(fs, 'unlinkSync', () => {
    throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
  });
  api.logout();
  assert.match(api.status().error, /EPERM/);
});

test('sans chiffrement Windows : rien en clair sur disque, jetons gardés en mémoire, message', async (t) => {
  const api = await makeApi(t);
  state.encryption = false;
  await api.save({ ...fresh, clientId: CLIENT_ID });
  assert.equal(fs.existsSync(api.file), false);
  assert.equal(api.tokens.refresh, 'ref0');
  assert.match(api.status().error, /Windows encryption unavailable: sign-in not remembered/);
  api.clearError(); // l'avertissement persiste tant que les jetons ne sont pas mémorisés
  assert.match(api.status().error, /not remembered/);
  api.logout();
  assert.equal(api.status().error, '');
});

test('load : fichier absent silencieux, fichier corrompu signalé', async (t) => {
  const api = await makeApi(t);
  assert.equal(api.status().error, '');
  fs.writeFileSync(api.file, 'n’importe quoi');
  const bad = new SpotifyApi(() => ({ custom: true, clientId: CLIENT_ID }));
  await bad.ready;
  assert.equal(bad.tokens, null);
  assert.equal(bad.status().error, 'Unreadable Spotify tokens: sign in again');
});

test('ancien fichier en clair : relu puis chiffré', async (t) => {
  const api = await makeApi(t);
  fs.writeFileSync(api.file, JSON.stringify({ ...fresh, clientId: CLIENT_ID }));
  const old = new SpotifyApi(() => ({ custom: true, clientId: CLIENT_ID }));
  await old.ready;
  assert.equal(old.tokens.refresh, 'ref0');
  assert.equal(fs.readFileSync(old.file, 'utf8').startsWith('enc:'), true);
});

// ---------- serveur de retour OAuth (http simulé) ----------
function fakeServer(t) {
  const srv = { closed: 0, handler: null, on() {}, listen: (p, h, cb) => cb(), close: () => srv.closed++ };
  t.mock.method(http, 'createServer', (handler) => {
    srv.handler = handler;
    return srv;
  });
  return srv;
}
function fakeRes() {
  const r = { status: null, headers: {}, body: '' };
  r.writeHead = (s, h = {}) => {
    r.status = s;
    r.headers = h;
    return r;
  };
  r.end = (b = '') => {
    r.body += b;
    return r;
  };
  return r;
}

test('OAuth : state invalide -> 400 sans fermer le serveur', async (t) => {
  const api = await makeApi(t);
  const srv = fakeServer(t);
  api.login();
  const res = fakeRes();
  await srv.handler({ url: '/callback?state=pirate&code=x' }, res);
  assert.equal(res.status, 400);
  assert.equal(srv.closed, 0);
  assert.equal(api.server, srv);
});

test('OAuth : message d’erreur échappé dans la page de retour', async (t) => {
  const api = await makeApi(t);
  const srv = fakeServer(t);
  const n = net({ api: () => json({}), token: () => json({ error_description: '<img src=x onerror=alert(1)>' }, 400) });
  api.login();
  const state_ = new URL(state.openedUrls[0]).searchParams.get('state');
  const res = fakeRes();
  await srv.handler({ url: `/callback?state=${state_}&code=c` }, res);
  assert.equal(res.status, 200);
  assert.ok(!res.body.includes('<img'));
  assert.ok(res.body.includes('&lt;img'));
  assert.equal(srv.closed, 1);
  n.restore();
});

const stateOf = () => new URL(state.openedUrls.at(-1)).searchParams.get('state');

test('OAuth : connexion réussie -> jetons enregistrés, page sans cache, serveur fermé', async (t) => {
  const api = await makeApi(t);
  const srv = fakeServer(t);
  const n = net({ api: () => json({}), token: () => goodToken(7) });
  let connected = 0;
  api.on('connected', () => connected++);
  api.login();
  const auth = new URL(state.openedUrls[0]);
  assert.equal(auth.origin + auth.pathname, 'https://accounts.spotify.com/authorize');
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.get('client_id'), CLIENT_ID);
  const res = fakeRes();
  await srv.handler({ url: `/callback?state=${stateOf()}&code=bon` }, res);
  assert.equal(res.status, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(res.headers['Referrer-Policy'], 'no-referrer');
  assert.match(res.headers['Content-Security-Policy'], /default-src 'none'/);
  assert.equal(api.tokens.access, 'acc7');
  assert.equal(api.status().connected, true);
  assert.equal(connected, 1);
  assert.equal(srv.closed, 1);
  assert.equal(api.server, null);
  assert.ok(fs.readFileSync(api.file, 'utf8').startsWith('enc:'), 'jetons chiffrés sur disque');
  n.restore();
});

test('OAuth : retour sans code -> refusé sans appel réseau', async (t) => {
  const api = await makeApi(t);
  const srv = fakeServer(t);
  const n = net({ api: () => json({}), token: () => goodToken() });
  api.login();
  const res = fakeRes();
  await srv.handler({ url: `/callback?state=${stateOf()}` }, res);
  assert.equal(n.c.token, 0);
  assert.equal(res.status, 200);
  assert.match(res.body, /Incomplete/);
  assert.match(api.status().error, /no code/);
  assert.equal(api.tokens, null);
  assert.equal(srv.closed, 1);
  n.restore();
});

test('OAuth : accès refusé dans Spotify -> message clair, aucun jeton', async (t) => {
  const api = await makeApi(t);
  const srv = fakeServer(t);
  api.login();
  const res = fakeRes();
  await srv.handler({ url: `/callback?state=${stateOf()}&error=access_denied` }, res);
  assert.equal(api.status().error, 'Sign-in refused in Spotify.');
  assert.equal(api.tokens, null);
  assert.equal(srv.closed, 1);
});

test('OAuth : autre chemin -> 404, serveur toujours ouvert', async (t) => {
  const api = await makeApi(t);
  const srv = fakeServer(t);
  api.login();
  const res = fakeRes();
  await srv.handler({ url: '/favicon.ico' }, res);
  assert.equal(res.status, 404);
  assert.equal(srv.closed, 0);
});

test('OAuth : Client ID invalide -> pas de serveur ni de navigateur', async (t) => {
  const api = await makeApi(t);
  api.getConfig = () => ({ custom: true, clientId: 'pas-un-id' });
  const srv = fakeServer(t);
  api.login();
  assert.equal(srv.handler, null);
  assert.equal(state.openedUrls.length, 0);
  assert.match(api.status().error, /Client ID/);
});

test('OAuth : sans retour au bout de 5 minutes -> « Connexion Spotify expirée »', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const api = await makeApi(t);
  const srv = fakeServer(t);
  api.login();
  t.mock.timers.tick(5 * 60 * 1000);
  assert.equal(api.status().error, 'Spotify sign-in expired');
  assert.equal(srv.closed, 1);
  assert.equal(api.server, null);
});

test('player : champs interdits par Spotify, 204 -> null', async (t) => {
  const api = await makeApi(t, fresh);
  let body = { shuffle_state: true, repeat_state: 'track', actions: { disallows: { toggling_shuffle: true } } };
  const n = net({ api: () => (body ? json(body) : json(null, 204)), token: goodToken });
  assert.deepEqual(await api.player(), {
    shuffle: true,
    repeat: 'Track',
    shuffleAllowed: false,
    repeatAllowed: true,
  });
  body = null;
  assert.equal(await api.player(), null);
  n.restore();
});

test('queue : jeton impossible à rafraîchir -> null (pas une file vide)', async (t) => {
  const api = await makeApi(t, expired);
  const n = net({ api: () => json({ queue: [] }), token: () => json({ error: 'server_error' }, 500) });
  assert.equal(await api.queue(), null);
  assert.equal(n.c.api, 0);
  n.restore();
});

test('queue : file vraiment vide (204 ou liste vide) -> []', async (t) => {
  const api = await makeApi(t, fresh);
  let body = null;
  const n = net({ api: () => (body ? json(body) : json(null, 204)), token: goodToken });
  assert.deepEqual(await api.queue(), []);
  body = { queue: [] };
  assert.deepEqual(await api.queue(), []);
  n.restore();
});

test('playbackDevice : appareil actif, sinon un ordinateur', async (t) => {
  const api = await makeApi(t, fresh);
  let devices = [
    { id: 'tel', type: 'Smartphone', is_active: false },
    { id: 'pc', type: 'Computer', is_active: false },
  ];
  const n = net({ api: () => json({ devices }), token: goodToken });
  assert.deepEqual(await api.playbackDevice(), { id: 'pc', active: false });
  devices = [{ id: 'tel', type: 'Smartphone', is_active: true }];
  assert.deepEqual(await api.playbackDevice(), { id: 'tel', active: true });
  devices = [];
  assert.equal(await api.playbackDevice(), null);
  n.restore();
});
