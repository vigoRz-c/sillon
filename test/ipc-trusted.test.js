// ipc.js: only the app's pages, and only on their channels, are
// listened to; an error in a handler does not go up. Electron is simulated.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const { pathToFileURL } = require('url');

const notes = [];
const diagPath = path.join(__dirname, '..', 'src', 'main', 'app', 'diagnostic.js');
require.cache[diagPath] = {
  id: diagPath,
  filename: diagPath,
  loaded: true,
  exports: { note: (kind, text) => notes.push(`${kind}: ${text}`) },
};
const listeners = {};
const handlers = {};
const fakeIpcMain = {
  on: (ch, fn) => (listeners[ch] = fn),
  handle: (ch, fn) => (handlers[ch] = fn),
};
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  return request === 'electron' ? { ipcMain: fakeIpcMain } : realLoad.call(this, request, ...rest);
};
const S = require('../src/main/app/state');
const ipc = require('../src/main/app/ipc');
Module._load = realLoad;

const page = (f, q = '') => ({ senderFrame: { url: pathToFileURL(path.join(S.RENDERER, f)).href + q } });

test('trusted: app page on an allowed channel', (t) => {
  t.mock.method(console, 'error', () => {});
  assert.equal(ipc.trusted(page('settings.html'), 'spotify:logout'), true);
  assert.equal(ipc.trusted(page('fullscreen.html', '?veille=1'), 'veille:exit'), true);
});

test('trusted: external page, neighboring page or channel not allowed refused (and noted)', (t) => {
  t.mock.method(console, 'error', () => {});
  notes.length = 0;
  assert.equal(ipc.trusted({ senderFrame: { url: 'https://exemple.com/' } }, 'settings:get'), false);
  assert.equal(ipc.trusted({ senderFrame: { url: 'data:text/html,x' } }, 'veille:exit'), false);
  const voisin = pathToFileURL(path.join(S.RENDERER, '..', 'pages-pirate', 'settings.html')).href;
  assert.equal(ipc.trusted({ senderFrame: { url: voisin } }, 'settings:get'), false);
  assert.equal(ipc.trusted({}, 'settings:get'), false);
  assert.equal(ipc.trusted(null, 'settings:get'), false);
  assert.equal(ipc.trusted(page('controls.html'), 'spotify:logout'), false);
  assert.equal(ipc.trusted(page('veille-black.html'), 'settings:set'), false);
  assert.ok(notes.some((n) => n.includes('spotify:logout') && n.includes('controls.html')));
});

test('on: handler called only for an allowed sender, errors isolated', (t) => {
  const err = t.mock.method(console, 'error', () => {});
  const calls = [];
  ipc.on('media:volume', (_e, v) => {
    calls.push(v);
    if (v === 'boom') throw new Error('panne');
  });
  listeners['media:volume'](page('controls.html'), 40);
  listeners['media:volume'](page('settings.html'), 50); // channel not allowed for the settings
  assert.doesNotThrow(() => listeners['media:volume'](page('controls.html'), 'boom'));
  assert.deepEqual(calls, [40, 'boom']);
  assert.ok(err.mock.calls.some((c) => String(c.arguments[0]).includes('media:volume')));
});

test('handle: null if refused or on error, otherwise the value', async (t) => {
  t.mock.method(console, 'error', () => {});
  ipc.handle('diagnostic:copy', async (_e, x) => {
    if (x === 'boom') throw new Error('panne');
    return 'texte';
  });
  assert.equal(await handlers['diagnostic:copy'](page('settings.html')), 'texte');
  assert.equal(await handlers['diagnostic:copy'](page('widget.html')), null);
  assert.equal(await handlers['diagnostic:copy'](page('settings.html'), 'boom'), null);
});
