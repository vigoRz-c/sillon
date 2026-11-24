const test = require('node:test');
const assert = require('node:assert');
const { exeForApp } = require('../src/main/audio/app-ids');

test('exeForApp: known applications', () => {
  assert.strictEqual(exeForApp('Spotify.exe'), 'Spotify.exe');
  assert.strictEqual(exeForApp('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify'), 'Spotify.exe');
  assert.strictEqual(exeForApp('Chrome'), 'chrome.exe');
  assert.strictEqual(exeForApp('MSEdge'), 'msedge.exe');
  assert.strictEqual(exeForApp('308046B0AF4A39CB'), 'firefox.exe');
  assert.strictEqual(exeForApp('VLC media player'), 'vlc.exe');
});

test('exeForApp: an unknown .exe is taken as is', () => {
  assert.strictEqual(exeForApp('C:\\Programs\\Player\\my player.exe'), 'my player.exe');
  assert.strictEqual(exeForApp('autre.exe'), 'autre.exe');
});

test('exeForApp: empty or invalid entries', () => {
  for (const v of [null, undefined, '', 42, {}, 'Inconnu']) assert.strictEqual(exeForApp(v), null);
});
