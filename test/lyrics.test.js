// Parsing of synced lyrics (LRC and LRCLIB's "lyricsfile").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mock } = require('node:test');
const { parseLrc, parseLyricsFile, findLyrics, lookupLyrics } = require('../src/main/media/lyrics');
const disk = require('../src/main/media/disk-cache');

test('LRC: sorted lines, end = start of the next line', () => {
  const lines = parseLrc('[00:04.50] Deuxième\n[00:02.10] Première\nligne sans horodatage\n[01:02.00] Troisième');
  assert.deepEqual(
    lines.map((l) => l.text),
    ['Première', 'Deuxième', 'Troisième'],
  );
  assert.equal(lines[0].t, 2.1);
  assert.equal(lines[0].end, 4.5);
  assert.equal(lines[2].t, 62);
  assert.equal(lines[2].end, 67); // last line: +5 s
  assert.equal(lines[0].words, null);
});

test('LRC: several timestamps for the same line (chorus)', () => {
  const lines = parseLrc('[00:05.00][00:20.00] Refrain\n[00:10.00] Couplet');
  assert.deepEqual(
    lines.map((l) => [l.t, l.text]),
    [
      [5, 'Refrain'],
      [10, 'Couplet'],
      [20, 'Refrain'],
    ],
  );
});

const LYRICSFILE = `version: '1.0'
metadata:
  title: Test
lines:
- text: Just a moment
  start_ms: 2100
  end_ms: 3679
  words:
  - text: 'Just '
    start_ms: 2100
  - text: 'a '
    start_ms: 2659
  - text: moment
    start_ms: 2842
- text: Wasn't brave
  start_ms: 15960
  end_ms: 17800
  words:
  - text: 'Wasn''t '
    start_ms: 15960
  - text: brave
    start_ms: 17030
`;

test('lyricsfile: word-by-word timing, YAML apostrophes', () => {
  const lines = parseLyricsFile(LYRICSFILE);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].t, 2.1);
  assert.equal(lines[0].end, 3.679);
  assert.deepEqual(
    lines[0].words.map((w) => [w.text, w.t]),
    [
      ['Just', 2.1],
      ['a', 2.659],
      ['moment', 2.842],
    ],
  );
  assert.equal(lines[1].words[0].text, "Wasn't");
});

test('lyricsfile: unreadable content -> null (back to the LRC)', () => {
  assert.equal(parseLyricsFile('not yaml'), null);
  assert.equal(parseLyricsFile(''), null);
});

test('LRC: long instrumental after a line -> the line goes away (capped end)', () => {
  const lines = parseLrc('[00:10.00] Une ligne courte\n[01:30.00] Après le solo');
  assert.ok(lines[0].end <= 18, `fin ${lines[0].end}`);
  assert.ok(lines[0].end > 10);
  assert.equal(lines[1].end, 95);
});

test('LRC: empty line until the next one, null or invalid input', () => {
  const lines = parseLrc('[00:10.00]\n[00:40.00] Suite');
  assert.equal(lines[0].end, 40);
  assert.deepEqual(parseLrc(null), []);
  assert.deepEqual(parseLrc(undefined), []);
});

test('lyricsfile: a line without start_ms invalidates the file', () => {
  const text = `lines:
- text: Avec horaire
  start_ms: 1000
- text: Sans horaire
  end_ms: 4000
`;
  assert.equal(parseLyricsFile(text), null);
});

test('lyricsfile: sorted lines, word without a time taken from the line', () => {
  const text = `lines:
- text: Seconde
  start_ms: 9000
  words:
  - text: 'Se '
  - text: conde
    start_ms: 9500
- text: Première
  start_ms: 1000
`;
  const lines = parseLyricsFile(text);
  assert.deepEqual(
    lines.map((l) => l.text),
    ['Première', 'Seconde'],
  );
  assert.deepEqual(
    lines[1].words.map((w) => [w.text, w.t]),
    [
      ['Se', 9],
      ['conde', 9.5],
    ],
  );
  assert.equal(lines[0].words, null);
});

