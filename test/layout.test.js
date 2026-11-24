const test = require('node:test');
const assert = require('node:assert');
const L = require('../src/renderer/shared/scene-layout');

test('without a saved layout: former settings taken over', () => {
  const l = L.fromSettings({
    discX: 0.65,
    discY: 0.38,
    discSize: 1.15,
    showLyrics: false,
    showPanel: false,
    showClock: true,
  });
  assert.deepStrictEqual([l.disc.x, l.disc.y, l.disc.scale], [0.65, 0.38, 1.15]);
  assert.strictEqual(l.lyrics.visible, false);
  for (const id of ['cover', 'info', 'buttons', 'queue']) assert.strictEqual(l[id].visible, false, id);
  assert.strictEqual(l.clock.visible, true);
  assert.strictEqual(l.bars.visible, false); // new element: hidden at first
});

test('empty settings: complete default layout', () => {
  const l = L.fromSettings({});
  assert.deepStrictEqual(Object.keys(l), L.ORDER);
  assert.strictEqual(l.disc.x, L.DEFAULTS.disc.x);
});

test('saved layout: used as is, the former settings are ignored', () => {
  const l = L.fromSettings({
    discX: 0.2,
    showLyrics: false,
    sceneLayout: { disc: { x: 0.3, y: 0.5, scale: 1, visible: true }, lyrics: { visible: true } },
  });
  assert.strictEqual(l.disc.x, 0.3);
  assert.strictEqual(l.lyrics.visible, true);
  assert.strictEqual(l.clock.x, L.DEFAULTS.clock.x); // missing element: default value
});

test('values out of bounds brought back into the screen and into the allowed sizes', () => {
  const l = L.fromSettings({
    sceneLayout: { disc: { x: 1.7, y: -2, scale: 9 }, lyrics: { w: 3, scale: 'x' }, bars: { h: 0 } },
  });
  assert.deepStrictEqual([l.disc.x, l.disc.y, l.disc.scale], [1, 0, L.ELEMENTS.disc.scale[1]]);
  assert.strictEqual(l.lyrics.w, L.ELEMENTS.lyrics.w[1]);
  assert.strictEqual(l.lyrics.scale, L.DEFAULTS.lyrics.scale);
  assert.strictEqual(l.bars.h, L.ELEMENTS.bars.h[0]);
});

test('templates: "Empty" hides everything, "Lyrics only" keeps the lyrics', () => {
  assert.ok(Object.values(L.preset('empty')).every((e) => !e.visible));
  const p = L.preset('lyricsOnly');
  assert.strictEqual(p.lyrics.visible, true);
  assert.strictEqual(p.disc.visible, false);
});
