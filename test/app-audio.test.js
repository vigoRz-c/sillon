const test = require('node:test');
const assert = require('node:assert');
const { exeForApp } = require('../src/main/audio/app-ids');

test('exeForApp : applications connues', () => {
  assert.strictEqual(exeForApp('Spotify.exe'), 'Spotify.exe');
  assert.strictEqual(exeForApp('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify'), 'Spotify.exe');
  assert.strictEqual(exeForApp('Chrome'), 'chrome.exe');
  assert.strictEqual(exeForApp('MSEdge'), 'msedge.exe');
  assert.strictEqual(exeForApp('308046B0AF4A39CB'), 'firefox.exe');
  assert.strictEqual(exeForApp('VLC media player'), 'vlc.exe');
});

test('exeForApp : un .exe inconnu est repris tel quel', () => {
  assert.strictEqual(exeForApp('C:\\Programmes\\Lecteur\\mon lecteur.exe'), 'mon lecteur.exe');
  assert.strictEqual(exeForApp('autre.exe'), 'autre.exe');
});

test('exeForApp : entrées vides ou invalides', () => {
  for (const v of [null, undefined, '', 42, {}, 'Inconnu']) assert.strictEqual(exeForApp(v), null);
});
