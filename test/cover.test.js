// Choix de la pochette (Deezer simulé) et cache disque.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { norm, findCoverUrl } = require('../src/main/media/cover-lookup');
const disk = require('../src/main/media/disk-cache');

test('norm : casse, accents, versions entre parenthèses et suffixes', () => {
  assert.equal(norm('Bohemian Rhapsody - Remastered 2011'), 'bohemian rhapsody');
  assert.equal(norm('Dernière Danse (Live)'), 'derniere danse');
  assert.equal(norm('A Night At The Opera (2011 Remaster)'), 'a night at the opera');
});

// Réponses Deezer simulées pour "Break Stuff" de Limp Bizkit : un single, une
// compilation, l'album studio et un album de remix.
const ALBUMS = {
  1: { id: 1, title: 'Significant Other', record_type: 'album', cover_big: 'studio.jpg' },
  2: { id: 2, title: 'New Old Songs', record_type: 'album', cover_big: 'remix.jpg' },
  3: { id: 3, title: 'Break Stuff', record_type: 'single', cover_big: 'single.jpg' },
};
const track = (title, albumId) => ({
  title,
  artist: { name: 'Limp Bizkit' },
  album: { id: albumId, title: ALBUMS[albumId].title },
});

function mockDeezer() {
  return async (url) => {
    const u = new URL(url);
    let body;
    if (u.pathname.startsWith('/album/')) body = ALBUMS[u.pathname.split('/')[2]];
    else if (u.pathname === '/search') {
      body = {
        data: [track('Break Stuff', 1), track('Break Stuff (Lethal - Explicit Version)', 2), track('Nookie', 3)],
      };
    } else body = { data: [] };
    return { ok: true, json: async () => body };
  };
}

test('pochette : album studio avec le titre exact, pas le single ni le remix', async () => {
  const real = global.fetch;
  global.fetch = mockDeezer();
  try {
    const url = await findCoverUrl({ title: 'Break Stuff', artist: 'Limp Bizkit', album: 'Break Stuff' });
    assert.equal(url, 'studio.jpg');
  } finally {
    global.fetch = real;
  }
});

test("pochette : artiste différent -> rien (on garde l'image de Windows)", async () => {
  const real = global.fetch;
  global.fetch = mockDeezer();
  try {
    assert.equal(await findCoverUrl({ title: 'Break Stuff', artist: 'Un Autre', album: '' }), null);
  } finally {
    global.fetch = real;
  }
});

test('cache disque : valeur relue, "rien trouvé" gardé aussi', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sillon-test-'));
  try {
    disk.init(dir);
    assert.equal(await disk.get('covers', 'a'), undefined);
    await disk.set('covers', 'a', 'data:image/png;base64,xx');
    await disk.set('covers', 'b', null);
    assert.equal(await disk.get('covers', 'a'), 'data:image/png;base64,xx');
    assert.equal(await disk.get('covers', 'b'), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- lookupCover : erreurs réseau, « rien trouvé », image ----------
const { mock } = require('node:test');
const { lookupCover, toDataUrl } = require('../src/main/media/cover-lookup');

const jsonRes = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });
const imgRes = (type, bytes, extra = {}) => ({
  ok: true,
  status: 200,
  headers: { get: (h) => ({ 'content-type': type, ...extra })[h.toLowerCase()] ?? null },
  arrayBuffer: async () => new Uint8Array(bytes).buffer,
});

// Deezer simulé : "route" décide de la réponse selon le chemin.
function withDeezer(route, fn) {
  const calls = [];
  const m = mock.method(global, 'fetch', async (url) => {
    const u = new URL(url);
    calls.push(u.hostname + u.pathname);
    return route(u);
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sillon-cover-'));
  disk.init(dir);
  return Promise.resolve(fn(calls)).finally(() => {
    m.mock.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

const found = (u) => {
  if (u.pathname.startsWith('/album/'))
    return jsonRes({ ...ALBUMS[1], cover_big: 'https://cdn-images.dzcdn.net/x.jpg' });
  if (u.pathname === '/search') return jsonRes({ data: [track('Break Stuff', 1)] });
  if (u.hostname.endsWith('dzcdn.net')) return imgRes('image/jpeg', [1, 2, 3]);
  return jsonRes({ data: [] });
};

test('lookupCover : tous les getAlbum échouent -> rien en cache (ni mémoire ni disque)', async () => {
  const media = { title: 'Break Stuff', artist: 'Limp Bizkit', album: 'Break Stuff X1' };
  await withDeezer(
    (u) => (u.pathname.startsWith('/album/') ? jsonRes({}, false, 429) : found(u)),
    async (calls) => {
      assert.equal(await lookupCover(media), null);
      const n = calls.length;
      assert.equal(await lookupCover(media), null);
      assert.ok(calls.length > n, 'la deuxième tentative doit refaire des requêtes');
    },
  );
});

test('lookupCover : erreur réseau sur la recherche -> non mis en cache', async () => {
  const media = { title: 'Break Stuff', artist: 'Limp Bizkit', album: 'Net Error' };
  let fail = true;
  await withDeezer(
    (u) => {
      if (fail) throw new Error('réseau coupé');
      return found(u);
    },
    async () => {
      assert.equal(await lookupCover(media), null);
      fail = false;
      const cover = await lookupCover(media);
      assert.match(cover, /^data:image\/jpeg;base64,/);
    },
  );
});

test('lookupCover : « rien trouvé » (requêtes abouties) est mis en cache', async () => {
  const media = { title: 'Inconnu', artist: 'Personne', album: 'Nulle part' };
  await withDeezer(
    () => jsonRes({ data: [] }),
    async (calls) => {
      assert.equal(await lookupCover(media), null);
      const n = calls.length;
      assert.ok(n > 0);
      assert.equal(await lookupCover(media), null);
      assert.equal(calls.length, n, 'pas de nouvelle requête : le résultat vide est en cache');
      assert.equal(await disk.get('covers', 'personne|nulle part|inconnu'), null);
    },
  );
});

test('toDataUrl : refuse HTTP, hôte inconnu, mauvais type, image trop grosse', async () => {
  const m = mock.method(global, 'fetch', async () => imgRes('image/png', [1]));
  try {
    await assert.rejects(toDataUrl('http://cdn-images.dzcdn.net/a.jpg'), /HTTPS/);
    await assert.rejects(toDataUrl('https://evil.example.com/a.jpg'), /hôte/);
    await assert.rejects(toDataUrl('https://dzcdn.net.evil.com/a.jpg'), /hôte/);
    await assert.rejects(toDataUrl('pas une url'), /invalide/);
    assert.equal(m.mock.callCount(), 0);
    const ok = await toDataUrl('https://e-cdns-images.dzcdn.net/a.png');
    assert.equal(ok, 'data:image/png;base64,AQ==');
    m.mock.restore();

    const t = mock.method(global, 'fetch', async () => imgRes('text/html', [1]));
    await assert.rejects(toDataUrl('https://cdn-images.dzcdn.net/a.jpg'), /type/);
    t.mock.restore();

    const big = mock.method(global, 'fetch', async () => imgRes('image/jpeg', [1], { 'content-length': '3000000' }));
    await assert.rejects(toDataUrl('https://cdn-images.dzcdn.net/a.jpg'), /grosse/);
    big.mock.restore();

    const real = mock.method(global, 'fetch', async () => imgRes('image/webp', new Array(2 * 1024 * 1024 + 1).fill(0)));
    await assert.rejects(toDataUrl('https://cdn-images.dzcdn.net/a.jpg'), /grosse/);
    real.mock.restore();
  } finally {
    mock.restoreAll();
  }
});
