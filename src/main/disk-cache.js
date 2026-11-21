// Petit cache sur disque (pochettes, paroles) : un fichier JSON par entrée,
// dans %APPDATA%/Spoti-View/cache/<espace>/. Les morceaux déjà écoutés
// s'affichent donc aussi hors ligne, et sans redemander à Deezer ou LRCLIB.
//
// Une entrée vide (rien trouvé) est gardée aussi, mais moins longtemps : un
// titre peut être ajouté plus tard sur Deezer ou LRCLIB.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MISS_TTL = 7 * 24 * 3600 * 1000; // 7 jours pour un "rien trouvé"
const MAX_FILES = 600;                 // par espace

let root = null;

function init(dir) {
  root = dir;
  for (const ns of ['covers', 'lyrics']) prune(ns);
}

const fileFor = (ns, key) => path.join(root, ns, `${crypto.createHash('sha1').update(key).digest('hex')}.json`);

// undefined : pas en cache (ou "rien trouvé" trop ancien) ; sinon la valeur (éventuellement null).
function get(ns, key) {
  if (!root) return undefined;
  try {
    const entry = JSON.parse(fs.readFileSync(fileFor(ns, key), 'utf8'));
    if (entry.value == null && Date.now() - entry.at > MISS_TTL) return undefined;
    return entry.value;
  } catch { return undefined; }
}

function set(ns, key, value) {
  if (!root) return;
  try {
    const f = fileFor(ns, key);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ at: Date.now(), key, value: value ?? null }));
  } catch (e) { console.error('Cache :', e.message); }
}

// Garde les MAX_FILES entrées les plus récentes.
function prune(ns) {
  try {
    const dir = path.join(root, ns);
    const files = fs.readdirSync(dir).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }));
    if (files.length <= MAX_FILES) return;
    files.sort((a, b) => b.t - a.t).slice(MAX_FILES).forEach(({ f }) => fs.unlinkSync(path.join(dir, f)));
  } catch { /* dossier absent : rien à faire */ }
}

module.exports = { init, get, set };
