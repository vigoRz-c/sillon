// Normalisation des titres et des artistes (partagée par pochettes et paroles).
const test = require('node:test');
const assert = require('node:assert/strict');
const { strict, cleanTitle, norm, firstArtist, artistKey } = require('../src/main/media/text-norm');

test('cleanTitle : retire les versions et les suffixes', () => {
  assert.equal(cleanTitle('Bohemian Rhapsody - Remastered 2011'), 'Bohemian Rhapsody');
  assert.equal(cleanTitle('Song (Live) [Deluxe]'), 'Song');
  assert.equal(cleanTitle('  Titre (feat. X) (Remix)  '), 'Titre');
});

test("cleanTitle : « (Don't Fear) The Reaper » ne devient pas vide", () => {
  assert.equal(cleanTitle("(Don't Fear) The Reaper"), "(Don't Fear) The Reaper");
  assert.equal(norm("(Don't Fear) The Reaper"), 'don t fear the reaper');
  assert.equal(cleanTitle("(Don't Fear) The Reaper - Remastered"), "(Don't Fear) The Reaper");
});

test('cleanTitle : un titre entièrement entre parenthèses est conservé', () => {
  assert.equal(cleanTitle('(Intro)'), '(Intro)');
  assert.equal(norm('(Intro)'), 'intro');
  assert.equal(cleanTitle('[Untitled]'), '[Untitled]');
});

test('cleanTitle / norm : null, undefined, vide, types invalides', () => {
  for (const v of [null, undefined, '', '   ', 0, {}]) {
    assert.equal(typeof cleanTitle(v), 'string');
  }
  assert.equal(cleanTitle(null), '');
  assert.equal(norm(undefined), '');
  assert.equal(norm('   '), '');
});

test('norm : accents, casse, ponctuation, emojis et caractères SQL', () => {
  assert.equal(norm('Dernière Danse (Live)'), 'derniere danse');
  assert.equal(norm("Robert'); DROP TABLE x;--"), 'robert drop table x');
  assert.equal(norm('🎵 Musique 🎵'), 'musique');
  assert.equal(norm('Beyoncé - Halo'), 'beyonce');
});

test('strict : garde les versions, normalise seulement', () => {
  assert.equal(strict('Break Stuff (Remastered)'), 'break stuff remastered');
  assert.equal(strict('Éléphant!'), 'elephant');
  assert.equal(strict(null), '');
});

test('firstArtist : premier de la liste', () => {
  assert.equal(firstArtist('A, B'), 'A');
  assert.equal(firstArtist('A & B'), 'A');
  assert.equal(firstArtist('A feat. B'), 'A');
  assert.equal(firstArtist('A ft B'), 'A');
  assert.equal(firstArtist(null), '');
  assert.equal(artistKey('Beyoncé, Jay-Z'), 'beyonce');
});

// ---------- Téléchargement d'images : plafond en flux et redirections ----------

const { fetchImageDataUrl, readCapped, IMAGE_MAX } = require('../src/main/media/text-norm');
const HOSTS = /^([a-z0-9-]+\.)*dzcdn\.net$/i;

function streamOf(chunks) {
  return new ReadableStream({
    pull(c) {
      const next = chunks.shift();
      if (next) c.enqueue(next);
      else c.close();
    },
  });
}

function reply(status, headers, chunks = []) {
  return { status, ok: status >= 200 && status < 300, headers: new Headers(headers), body: streamOf(chunks) };
}

test('readCapped : arrête la lecture dès que le plafond est dépassé, sans content-length', async () => {
  let pulled = 0;
  const body = new ReadableStream({
    pull(c) {
      pulled++;
      c.enqueue(new Uint8Array(1024));
    },
  });
  await assert.rejects(readCapped({ headers: new Headers(), body }, 4096), /trop volumineuse/);
  assert.ok(pulled < 10, `lecture arrêtée tôt (${pulled} morceaux)`);
});

test('fetchImageDataUrl : redirection vers un hôte non autorisé refusée AVANT la requête', async (t) => {
  const urls = [];
  t.mock.method(global, 'fetch', async (url) => {
    urls.push(url);
    return reply(302, { location: 'https://evil.example/x.jpg' });
  });
  await assert.rejects(fetchImageDataUrl('https://cdn-images.dzcdn.net/a.jpg', HOSTS), /hôte non autorisé/);
  assert.deepEqual(urls, ['https://cdn-images.dzcdn.net/a.jpg']);
});

test('fetchImageDataUrl : redirection autorisée suivie, image renvoyée en data URL', async (t) => {
  t.mock.method(global, 'fetch', async (url) =>
    url.includes('a.jpg')
      ? reply(301, { location: '/b.jpg' })
      : reply(200, { 'content-type': 'image/jpeg' }, [new Uint8Array([1, 2, 3])]),
  );
  const out = await fetchImageDataUrl('https://cdn-images.dzcdn.net/a.jpg', HOSTS);
  assert.equal(out, 'data:image/jpeg;base64,AQID');
});

test('fetchImageDataUrl : image sans content-length plus grosse que le plafond refusée', async (t) => {
  const big = new Uint8Array(IMAGE_MAX + 1);
  t.mock.method(global, 'fetch', async () => reply(200, { 'content-type': 'image/png' }, [big]));
  await assert.rejects(fetchImageDataUrl('https://cdn-images.dzcdn.net/a.png', HOSTS), /trop grosse/);
});
