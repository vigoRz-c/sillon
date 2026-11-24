// @ts-check
// Small disk cache (covers, lyrics): one JSON file per entry,
// in %APPDATA%/Sillon/cache/<space>/. Tracks already listened to
// therefore also show offline, without asking Deezer or LRCLIB again.
//
// An empty entry (nothing found) is kept too, but for less time: a
// title may be added later on Deezer or LRCLIB.

const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { note } = require('./text-norm');

const MISS_TTL = 7 * 24 * 3600 * 1000; // 7 days for a "nothing found"
const MAX_FILES = 600; // par espace
const PRUNE_EVERY = 50; // writes between two cleanups

let root = null;
let writeErrorLogged = false;
const writes = {}; // space -> writes since the last cleanup

function init(dir) {
  root = dir;
  writeErrorLogged = false;
  for (const k of Object.keys(writes)) delete writes[k];
  // Cleanup at startup: in the background, without delaying the launch.
  for (const ns of ['covers', 'lyrics']) prune(ns);
}

const fileFor = (ns, key) => path.join(root, ns, `${crypto.createHash('sha1').update(key).digest('hex')}.json`);

// Asynchronous reads and writes: the main process relays the sound
// every 30 ms, a synchronous disk access would delay it.

// undefined: not cached (or a "nothing found" that is too old); otherwise the value (possibly null).
async function get(ns, key) {
  if (!root) return undefined;
  const file = fileFor(ns, key);
  let entry;
  try {
    entry = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (e) {
    // Unreadable entry (interrupted write, damaged disk): deleted, otherwise it
    // would be read and rejected every time.
    if (e.code !== 'ENOENT') await fsp.unlink(file).catch(() => {});
    return undefined;
  }
  if (!entry || typeof entry !== 'object') return undefined;
  if (entry.value == null && Date.now() - entry.at > MISS_TTL) return undefined;
  // Read = recent: the cleanup keeps the most listened entries.
  const now = new Date();
  await fsp.utimes(file, now, now).catch(() => {}); // simple optimisation
  return entry.value;
}

async function set(ns, key, value) {
  if (!root) return;
  try {
    const f = fileFor(ns, key);
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.writeFile(f, JSON.stringify({ at: Date.now(), key, value: value ?? null }));
  } catch (e) {
    if (!writeErrorLogged) {
      writeErrorLogged = true; // only once: a full disk must not flood the log
      console.error('Cache :', e.message);
      note('cache', e.message);
    }
    return;
  }
  writes[ns] = (writes[ns] || 0) + 1;
  if (writes[ns] >= PRUNE_EVERY) {
    writes[ns] = 0;
    await prune(ns);
  }
}

// Keeps the MAX_FILES most recent entries (write or read).
async function prune(ns) {
  if (!root) return;
  const dir = path.join(root, ns);
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return; // missing folder: nothing to do
  }
  if (names.length <= MAX_FILES) return;
  const files = [];
  for (const f of names) {
    try {
      files.push({ f, t: (await fsp.stat(path.join(dir, f))).mtimeMs });
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('Cache :', e.message);
    }
  }
  const old = files.sort((a, b) => b.t - a.t).slice(MAX_FILES);
  for (const { f } of old) {
    try {
      await fsp.unlink(path.join(dir, f));
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('Cache :', e.message);
    }
  }
}

module.exports = { init, get, set, prune, MAX_FILES };
