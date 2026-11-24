// Disk cache: TTL of "nothing found", cleanup, mtime on read.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const disk = require('../src/main/media/disk-cache');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sillon-disk-'));
const count = (dir, ns) => fs.readdirSync(path.join(dir, ns)).length;
const DAY = 24 * 3600 * 1000;

test('"nothing found" expires after 7 days, a real value does not', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ['Date'], now: 1_700_000_000_000 });
  disk.init(dir);
  await disk.set('covers', 'vide', null);
  await disk.set('covers', 'plein', 'data:image/png;base64,xx');
  t.mock.timers.tick(6 * DAY);
  assert.equal(await disk.get('covers', 'vide'), null);
  t.mock.timers.tick(2 * DAY);
  assert.equal(await disk.get('covers', 'vide'), undefined);
  assert.equal(await disk.get('covers', 'plein'), 'data:image/png;base64,xx');
});

test('prune: beyond 600 files, the oldest are deleted', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  disk.init(dir);
  const ns = path.join(dir, 'lyrics');
  fs.mkdirSync(ns, { recursive: true });
  const base = Date.now() / 1000 - 10_000;
  for (let i = 0; i < 650; i++) {
    const f = path.join(ns, `f${i}.json`);
    fs.writeFileSync(f, '{}');
    fs.utimesSync(f, base + i, base + i); // f0 = the oldest
  }
  await disk.prune('lyrics');
  assert.equal(count(dir, 'lyrics'), disk.MAX_FILES);
  assert.ok(!fs.existsSync(path.join(ns, 'f0.json')));
  assert.ok(!fs.existsSync(path.join(ns, 'f49.json')));
  assert.ok(fs.existsSync(path.join(ns, 'f50.json')));
  assert.ok(fs.existsSync(path.join(ns, 'f649.json')));
});

test('prune: also triggers every 50 writes', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  disk.init(dir);
  for (let i = 0; i < 700; i++) await disk.set('covers', `k${i}`, 'v');
  assert.ok(count(dir, 'covers') <= disk.MAX_FILES + 50, `${count(dir, 'covers')} fichiers`);
});

test('prune: missing folder or cache not initialized, without exception', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  disk.init(dir);
  await assert.doesNotReject(() => disk.prune('inexistant'));
});

test('read: updates the file date (recent entry kept)', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  disk.init(dir);
  await disk.set('covers', 'a', 'v');
  const file = path.join(dir, 'covers', fs.readdirSync(path.join(dir, 'covers'))[0]);
  const old = Date.now() / 1000 - 5000;
  fs.utimesSync(file, old, old);
  assert.equal(await disk.get('covers', 'a'), 'v');
  assert.ok(fs.statSync(file).mtimeMs > (old + 1000) * 1000);
});

test('write error: logged only once', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const blocker = path.join(dir, 'fichier');
  fs.writeFileSync(blocker, 'x'); // root "folder" that is a file: mkdir fails
  const err = t.mock.method(console, 'error', () => {});
  disk.init(blocker);
  await disk.set('covers', 'a', 'v');
  await disk.set('covers', 'b', 'v');
  await disk.set('covers', 'c', 'v');
  assert.equal(err.mock.callCount(), 1);
});

test('get: corrupted or missing entry -> undefined', async (t) => {
  const dir = tmp();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  disk.init(dir);
  await disk.set('covers', 'a', 'v');
  const d = path.join(dir, 'covers');
  const file = path.join(d, fs.readdirSync(d)[0]);
  fs.writeFileSync(file, '{not json');
  assert.equal(await disk.get('covers', 'a'), undefined);
  assert.ok(!fs.existsSync(file), 'corrupted entry deleted');
  assert.equal(await disk.get('covers', 'jamais'), undefined);
});
