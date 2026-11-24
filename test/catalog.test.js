const test = require('node:test');
const assert = require('node:assert/strict');
const Catalog = require('../src/renderer/shared/catalog');
const { sanitize } = require('../src/main/app/settings-schema');

test('every fixed color set has three hexadecimal colors', () => {
  for (const id of Catalog.THEME_ORDER) {
    if (id === 'wallpaper' || id === 'album' || id === 'custom') continue;
    const pal = Catalog.PALETTES[id];
    assert.ok(Array.isArray(pal) && pal.length === 3, `palette manquante : ${id}`);
    for (const c of pal) assert.match(c, /^#[0-9a-f]{6}$/i, `${id} : ${c}`);
  }
});

test('no orphan palette and no duplicate', () => {
  assert.deepEqual(Object.keys(Catalog.PALETTES).sort(), Catalog.FIXED_THEMES.map(([id]) => id).sort());
  assert.equal(new Set(Catalog.THEME_ORDER).size, Catalog.THEME_ORDER.length);
});

test('the new sets are accepted by the settings', () => {
  assert.equal(sanitize({ theme: 'cyberpunk' }).theme, 'cyberpunk');
  assert.equal(sanitize({ discColors: 'midnight' }).discColors, 'midnight');
  assert.ok(!('discColors' in sanitize({ discColors: 'wallpaper' })));
});

test("shapes of the disc's ring: unique ids, rays first", () => {
  const ids = Catalog.DISC_RAYS.map(([id]) => id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids.slice(0, 2), ['fine', 'bold']); // values from before 0.4.2 still valid
});
