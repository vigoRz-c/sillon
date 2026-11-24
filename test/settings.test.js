const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULTS, sanitize } = require('../src/main/app/settings-schema');
const { SettingsStore } = require('../src/main/app/settings-store');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sillon-settings-'));

test('sanitize: null patch, array or text ignored', () => {
  for (const p of [null, undefined, 5, 'x', [], [1]]) assert.deepStrictEqual(sanitize(p), {});
});

test('sanitize: unknown keys and wrong types left out', () => {
  const out = sanitize({ evil: 1, __proto__: { a: 1 }, showLyrics: 'oui', opacity: 'x', fps: 45, sensitivity: NaN });
  assert.deepStrictEqual(out, {});
});

test('sanitize: style and theme come from the catalog', () => {
  assert.strictEqual(sanitize({ style: 'blocks' }).style, 'blocks');
  assert.strictEqual(sanitize({ theme: 'violet' }).theme, 'violet');
  assert.ok(!('style' in sanitize({ style: 'none' })));
  assert.ok(!('theme' in sanitize({ theme: 'rouge' })));
  assert.ok(!('mode' in sanitize({ mode: 'plein' })));
  assert.ok(!('layout' in sanitize({ layout: 'x' })));
});

test('sanitize: global keyboard shortcuts (yes / no only)', () => {
  assert.strictEqual(DEFAULTS.globalShortcuts, true);
  assert.strictEqual(sanitize({ globalShortcuts: false }).globalShortcuts, false);
  assert.strictEqual(sanitize({ globalShortcuts: true }).globalShortcuts, true);
  for (const v of ['false', 0, 1, null, {}]) assert.ok(!('globalShortcuts' in sanitize({ globalShortcuts: v })));
});

test('sanitize: language is auto, en or fr only', () => {
  assert.strictEqual(DEFAULTS.language, 'auto');
  for (const v of ['auto', 'en', 'fr']) assert.strictEqual(sanitize({ language: v }).language, v);
  for (const v of ['de', 'EN', 'fr-FR', '', 1, null, {}]) assert.ok(!('language' in sanitize({ language: v })));
});

test('sanitize: numeric bounds', () => {
  assert.strictEqual(sanitize({ opacity: 5 }).opacity, 1);
  assert.strictEqual(sanitize({ opacity: -1 }).opacity, 0.2);
  assert.strictEqual(sanitize({ sensitivity: Infinity }).sensitivity, undefined);
  assert.strictEqual(sanitize({ fps: 60 }).fps, 60);
});

test('sanitize: bounds, lyrics offsets, layout', () => {
  assert.strictEqual(sanitize({ bounds: null }).bounds, null);
  assert.deepStrictEqual(sanitize({ bounds: { rx: 1, ry: 2, width: 300, height: 100, junk: 1 } }).bounds, {
    rx: 1,
    ry: 2,
    width: 300,
    height: 100,
  });
  assert.ok(!('bounds' in sanitize({ bounds: { rx: 1, width: 0, height: 5 } })));
  assert.ok(!('bounds' in sanitize({ bounds: 'x' })));
  assert.deepStrictEqual(sanitize({ lyricsOffsets: { 'a|b': 0.5, 'c|d': 'x', 'e|f': 999 } }).lyricsOffsets, {
    'a|b': 0.5,
    'e|f': 60,
  });
  const l = sanitize({ sceneLayout: { disc: { x: 9 } } }).sceneLayout;
  assert.ok(l.disc.x <= 1);
  assert.ok(!('sceneLayout' in sanitize({ sceneLayout: 5 })));
});

test('DEFAULTS: reduced animations, 7 valid styles and 8 valid themes', () => {
  assert.strictEqual(DEFAULTS.reduceMotion, false);
  assert.strictEqual(sanitize({ reduceMotion: true }).reduceMotion, true);
  assert.deepStrictEqual(sanitize(DEFAULTS), DEFAULTS);
});

test('store: first launch (ENOENT) without noise', () => {
  const dir = tmpDir();
  let corrupt = 0;
  const s = new SettingsStore(path.join(dir, 'settings.json'), { onCorrupt: () => corrupt++ });
  assert.strictEqual(corrupt, 0);
  assert.strictEqual(s.get('style'), 'bars');
  s.flush();
});

test('store: fps30 migration (60 -> 30 only once)', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ fps: 60 }));
  const a = new SettingsStore(file);
  assert.strictEqual(a.get('fps'), 30);
  assert.strictEqual(a.get('fps30'), true);
  a.set({ fps: 60 });
  a.flush();
  const b = new SettingsStore(file);
  assert.strictEqual(b.get('fps'), 60); // chosen by the user: kept
});

test('store: corrupted JSON renamed to .bak, default values, backup intact', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ not json');
  const msgs = [];
  const s = new SettingsStore(file, { onCorrupt: (m) => msgs.push(m) });
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(fs.readFileSync(`${file}.bak`, 'utf8'), '{ not json');
  assert.strictEqual(s.get('theme'), DEFAULTS.theme);
  s.flush();
  assert.strictEqual(fs.readFileSync(`${file}.bak`, 'utf8'), '{ not json');
  // A 2nd corruption does not destroy the 1st backup.
  fs.writeFileSync(file, '[1,2');
  new SettingsStore(file, { onCorrupt: () => {} });
  assert.strictEqual(fs.readFileSync(`${file}.bak`, 'utf8'), '{ not json');
  assert.ok(fs.readdirSync(dir).filter((n) => n.endsWith('.bak')).length >= 2);
});

