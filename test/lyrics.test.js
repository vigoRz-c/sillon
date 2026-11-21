// Analyse des paroles synchronisées (LRC et "lyricsfile" de LRCLIB).
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLrc, parseLyricsFile } = require('../src/main/lyrics');

test('LRC : lignes triées, fin = début de la ligne suivante', () => {
  const lines = parseLrc('[00:10.50] Deuxième\n[00:02.10] Première\nligne sans horodatage\n[01:02.00] Troisième');
  assert.deepEqual(lines.map((l) => l.text), ['Première', 'Deuxième', 'Troisième']);
  assert.equal(lines[0].t, 2.1);
  assert.equal(lines[0].end, 10.5);
  assert.equal(lines[2].t, 62);
  assert.equal(lines[2].end, 67); // dernière ligne : +5 s
  assert.equal(lines[0].words, null);
});

test('LRC : plusieurs horodatages pour une même ligne (refrain)', () => {
  const lines = parseLrc('[00:05.00][00:20.00] Refrain\n[00:10.00] Couplet');
  assert.deepEqual(lines.map((l) => [l.t, l.text]), [[5, 'Refrain'], [10, 'Couplet'], [20, 'Refrain']]);
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

test('lyricsfile : minutage mot par mot, apostrophes YAML', () => {
  const lines = parseLyricsFile(LYRICSFILE);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].t, 2.1);
  assert.equal(lines[0].end, 3.679);
  assert.deepEqual(lines[0].words.map((w) => [w.text, w.t]), [['Just', 2.1], ['a', 2.659], ['moment', 2.842]]);
  assert.equal(lines[1].words[0].text, "Wasn't");
});

test('lyricsfile : contenu illisible -> null (on retombe sur le LRC)', () => {
  assert.equal(parseLyricsFile('pas du yaml'), null);
  assert.equal(parseLyricsFile(''), null);
});
