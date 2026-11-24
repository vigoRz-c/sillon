const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { isAppUrl, finite, validRect, MEDIA_COMMANDS, pageOf, allowedFor } = require('../src/main/app/ipc-guard');

const root = path.join(__dirname, '..', 'src', 'renderer', 'pages');

test("isAppUrl : seules les pages de l'app sont acceptées", () => {
  const page = pathToFileURL(path.join(root, 'widget.html')).href;
  assert.ok(isAppUrl(page, root));
  assert.ok(isAppUrl(`${page}?edit=1`, root));
  assert.ok(isAppUrl(page.replace('file:///D:', 'file:///d:'), root));
  for (const u of ['https://exemple.com/', 'data:text/html,x', 'file:///C:/autre/x.html', '', null, undefined, 5]) {
    assert.ok(!isAppUrl(u, root));
  }
  assert.ok(!isAppUrl(pathToFileURL(root + '-evil/x.html').href, root));
});

test('finite et validRect rejettent NaN, null et mauvais types', () => {
  assert.strictEqual(finite(5, 0, 10), 5);
  for (const v of [NaN, Infinity, null, undefined, '5', 11]) assert.strictEqual(finite(v, 0, 10), null);
  assert.deepStrictEqual(validRect({ x: 1, y: 2, width: 3, height: 4, z: 9 }), { x: 1, y: 2, width: 3, height: 4 });
  for (const r of [null, 5, {}, { x: 1, y: 2, width: NaN, height: 4 }, { x: '1', y: 2, width: 3, height: 4 }]) {
    assert.strictEqual(validRect(r), null);
  }
});

test('liste blanche des commandes média', () => {
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

test('allowedFor : chaque page n’a que ses canaux', () => {
  const url = (f) => pathToFileURL(path.join(root, f)).href;
  assert.strictEqual(pageOf(`${url('Widget.html')}?edit=1`), 'widget.html');
  assert.strictEqual(pageOf('pas une adresse'), '');
  assert.ok(allowedFor(url('settings.html'), 'spotify:logout'));
  assert.ok(allowedFor(`${url('fullscreen.html')}?veille=1`, 'veille:exit'));
  assert.ok(!allowedFor(url('controls.html'), 'spotify:logout'));
  assert.ok(!allowedFor(url('veille-black.html'), 'settings:set'));
  assert.ok(!allowedFor(url('inconnue.html'), 'settings:get'));
  assert.ok(!allowedFor(url('__proto__'), 'settings:get'));
});

test('allowedFor : seuls les paramètres lisent l’état des raccourcis clavier', () => {
  const url = (f) => pathToFileURL(path.join(root, f)).href;
  assert.ok(allowedFor(url('settings.html'), 'shortcuts:status'));
  for (const f of ['widget.html', 'fullscreen.html', 'controls.html', 'veille-black.html']) {
    assert.ok(!allowedFor(url(f), 'shortcuts:status'), f);
  }
});

test('allowedFor : la fenêtre de placement du bandeau (widget.html?place=1) peut terminer et redimensionner', () => {
  const url = `${pathToFileURL(path.join(root, 'widget.html')).href}?place=1`;
  assert.strictEqual(pageOf(url), 'widget.html');
  assert.ok(allowedFor(url, 'edit:done'));
  assert.ok(allowedFor(url, 'widget:resize'));
  assert.ok(!allowedFor(url, 'settings:set'));
});