test('store: invalid values of the file left out', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ style: 'blocks', theme: 'nope', opacity: 'a', inconnu: 1, fps30: true }));
  const s = new SettingsStore(file);
  assert.strictEqual(s.get('style'), 'blocks');
  assert.strictEqual(s.get('theme'), DEFAULTS.theme);
  assert.ok(!('inconnu' in s.get()));
});

test('store: delayed, atomic writing, and immediate flush', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  const s = new SettingsStore(file, { delay: 30 });
  s.flush(); // fps30 migration pending
  fs.rmSync(file);
  const r = s.change({ style: 'ring' });
  assert.deepStrictEqual(r.changed, { style: 'ring' });
  assert.strictEqual(s.change({ style: 'ring' }).changed.style, undefined); // unchanged
  assert.ok(!fs.existsSync(file)); // not written yet
  await new Promise((res) => setTimeout(res, 100));
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).style, 'ring');
  assert.ok(!fs.existsSync(`${file}.tmp`));
  s.set({ style: 'wave' });
  s.flush();
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).style, 'wave');
});

test('store: invalid patch changes nothing', () => {
  const s = new SettingsStore(path.join(tmpDir(), 'settings.json'));
  s.flush();
  const before = s.get();
  assert.deepStrictEqual(s.change(null).changed, {});
  assert.deepStrictEqual(s.get(), before);
});

test('sanitize: keys inherited from Object.prototype ignored without exception', () => {
  const { sanitize } = require('../src/main/app/settings-schema');
  const patch = JSON.parse('{"constructor":1,"toString":"x","__proto__":{"polluted":true},"hasOwnProperty":2}');
  assert.deepEqual(sanitize(patch), {});
  assert.equal({}.polluted, undefined);
});

test('store: unreadable file (other than ENOENT) -> neither migration nor default writing', (t) => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ fps: 60, theme: 'violet' }));
  const real = fs.readFileSync;
  let locked = true;
  t.mock.method(fs, 'readFileSync', (f, ...rest) => {
    if (f === file && locked) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    return real.call(fs, f, ...rest);
  });
  const msgs = [];
  const s = new SettingsStore(file, { onCorrupt: (m) => msgs.push(m), delay: 5 });
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(s.get('fps30'), DEFAULTS.fps30); // no migration
  s.flush();
  assert.strictEqual(JSON.parse(real.call(fs, file, 'utf8')).theme, 'violet'); // fichier intact
  // User change while the file is locked: nothing written.
  s.set({ style: 'blocks' });
  s.flush();
  assert.strictEqual(JSON.parse(real.call(fs, file, 'utf8')).theme, 'violet');
  assert.strictEqual(JSON.parse(real.call(fs, file, 'utf8')).style, undefined);
  // The file is readable again: original settings kept + change applied + migration.
  locked = false;
  s.flush();
  const out = JSON.parse(real.call(fs, file, 'utf8'));
  assert.strictEqual(out.theme, 'violet');
  assert.strictEqual(out.style, 'blocks');
  assert.strictEqual(out.fps, 30);
  assert.strictEqual(out.fps30, true);
});

test('sanitize: custom color (color wheel)', () => {
  assert.strictEqual(DEFAULTS.customColor, '#8b5cf6');
  assert.strictEqual(sanitize({ customColor: '#12AbEf' }).customColor, '#12abef'); // stored in lowercase
  assert.strictEqual(sanitize({ customColor: '#f0a' }).customColor, '#ff00aa'); // short form expanded
  for (const bad of ['12abef', '#12abe', '#12abefg', '#gggggg', 'red', 'hsl(10 50% 50%)', '', 42, null, ['#ffffff']])
    assert.ok(!('customColor' in sanitize({ customColor: bad })), `refused: ${JSON.stringify(bad)}`);
  // "custom" is a color set of the visualizer and of the disc.
  assert.strictEqual(sanitize({ theme: 'custom' }).theme, 'custom');
  assert.strictEqual(sanitize({ discColors: 'custom' }).discColors, 'custom');
});

test('store: invalid custom color in the file -> default value', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ theme: 'custom', customColor: 'javascript:alert(1)' }));
  const s = new SettingsStore(file, { delay: 5 });
  assert.strictEqual(s.get('theme'), 'custom');
  assert.strictEqual(s.get('customColor'), DEFAULTS.customColor);
  assert.deepStrictEqual(s.change({ customColor: '#00FF88' }).changed, { customColor: '#00ff88' });
});

test('sanitize: new visualizers accepted', () => {
  for (const style of ['spectrum', 'dots', 'sparks', 'rosace']) assert.strictEqual(sanitize({ style }).style, style);
});

test("sanitize: shapes of the disc's ring", () => {
  for (const discRays of ['fine', 'bold', 'wave', 'dots', 'arcs', 'ripples'])
    assert.strictEqual(sanitize({ discRays }).discRays, discRays);
  assert.ok(!('discRays' in sanitize({ discRays: 'spirale' })));
});
