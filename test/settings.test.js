const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULTS, sanitize } = require('../src/main/app/settings-schema');
const { SettingsStore } = require('../src/main/app/settings-store');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sillon-settings-'));

test('sanitize : patch null, tableau ou texte ignorés', () => {
  for (const p of [null, undefined, 5, 'x', [], [1]]) assert.deepStrictEqual(sanitize(p), {});
});

test('sanitize : clés inconnues et types faux écartés', () => {
  const out = sanitize({ evil: 1, __proto__: { a: 1 }, showLyrics: 'oui', opacity: 'x', fps: 45, sensitivity: NaN });
  assert.deepStrictEqual(out, {});
});

test('sanitize : style et thème viennent du catalogue', () => {
  assert.strictEqual(sanitize({ style: 'blocks' }).style, 'blocks');
  assert.strictEqual(sanitize({ theme: 'violet' }).theme, 'violet');
  assert.ok(!('style' in sanitize({ style: 'none' })));
  assert.ok(!('theme' in sanitize({ theme: 'rouge' })));
  assert.ok(!('mode' in sanitize({ mode: 'plein' })));
  assert.ok(!('layout' in sanitize({ layout: 'x' })));
});

test('sanitize : bornes numériques', () => {
  assert.strictEqual(sanitize({ opacity: 5 }).opacity, 1);
  assert.strictEqual(sanitize({ opacity: -1 }).opacity, 0.2);
  assert.strictEqual(sanitize({ sensitivity: Infinity }).sensitivity, undefined);
  assert.strictEqual(sanitize({ fps: 60 }).fps, 60);
});

test('sanitize : bounds, décalages des paroles, disposition', () => {
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

test('DEFAULTS : réduction des animations, 7 styles et 8 thèmes valides', () => {
  assert.strictEqual(DEFAULTS.reduceMotion, false);
  assert.strictEqual(sanitize({ reduceMotion: true }).reduceMotion, true);
  assert.deepStrictEqual(sanitize(DEFAULTS), DEFAULTS);
});

test('store : premier lancement (ENOENT) sans bruit', () => {
  const dir = tmpDir();
  let corrupt = 0;
  const s = new SettingsStore(path.join(dir, 'settings.json'), { onCorrupt: () => corrupt++ });
  assert.strictEqual(corrupt, 0);
  assert.strictEqual(s.get('style'), 'bars');
  s.flush();
});

test('store : migration fps30 (60 -> 30 une seule fois)', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ fps: 60 }));
  const a = new SettingsStore(file);
  assert.strictEqual(a.get('fps'), 30);
  assert.strictEqual(a.get('fps30'), true);
  a.set({ fps: 60 });
  a.flush();
  const b = new SettingsStore(file);
  assert.strictEqual(b.get('fps'), 60); // choisi par l'utilisateur : conservé
});

test('store : JSON corrompu renommé en .bak, valeurs par défaut, sauvegarde intacte', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, '{ pas du json');
  const msgs = [];
  const s = new SettingsStore(file, { onCorrupt: (m) => msgs.push(m) });
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(fs.readFileSync(`${file}.bak`, 'utf8'), '{ pas du json');
  assert.strictEqual(s.get('theme'), DEFAULTS.theme);
  s.flush();
  assert.strictEqual(fs.readFileSync(`${file}.bak`, 'utf8'), '{ pas du json');
  // Une 2e corruption ne détruit pas la 1re sauvegarde.
  fs.writeFileSync(file, '[1,2');
  new SettingsStore(file, { onCorrupt: () => {} });
  assert.strictEqual(fs.readFileSync(`${file}.bak`, 'utf8'), '{ pas du json');
  assert.ok(fs.readdirSync(dir).filter((n) => n.endsWith('.bak')).length >= 2);
});

test('store : valeurs invalides du fichier écartées', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ style: 'blocks', theme: 'nope', opacity: 'a', inconnu: 1, fps30: true }));
  const s = new SettingsStore(file);
  assert.strictEqual(s.get('style'), 'blocks');
  assert.strictEqual(s.get('theme'), DEFAULTS.theme);
  assert.ok(!('inconnu' in s.get()));
});

test('store : écriture différée, atomique, et flush immédiat', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  const s = new SettingsStore(file, { delay: 30 });
  s.flush(); // migration fps30 en attente
  fs.rmSync(file);
  const r = s.change({ style: 'ring' });
  assert.deepStrictEqual(r.changed, { style: 'ring' });
  assert.strictEqual(s.change({ style: 'ring' }).changed.style, undefined); // inchangé
  assert.ok(!fs.existsSync(file)); // pas encore écrit
  await new Promise((res) => setTimeout(res, 100));
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).style, 'ring');
  assert.ok(!fs.existsSync(`${file}.tmp`));
  s.set({ style: 'wave' });
  s.flush();
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).style, 'wave');
});

test('store : patch invalide ne change rien', () => {
  const s = new SettingsStore(path.join(tmpDir(), 'settings.json'));
  s.flush();
  const before = s.get();
  assert.deepStrictEqual(s.change(null).changed, {});
  assert.deepStrictEqual(s.get(), before);
});

test('sanitize : clés héritées de Object.prototype ignorées sans exception', () => {
  const { sanitize } = require('../src/main/app/settings-schema');
  const patch = JSON.parse('{"constructor":1,"toString":"x","__proto__":{"polluted":true},"hasOwnProperty":2}');
  assert.deepEqual(sanitize(patch), {});
  assert.equal({}.polluted, undefined);
});
