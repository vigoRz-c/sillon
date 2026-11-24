// @ts-check
// Checks of the messages received from the pages (IPC).
//
// A handler must only obey Sillon's pages: the sender must be one
// of our windows, loaded from the app's pages folder.

const { pathToFileURL } = require('url');

// The accepted media commands (those the native helper understands).
const { MEDIA_COMMANDS } = require('../audio/helper-protocol');

const norm = (u) => String(u).replace(/\\/g, '/').toLowerCase();

// Is `url` an app page (file://) under the `root` folder?
function isAppUrl(url, root) {
  if (typeof url !== 'string' || !root) return false;
  const base = norm(pathToFileURL(root).href).replace(/\/+$/, '') + '/';
  return norm(url).startsWith(base);
}

// Validates a finite number in [min, max]; returns null otherwise.
function finite(v, min = -Infinity, max = Infinity) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

// Rectangle { x, y, width, height } of finite numbers, or null.
function validRect(r) {
  if (!r || typeof r !== 'object') return null;
  const { x, y, width, height } = r;
  for (const n of [x, y, width, height]) if (finite(n) === null) return null;
  return { x, y, width, height };
}

// Channels each page may send to the main process (least
// privilege): the buttons window cannot disconnect Spotify, the black
// screen of the screen saver can only leave it. A page missing from the list
// gets nothing. test/ipc-contract.test.js checks that each page has the
// channels of the bridge methods it uses.
const PAGE_CHANNELS = {
  'widget.html': [
    'i18n:language',
    'settings:get',
    'edit:done',
    'scene:controls-rect',
    'widget:resize',
    'layout:cancel',
    'layout:done',
  ],
  'fullscreen.html': [
    'i18n:language',
    'settings:get',
    'media:command',
    'media:volume',
    'lyrics:nudge',
    'settings:open',
    'fullscreen:close',
    'veille:exit',
  ],
  'controls.html': ['i18n:language', 'media:command', 'media:volume', 'settings:open', 'settings:set'],
  'settings.html': [
    'i18n:language',
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

// File name of the page ("widget.html"), lowercase; '' if the address is invalid.
function pageOf(url) {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop()).toLowerCase();
  } catch {
    return '';
  }
}

// May the page at `url` send on `channel`?
function allowedFor(url, channel) {
  const list = Object.hasOwn(PAGE_CHANNELS, pageOf(url)) ? PAGE_CHANNELS[pageOf(url)] : null;
  return !!list && list.includes(channel);
}

module.exports = { MEDIA_COMMANDS, PAGE_CHANNELS, isAppUrl, pageOf, allowedFor, finite, validRect };
