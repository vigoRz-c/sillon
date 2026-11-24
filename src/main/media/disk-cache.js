// @ts-check
// Petit cache sur disque (pochettes, paroles) : un fichier JSON par entrée,
// dans %APPDATA%/Sillon/cache/<espace>/. Les morceaux déjà écoutés
// s'affichent donc aussi hors ligne, et sans redemander à Deezer ou LRCLIB.
//
// Une entrée vide (rien trouvé) est gardée aussi, mais moins longtemps : un
// titre peut être ajouté plus tard sur Deezer ou LRCLIB.

const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { note } = require('./text-norm');

const MISS_TTL = 7 * 24 * 3600 * 1000; // 7 jours pour un "rien trouvé"
const MAX_FILES = 600; // par espace
const PRUNE_EVERY = 50; // écritures entre deux nettoyages

let root = null;
let writeErrorLogged = false;
const writes = {}; // espace -> écritures depuis le dernier nettoyage

function init(dir) {
  root = dir;
  writeErrorLogged = false;
  for (const k of Object.keys(writes)) delete writes[k];
  // Nettoyage au démarrage : en tâche de fond, sans retarder le lancement.
  for (const ns of ['covers', 'lyrics']) prune(ns);
}

const fileFor = (ns, key) => path.join(root, ns, `${crypto.createHash('sha1').update(key).digest('hex')}.json`);

// Lectures et écritures asynchrones : le processus principal relaie le son
// toutes les 30 ms, un accès disque synchrone le retarderait.

// undefined : pas en cache (ou "rien trouvé" trop ancien) ; sinon la valeur (éventuellement null).
async function get(ns, key) {
  if (!root) return undefined;
  const file = fileFor(ns, key);
  let entry;
  try {
    entry = JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch (e) {
    // Entrée illisible (écriture coupée, disque abîmé) : supprimée, sinon elle
    // serait relue et rejetée à chaque fois.
    if (e.code !== 'ENOENT') await fsp.unlink(file).catch(() => {});
    return undefined;
  }
  if (!entry || typeof entry !== 'object') return undefined;
  if (entry.value == null && Date.now() - entry.at > MISS_TTL) return undefined;
  // Lue = récente : le nettoyage garde les entrées les plus écoutées.
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
      writeErrorLogged = true; // une seule fois : le disque plein ne doit pas saturer le journal
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

// Garde les MAX_FILES entrées les plus récentes (écriture ou lecture).
async function prune(ns) {
  if (!root) return;
  const dir = path.join(root, ns);
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return; // dossier absent : rien à faire
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
