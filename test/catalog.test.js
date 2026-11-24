const test = require('node:test');
const assert = require('node:assert/strict');
const Catalog = require('../src/renderer/shared/catalog');
const { sanitize } = require('../src/main/app/settings-schema');

test('chaque jeu de couleurs fixe a trois couleurs hexadécimales', () => {
  for (const id of Catalog.THEME_ORDER) {
    if (id === 'wallpaper' || id === 'album' || id === 'custom') continue;
    const pal = Catalog.PALETTES[id];
    assert.ok(Array.isArray(pal) && pal.length === 3, `palette manquante : ${id}`);
    for (const c of pal) assert.match(c, /^#[0-9a-f]{6}$/i, `${id} : ${c}`);
  }
});

test('pas de palette orpheline ni de doublon', () => {
  assert.deepEqual(Object.keys(Catalog.PALETTES).sort(), Catalog.FIXED_THEMES.map(([id]) => id).sort());
  assert.equal(new Set(Catalog.THEME_ORDER).size, Catalog.THEME_ORDER.length);
});

test('les nouveaux jeux sont acceptés par les réglages', () => {
  assert.equal(sanitize({ theme: 'cyberpunk' }).theme, 'cyberpunk');
  assert.equal(sanitize({ discColors: 'midnight' }).discColors, 'midnight');
  assert.ok(!('discColors' in sanitize({ discColors: 'wallpaper' })));
});
