// @ts-check
// Contrôle des messages reçus des pages (IPC).
//
// Un handler ne doit obéir qu'aux pages de Sillon : l'expéditeur doit être une
// de nos fenêtres, chargée depuis le dossier des pages de l'app.

const { pathToFileURL } = require('url');

// Les commandes média acceptées (celles que comprend l'assistant natif).
const { MEDIA_COMMANDS } = require('../audio/helper-protocol');

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

// Canaux que chaque page peut envoyer au processus principal (moindre
// privilège) : la fenêtre des boutons ne peut pas déconnecter Spotify, l'écran
// noir de la veille ne peut que la quitter. Une page absente de la liste n'a
// droit à rien. test/ipc-contract.test.js vérifie que chaque page a bien les
// canaux des méthodes du pont qu'elle utilise.
const PAGE_CHANNELS = {
  'widget.html': ['settings:get', 'edit:done', 'scene:controls-rect', 'widget:resize', 'layout:cancel', 'layout:done'],
  'fullscreen.html': [
    'settings:get',
    'media:command',
    'media:volume',
    'lyrics:nudge',
    'settings:open',
    'fullscreen:close',
    'veille:exit',
  ],
  'controls.html': ['media:command', 'media:volume', 'settings:open', 'settings:set'],
  'settings.html': [
    'settings:get',
    'settings:set',
    'diagnostic:copy',
    'update:status',
    'update:check',
    'update:install',
    'spotify:status',
    'spotify:login',
    'spotify:logout',
    'spotify:dashboard',
    'layout:open',
    'edit:start',
    'bounds:reset',
    'veille:start',
    'shortcuts:status',
  ],
  'veille-black.html': ['veille:exit'],
};

// Nom du fichier de la page (« widget.html »), en minuscules ; '' si l'adresse est invalide.
function pageOf(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop()).toLowerCase();
  } catch {
    return '';
  }
}

// La page à l'adresse `url` a-t-elle le droit d'envoyer sur `channel` ?
function allowedFor(url, channel) {
  const list = Object.hasOwn(PAGE_CHANNELS, pageOf(url)) ? PAGE_CHANNELS[pageOf(url)] : null;
  return !!list && list.includes(channel);
}

module.exports = { MEDIA_COMMANDS, PAGE_CHANNELS, isAppUrl, pageOf, allowedFor, finite, validRect };
