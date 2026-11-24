// Mises à jour : un téléchargement qui ne progresse plus ne bloque pas l'état.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const { EventEmitter } = require('events');

const notes = [];
const diagPath = path.join(__dirname, '..', 'src', 'main', 'app', 'diagnostic.js');
require.cache[diagPath] = {
  id: diagPath,
  filename: diagPath,
  loaded: true,
  exports: { note: (kind, text) => notes.push(`${kind}: ${text}`) },
};
const autoUpdater = Object.assign(new EventEmitter(), { checkForUpdates: async () => {} });
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return { app: { isPackaged: true, getVersion: () => '0.0.0' }, Notification: { isSupported: () => false } };
  }
  if (request === 'electron-updater') return { autoUpdater };
  return realLoad.call(this, request, ...rest);
};
const S = require('../src/main/app/state');
const updater = require('../src/main/app/updater');
// electron-updater est chargé à l'init : la simulation reste active jusqu'à la fin.
test.after(() => {
  Module._load = realLoad;
});

test('téléchargement sans progression pendant 10 min : retour à « idle », noté', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  delete process.env.PORTABLE_EXECUTABLE_DIR;
  S.settings = { get: () => true };
  updater.init();
  autoUpdater.emit('update-available', { version: '9.9.9' });
  assert.equal(updater.status().state, 'downloading');
  t.mock.timers.tick(9 * 60 * 1000);
  autoUpdater.emit('download-progress', { percent: 40 }); // la minuterie repart
  t.mock.timers.tick(9 * 60 * 1000);
  assert.equal(updater.status().state, 'downloading');
  t.mock.timers.tick(updater.DOWNLOAD_STALL);
  assert.equal(updater.status().state, 'idle');
  assert.ok(notes.some((n) => n.includes('sans progression')));
});

test('téléchargement terminé : pas d’abandon ensuite', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  autoUpdater.emit('update-available', { version: '9.9.9' });
  autoUpdater.emit('update-downloaded', { version: '9.9.9' });
  t.mock.timers.tick(updater.DOWNLOAD_STALL * 2);
  assert.equal(updater.status().state, 'ready');
});

test('erreurs : messages lisibles (réseau, aucune version publiée, autre)', () => {
  autoUpdater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
  assert.equal(updater.status().state, 'error');
  assert.match(updater.status().error, /Pas de connexion/);
  autoUpdater.emit('error', new Error('HttpError: 404 Not Found'));
  assert.match(updater.status().error, /Aucune version publiée/);
  autoUpdater.emit('error', new Error(['signature invalide', 'détails techniques'].join('\n')));
  assert.equal(updater.status().error, 'Mise à jour impossible : signature invalide');
});

test('check : échec de la vérification -> état « error », pas d’exception', async (t) => {
  t.mock.method(autoUpdater, 'checkForUpdates', async () => {
    throw new Error('getaddrinfo ENOTFOUND github.com');
  });
  autoUpdater.emit('update-not-available');
  updater.check();
  await new Promise((r) => setImmediate(r));
  assert.equal(updater.status().state, 'error');
  assert.match(updater.status().error, /Pas de connexion/);
});

test('check : pas de nouvelle vérification pendant un téléchargement ou une fois prête', (t) => {
  const check = t.mock.method(autoUpdater, 'checkForUpdates', async () => {});
  autoUpdater.emit('update-available', { version: '9.9.9' });
  updater.check();
  autoUpdater.emit('update-downloaded', { version: '9.9.9' });
  updater.check();
  assert.equal(check.mock.callCount(), 0);
});

test('installNow : seulement une fois la mise à jour prête', (t) => {
  const install = t.mock.fn();
  autoUpdater.quitAndInstall = install;
  autoUpdater.emit('update-available', { version: '9.9.9' });
  updater.installNow();
  assert.equal(install.mock.callCount(), 0);
  autoUpdater.emit('update-downloaded', { version: '9.9.9' });
  updater.installNow();
  assert.deepEqual(install.mock.calls[0].arguments, [true, true]);
});
