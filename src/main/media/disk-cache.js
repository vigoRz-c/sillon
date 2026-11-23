// Petit cache sur disque (pochettes, paroles) : un fichier JSON par entrée,
// dans %APPDATA%/Sillon/cache/<espace>/. Les morceaux déjà écoutés
// s'affichent donc aussi hors ligne, et sans redemander à Deezer ou LRCLIB.
//
// Une entrée vide (rien trouvé) est gardée aussi, mais moins longtemps : un
// titre peut être ajouté plus tard sur Deezer ou LRCLIB.

const fs = require('fs');
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
  for (const ns of ['covers', 'lyrics']) prune(ns);
}

const fileFor = (ns, key) => path.join(root, ns, `${crypto.createHash('sha1').update(key).digest('hex')}.json`);

// undefined : pas en cache (ou "rien trouvé" trop ancien) ; sinon la valeur (éventuellement null).
function get(ns, key) {
  if (!root) return undefined;
  try {
    const file = fileFor(ns, key);
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (entry.value == null && Date.now() - entry.at > MISS_TTL) return undefined;
    // Lue = récente : le nettoyage garde les entrées les plus écoutées.
    try {
      const now = new Date();
      fs.utimesSync(file, now, now);
    } catch {
      /* simple optimisation */
    }
    return entry.value;
  } catch {
    return undefined;
  }
}

function set(ns, key, value) {
  if (!root) return;
  try {
    const f = fileFor(ns, key);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ at: Date.now(), key, value: value ?? null }));
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
    prune(ns);
  }
}

// Garde les MAX_FILES entrées les plus récentes (écriture ou lecture).
function prune(ns) {
  if (!root) return;
  let dir, names;
  try {
    dir = path.join(root, ns);
    names = fs.readdirSync(dir);
  } catch {
    return; // dossier absent : rien à faire
  }
  if (names.length <= MAX_FILES) return;
  const files = [];
  for (const f of names) {
    try {
      files.push({ f, t: fs.statSync(path.join(dir, f)).mtimeMs });
    } catch (e) {
      if (e.code !== 'ENOENT') console.error('Cache :', e.message);
    }
  }
  files
    .sort((a, b) => b.t - a.t)
    .slice(MAX_FILES)
    .forEach(({ f }) => {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch (e) {
        if (e.code !== 'ENOENT') console.error('Cache :', e.message);
      }
    });
}

module.exports = { init, get, set, prune, MAX_FILES };
