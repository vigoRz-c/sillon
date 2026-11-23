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
const track = (title, albumId) => ({ title, artist: { name: 'Limp Bizkit' }, album: { id: albumId, title: ALBUMS[albumId].title } });

function mockDeezer() {
  return async (url) => {
    const u = new URL(url);
    let body;
    if (u.pathname.startsWith('/album/')) body = ALBUMS[u.pathname.split('/')[2]];
    else if (u.pathname === '/search') {
      body = { data: [track('Break Stuff', 1), track('Break Stuff (Lethal - Explicit Version)', 2), track('Nookie', 3)] };
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
  } finally { global.fetch = real; }
});

test('pochette : artiste différent -> rien (on garde l\'image de Windows)', async () => {
  const real = global.fetch;
  global.fetch = mockDeezer();
  try {
    assert.equal(await findCoverUrl({ title: 'Break Stuff', artist: 'Un Autre', album: '' }), null);
  } finally { global.fetch = real; }
});

test('cache disque : valeur relue, "rien trouvé" gardé aussi', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sillon-test-'));
  try {
    disk.init(dir);
    assert.equal(disk.get('covers', 'a'), undefined);
    disk.set('covers', 'a', 'data:image/png;base64,xx');
    disk.set('covers', 'b', null);
    assert.equal(disk.get('covers', 'a'), 'data:image/png;base64,xx');
    assert.equal(disk.get('covers', 'b'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
