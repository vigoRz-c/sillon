// Updates: a download that no longer progresses does not block the state.
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
// electron-updater is loaded at init: the simulation stays active until the end.
test.after(() => {
  Module._load = realLoad;
});

test('download without progress for 10 min: back to "idle", noted', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  delete process.env.PORTABLE_EXECUTABLE_DIR;
  S.settings = { get: () => true };
  updater.init();
  autoUpdater.emit('update-available', { version: '9.9.9' });
  assert.equal(updater.status().state, 'downloading');
  t.mock.timers.tick(9 * 60 * 1000);
  autoUpdater.emit('download-progress', { percent: 40 }); // the timer starts again
  t.mock.timers.tick(9 * 60 * 1000);
  assert.equal(updater.status().state, 'downloading');
  t.mock.timers.tick(updater.DOWNLOAD_STALL);
  assert.equal(updater.status().state, 'idle');
  assert.ok(notes.some((n) => n.includes('without progress')));
});

test('download finished: no giving up afterwards', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  autoUpdater.emit('update-available', { version: '9.9.9' });
  autoUpdater.emit('update-downloaded', { version: '9.9.9' });
  t.mock.timers.tick(updater.DOWNLOAD_STALL * 2);
  assert.equal(updater.status().state, 'ready');
});

test('errors: readable messages (network, no published version, other)', () => {
  autoUpdater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'));
  assert.equal(updater.status().state, 'error');
  assert.match(updater.status().error, /No connection/);
  autoUpdater.emit('error', new Error('HttpError: 404 Not Found'));
  assert.match(updater.status().error, /No published version/);
  autoUpdater.emit('error', new Error(['invalid signature', 'technical details'].join('\n')));
  assert.equal(updater.status().error, 'Update failed: invalid signature');
});

test('check: verification failure -> "error" state, no exception', async (t) => {
  t.mock.method(autoUpdater, 'checkForUpdates', async () => {
    throw new Error('getaddrinfo ENOTFOUND github.com');
  });
  autoUpdater.emit('update-not-available');
  updater.check();
  await new Promise((r) => setImmediate(r));
  assert.equal(updater.status().state, 'error');
  assert.match(updater.status().error, /No connection/);
});

test('check: no new check during a download or once ready', (t) => {
  const check = t.mock.method(autoUpdater, 'checkForUpdates', async () => {});
  autoUpdater.emit('update-available', { version: '9.9.9' });
  updater.check();
  autoUpdater.emit('update-downloaded', { version: '9.9.9' });
  updater.check();
  assert.equal(check.mock.callCount(), 0);
});

test('installNow: only once the update is ready', (t) => {
  const install = t.mock.fn();
  autoUpdater.quitAndInstall = install;
  autoUpdater.emit('update-available', { version: '9.9.9' });
  updater.installNow();
  assert.equal(install.mock.callCount(), 0);
  autoUpdater.emit('update-downloaded', { version: '9.9.9' });
  updater.installNow();
  assert.deepEqual(install.mock.calls[0].arguments, [true, true]);
});