// ---------- findLyrics / lookupLyrics with a simulated LRCLIB ----------
const textRes = (body, status = 200) => ({
  ok: status < 400,
  status,
  headers: { get: () => null },
  text: async () => JSON.stringify(body),
});
const rec = (over) => ({
  trackName: 'Titre',
  artistName: 'Artiste',
  duration: 200,
  syncedLyrics: '[00:01.00] Bonjour',
  ...over,
});

function withLrclib(route, fn) {
  const calls = [];
  const m = mock.method(global, 'fetch', async (url) => {
    const u = new URL(url);
    calls.push(u.pathname);
    return route(u);
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sillon-lyrics-'));
  disk.init(dir);
  return Promise.resolve(fn(calls)).finally(() => {
    m.mock.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

const MEDIA = { title: 'Titre', artist: 'Artiste', album: 'Album', duration: 200 };

test('findLyrics: exact reply from /get', async () => {
  await withLrclib(
    () => textRes(rec()),
    async () => {
      const r = await findLyrics(MEDIA);
      assert.equal(r.lines[0].text, 'Bonjour');
    },
  );
});

test('findLyrics: fallback to /search when /get answers 404', async () => {
  await withLrclib(
    (u) => (u.pathname.endsWith('/get') ? textRes(null, 404) : textRes([rec()])),
    async (calls) => {
      const r = await findLyrics(MEDIA);
      assert.equal(r.lines.length, 1);
      assert.deepEqual(calls, ['/api/get', '/api/search']);
    },
  );
});

test('findLyrics: duration within 8 s accepted, beyond refused', async () => {
  const run = (duration) =>
    withLrclib(
      (u) => (u.pathname.endsWith('/get') ? textRes(null, 404) : textRes([rec({ duration })])),
      () => findLyrics(MEDIA),
    );
  assert.ok(await run(208));
  assert.equal(await run(209), null);
});

test('findLyrics: wrong artist rejected', async () => {
  await withLrclib(
    (u) => (u.pathname.endsWith('/get') ? textRes(null, 404) : textRes([rec({ artistName: 'Someone else' })])),
    async () => assert.equal(await findLyrics(MEDIA), null),
  );
});

test('findLyrics: empty title or artist -> null without a request', async () => {
  await withLrclib(
    () => textRes(rec()),
    async (calls) => {
      assert.equal(await findLyrics({ title: '', artist: 'A' }), null);
      assert.equal(await findLyrics({ title: 'T', artist: null }), null);
      assert.equal(calls.length, 0);
    },
  );
});

test('findLyrics: reply too large refused', async () => {
  await withLrclib(
    () => ({ ok: true, status: 200, headers: { get: () => '9999999' }, text: async () => '{}' }),
    async () => assert.rejects(findLyrics(MEDIA), /too large/),
  );
});

test('lookupLyrics: network error -> { error: true }, not cached', async () => {
  const media = { ...MEDIA, title: 'Network error' };
  let fail = true;
  await withLrclib(
    () => {
      if (fail) throw new Error('network down');
      return textRes(rec({ trackName: 'Network error' }));
    },
    async () => {
      assert.deepEqual(await lookupLyrics(media), { error: true });
      fail = false;
      const r = await lookupLyrics(media);
      assert.equal(r.lines[0].text, 'Bonjour');
    },
  );
});

test('lookupLyrics: "no lyrics" (404 everywhere) is cached', async () => {
  const media = { ...MEDIA, title: 'Introuvable' };
  await withLrclib(
    () => textRes(null, 404),
    async (calls) => {
      assert.equal(await lookupLyrics(media), null);
      const n = calls.length;
      assert.equal(await lookupLyrics(media), null);
      assert.equal(calls.length, n);
    },
  );
});

test('lookupLyrics: possibly stale duration (volatile) -> empty result not cached', async () => {
  const media = { ...MEDIA, title: 'Stale duration' };
  let found = false;
  await withLrclib(
    () => (found ? textRes(rec({ trackName: 'Stale duration' })) : textRes(null, 404)),
    async () => {
      assert.equal(await lookupLyrics(media, { volatile: true }), null);
      found = true; // the right duration arrives: the search must go back to the network
      const r = await lookupLyrics(media);
      assert.equal(r.lines[0].text, 'Bonjour');
    },
  );
});
