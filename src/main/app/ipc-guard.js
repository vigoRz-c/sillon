// Contrôle des messages reçus des pages (IPC).
//
// Un handler ne doit obéir qu'aux pages de Sillon : l'expéditeur doit être une
// de nos fenêtres, chargée depuis le dossier des pages de l'app.

const { pathToFileURL } = require('url');

// Les commandes média acceptées (celles que comprend l'assistant natif).
const MEDIA_COMMANDS = ['playpause', 'play', 'pause', 'next', 'previous', 'shuffle', 'repeat'];

const norm = (u) => String(u).replace(/\\/g, '/').toLowerCase();

// `url` est-elle une page de l'app (file://) sous le dossier `root` ?
function isAppUrl(url, root) {
  if (typeof url !== 'string' || !root) return false;
  const base = norm(pathToFileURL(root).href).replace(/\/+$/, '') + '/';
  return norm(url).startsWith(base);
}

// Valide un nombre fini dans [min, max] ; renvoie null sinon.
function finite(v, min = -Infinity, max = Infinity) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

// Rectangle { x, y, width, height } de nombres finis, ou null.
function validRect(r) {
  if (!r || typeof r !== 'object') return null;
  const { x, y, width, height } = r;
  for (const n of [x, y, width, height]) if (finite(n) === null) return null;
  return { x, y, width, height };
}

module.exports = { MEDIA_COMMANDS, isAppUrl, finite, validRect };
