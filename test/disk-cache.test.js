// Cache disque : TTL du « rien trouvé », nettoyage, mtime à la lecture.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const disk = require('../src/main/media/disk-cache');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sillon-disk-'));
const count = (dir, ns) => fs.readdirSync(path.join(dir, ns)).length;
const DAY = 24 * 3600 * 1000;

test('« rien trouvé » expire après 7 jours, une vraie valeur non', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  disk.init(dir);
  disk.set('covers', 'vide', null);
  disk.set('covers', 'plein', 'data:image/png;base64,xx');
  t.mock.timers.tick(6 * DAY);
  assert.equal(disk.get('covers', 'vide'), null);
  t.mock.timers.tick(2 * DAY);
  assert.equal(disk.get('covers', 'vide'), undefined);
  assert.equal(disk.get('covers', 'plein'), 'data:image/png;base64,xx');
});

test('prune : au-delà de 600 fichiers, les plus anciens sont supprimés', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  disk.init(dir);
  const ns = path.join(dir, 'lyrics');
  fs.mkdirSync(ns, { recursive: true });
  const base = Date.now() / 1000 - 10_000;
  for (let i = 0; i < 650; i++) {
    const f = path.join(ns, `f${i}.json`);
    fs.writeFileSync(f, '{}');
    fs.utimesSync(f, base + i, base + i); // f0 = le plus ancien
  }
  disk.prune('lyrics');
  assert.equal(count(dir, 'lyrics'), disk.MAX_FILES);
  assert.ok(!fs.existsSync(path.join(ns, 'f0.json')));
  assert.ok(!fs.existsSync(path.join(ns, 'f49.json')));
  assert.ok(fs.existsSync(path.join(ns, 'f50.json')));
  assert.ok(fs.existsSync(path.join(ns, 'f649.json')));
});

test('prune : se déclenche aussi toutes les 50 écritures', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  disk.init(dir);
  for (let i = 0; i < 700; i++) disk.set('covers', `k${i}`, 'v');
  assert.ok(count(dir, 'covers') <= disk.MAX_FILES + 50, `${count(dir, 'covers')} fichiers`);
});

test('prune : dossier absent ou cache non initialisé, sans exception', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  disk.init(dir);
  assert.doesNotThrow(() => disk.prune('inexistant'));
});

test('lecture : met à jour la date du fichier (entrée récente gardée)', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  disk.init(dir);
  disk.set('covers', 'a', 'v');
  const file = path.join(dir, 'covers', fs.readdirSync(path.join(dir, 'covers'))[0]);
  const old = Date.now() / 1000 - 5000;
  fs.utimesSync(file, old, old);
  assert.equal(disk.get('covers', 'a'), 'v');
  assert.ok(fs.statSync(file).mtimeMs > (old + 1000) * 1000);
});

test("erreur d'écriture : journalisée une seule fois", (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const blocker = path.join(dir, 'fichier');
  fs.writeFileSync(blocker, 'x'); // « dossier » racine qui est un fichier : mkdir échoue
  const err = t.mock.method(console, 'error', () => {});
  disk.init(blocker);
  disk.set('covers', 'a', 'v');
  disk.set('covers', 'b', 'v');
  disk.set('covers', 'c', 'v');
  assert.equal(err.mock.callCount(), 1);
});

test('get : entrée corrompue ou absente -> undefined', (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  disk.init(dir);
  disk.set('covers', 'a', 'v');
  const d = path.join(dir, 'covers');
  fs.writeFileSync(path.join(d, fs.readdirSync(d)[0]), '{pas du json');
  assert.equal(disk.get('covers', 'a'), undefined);
  assert.equal(disk.get('covers', 'jamais'), undefined);
});
