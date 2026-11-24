const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { isAppUrl, finite, validRect, MEDIA_COMMANDS, pageOf, allowedFor } = require('../src/main/app/ipc-guard');

const root = path.join(__dirname, '..', 'src', 'renderer', 'pages');

test("isAppUrl: only the app's pages are accepted", () => {
  const page = pathToFileURL(path.join(root, 'widget.html')).href;
  assert.ok(isAppUrl(page, root));
  assert.ok(isAppUrl(`${page}?edit=1`, root));
  assert.ok(isAppUrl(page.replace('file:///D:', 'file:///d:'), root));
  for (const u of ['https://exemple.com/', 'data:text/html,x', 'file:///C:/autre/x.html', '', null, undefined, 5]) {
    assert.ok(!isAppUrl(u, root));
  }
  assert.ok(!isAppUrl(pathToFileURL(root + '-evil/x.html').href, root));
});

test('finite and validRect reject NaN, null and wrong types', () => {
  assert.strictEqual(finite(5, 0, 10), 5);
  for (const v of [NaN, Infinity, null, undefined, '5', 11]) assert.strictEqual(finite(v, 0, 10), null);
  assert.deepStrictEqual(validRect({ x: 1, y: 2, width: 3, height: 4, z: 9 }), { x: 1, y: 2, width: 3, height: 4 });
  for (const r of [null, 5, {}, { x: 1, y: 2, width: NaN, height: 4 }, { x: '1', y: 2, width: 3, height: 4 }]) {
    assert.strictEqual(validRect(r), null);
  }
});

test('allow list of the media commands', () => {
  assert.deepStrictEqual([...MEDIA_COMMANDS].sort(), [
    'next',
    'pause',
    'play',
    'playpause',
    'previous',
    'repeat',
    'shuffle',
  ]);
});

test('allowedFor: each page only has its channels', () => {
  const url = (f) => pathToFileURL(path.join(root, f)).href;
  assert.strictEqual(pageOf(`${url('Widget.html')}?edit=1`), 'widget.html');
  assert.strictEqual(pageOf('not an address'), '');
  assert.ok(allowedFor(url('settings.html'), 'spotify:logout'));
  assert.ok(allowedFor(`${url('fullscreen.html')}?veille=1`, 'veille:exit'));
  assert.ok(!allowedFor(url('controls.html'), 'spotify:logout'));
  assert.ok(!allowedFor(url('veille-black.html'), 'settings:set'));
  assert.ok(!allowedFor(url('inconnue.html'), 'settings:get'));
  assert.ok(!allowedFor(url('__proto__'), 'settings:get'));
});

test('allowedFor: only the settings read the state of the keyboard shortcuts', () => {
  const url = (f) => pathToFileURL(path.join(root, f)).href;
  assert.ok(allowedFor(url('settings.html'), 'shortcuts:status'));
  for (const f of ['widget.html', 'fullscreen.html', 'controls.html', 'veille-black.html']) {
    assert.ok(!allowedFor(url(f), 'shortcuts:status'), f);
  }
});

test('allowedFor: the strip placement window (widget.html?place=1) can finish and resize', () => {
  const url = `${pathToFileURL(path.join(root, 'widget.html')).href}?place=1`;
  assert.strictEqual(pageOf(url), 'widget.html');
  assert.ok(allowedFor(url, 'edit:done'));
  assert.ok(allowedFor(url, 'widget:resize'));
  assert.ok(!allowedFor(url, 'settings:set'));
});
