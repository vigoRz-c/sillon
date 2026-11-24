const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const I18n = require('../src/renderer/shared/i18n');
const Catalog = require('../src/renderer/shared/catalog');
const SceneLayout = require('../src/renderer/shared/scene-layout');
const Shortcuts = require('../src/renderer/shared/shortcuts');

const { en, fr } = I18n.LOCALES;
const PAGES = path.join(__dirname, '..', 'src', 'renderer', 'pages');
const RENDERER = path.join(__dirname, '..', 'src', 'renderer');

// Names whose English text lives in catalog.js / scene-layout.js / shortcuts.js: only other languages carry them.
const isExternalName = (k) => k.startsWith('catalog.') || k.startsWith('scene.') || k.startsWith('shortcut.');

test('English and French have the same keys', () => {
  const missing = Object.keys(en).filter((k) => !Object.hasOwn(fr, k));
  const extra = Object.keys(fr).filter((k) => !Object.hasOwn(en, k) && !isExternalName(k));
  assert.deepEqual(missing, [], 'keys missing from fr.js');
  assert.deepEqual(extra, [], 'keys only in fr.js');
});

test('placeholders match between languages', () => {
  const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const k of Object.keys(en)) assert.deepEqual(holes(fr[k]), holes(en[k]), k);
});

test('French names the whole catalog, every scene element and template, and every shortcut', () => {
  for (const [kind, list] of [
    ['style', Catalog.STYLES],
    ['rays', Catalog.DISC_RAYS],
    ['theme', Catalog.THEMES],
  ]) {
    for (const [id] of list) assert.ok(Object.hasOwn(fr, `catalog.${kind}.${id}`), `catalog.${kind}.${id}`);
  }
  for (const id of SceneLayout.ORDER) assert.ok(Object.hasOwn(fr, `scene.element.${id}`), id);
  for (const id of Object.keys(SceneLayout.PRESETS)) assert.ok(Object.hasOwn(fr, `scene.preset.${id}`), id);
  for (const s of Shortcuts.SHORTCUTS) assert.ok(Object.hasOwn(fr, `shortcut.${s.id}`), s.id);
});

test('resolve: explicit setting, then the system languages, then English', () => {
  assert.equal(I18n.resolve('fr', ['en-US']), 'fr');
  assert.equal(I18n.resolve('en', ['fr-FR']), 'en');
  assert.equal(I18n.resolve('auto', ['fr-CA', 'en-US']), 'fr');
  assert.equal(I18n.resolve('auto', ['de-DE', 'fr_FR']), 'fr');
  assert.equal(I18n.resolve('auto', ['de-DE', 'es-ES']), 'en');
  assert.equal(I18n.resolve('auto', []), 'en');
  assert.equal(I18n.resolve(undefined, undefined), 'en');
  assert.equal(I18n.resolve('xx', ['FR']), 'fr');
});

test('translate: placeholders, fallback to English, then to the key', () => {
  assert.equal(I18n.translate('fr', 'volume.percent', { value: 40 }), '40 pour cent');
  assert.equal(I18n.translate('en', 'volume.percent', { value: 40 }), '40 percent');
  assert.equal(I18n.translate('de', 'common.play'), 'Play');
  assert.equal(I18n.translate('fr', 'no.such.key'), 'no.such.key');
  assert.equal(I18n.translate('en', 'volume.percent'), '{value} percent');
});

test('catalog names: English without a translation function, French with one', () => {
  assert.equal(Catalog.name('style', 'bars'), 'Bars');
  assert.equal(Catalog.name('style', 'bars', I18n.create('fr')), 'Barres');
  assert.equal(Catalog.name('theme', 'ocean', I18n.create('en')), 'Ocean');
  assert.equal(Catalog.name('style', 'unknown', I18n.create('fr')), 'unknown');
  assert.deepEqual(Catalog.list('rays', I18n.create('fr'))[0], ['fine', 'Rayons fins et serrés']);
});

test('every key used by the pages exists in English', () => {
  const files = [
    ...fs.readdirSync(PAGES).map((f) => path.join(PAGES, f)),
    ...fs.readdirSync(path.join(RENDERER, 'shared')).map((f) => path.join(RENDERER, 'shared', f)),
  ].filter((f) => /\.(html|js)$/.test(f) && !f.endsWith('i18n.js')); // i18n.js: examples in comments
  const used = new Set();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/data-i18n="([\w.]+)"/g)) used.add(m[1]);
    for (const m of src.matchAll(/data-i18n-attr="([^"]+)"/g))
      for (const pair of m[1].split(';')) used.add(pair.split(':')[1].trim());
    for (const m of src.matchAll(/i18nAttr = '([^']+)'/g))
      for (const pair of m[1].split(';')) used.add(pair.split(':')[1].trim());
    for (const m of src.matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
  }
  const missing = [...used].filter((k) => !Object.hasOwn(en, k));
  assert.deepEqual(missing, []);
  assert.ok(used.size > 50, `only ${used.size} keys found: the scan is broken`);
});

test('main process: the language setting wins, "auto" follows Windows, English otherwise', (t) => {
  const S = require('../src/main/app/state');
  const mainI18n = require('../src/main/app/i18n');
  const saved = S.settings;
  t.after(() => {
    S.settings = saved;
  });
  let language = 'fr';
  S.settings = { get: (k) => (k === 'language' ? language : undefined) };
  assert.equal(mainI18n.language(), 'fr');
  assert.equal(mainI18n.t('tray.quit'), 'Quitter');
  language = 'en';
  assert.equal(mainI18n.t('tray.quit'), 'Quit');
  language = 'auto';
  assert.equal(mainI18n.language(), 'en'); // no Windows language outside Electron
  assert.equal(I18n.resolve('auto', ['fr-CA', 'en-US']), 'fr');
});
