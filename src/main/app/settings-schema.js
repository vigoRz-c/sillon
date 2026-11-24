// @ts-check
// Settings: default values and validation, with no dependency on Electron
// (tested separately, see test/settings.test.js).

const Catalog = require('../../renderer/shared/catalog');
const SceneLayout = require('../../renderer/shared/scene-layout');
const I18n = require('../../renderer/shared/i18n');

const DEFAULTS = {
  style: 'bars', // bars | mirror | blocks | ring | halo | wave | aurora | spectrum | dots | sparks | rosace
  theme: 'wallpaper', // wallpaper | album | custom | a fixed set from the catalog (spotify, neon…)
  customColor: Catalog.CUSTOM_DEFAULT, // wheel color (#rrggbb), used by theme / discColors "custom"
  mode: 'wallpaper', // wallpaper | top | normal
  layout: 'scene', // scene (disc, lyrics, panel) | strip
  showLyrics: true,
  showPanel: true, // former setting, read by scene-layout.js as long as no layout is saved
  sceneHidden: false, // hidden by the panel button, shown again from the icon
  sceneScreen: 'primary', // primary | secondary
  gameMode: true, // stop during a full-screen game / video
  dimOnPause: true, // scene dimmed when the music is paused
  sleepAfter: 0, // minutes without music before hiding the scene (0 = never, the default)
  lyricsOffsets: {}, // lyrics offset per track ("artist|title" -> seconds)
  discIntensity: 1.3, // size of the disc's ring (0.5 to 2), no effect on the halo
  discX: 0.6, // former settings for the disc's position and size (see showPanel)
  discY: 0.45,
  discSize: 1,
  discRays: 'fine', // disc ring: fine | bold (rays) | wave | dots | arcs | ripples (catalog.js)
  discColors: 'album', // disc colors: album (cover) | custom (wheel) | a fixed set from the catalog
  discBloom: 0.8, // glow at the center of the disc (0 to 1.5)
  edgeGlow: 0.8, // glowing screen edge that pulses (0 = none, up to 2)
  panelRing: true, // rings that vibrate around the panel's cover
  showClock: true, // former clock setting (see showPanel)
  reduceMotion: false, // reduce animations and glows
  veilleDelay: 5, // minutes of inactivity before the screen saver (0 = never)
  veilleOnlyPlaying: true, // only while music is playing
  veilleLock: true, // lock the session (like Windows + L) when leaving
  spotifyCustomClientId: false, // false: Spotify app built into Sillon; true: your own
  spotifyClientId: '', // Client ID of your own Spotify app (if spotifyCustomClientId)
  bounds: null, // { rx, ry, width, height } in DIP, null = default placement
  showNowPlaying: true,
  opacity: 1,
  sensitivity: 1,
  audioSource: 'app', // analyzed sound: app (only the followed player) | system (the whole PC)
  fps: 30, // frames per second (30: much lighter, 60: smoother)
  preferApp: 'spotify', // preferred media session ('' = the one Windows puts forward)
  launchAtLogin: false,
  language: 'auto', // auto (Windows language) | en | fr
  autoUpdate: true, // look for and install new versions (installed version)
  globalShortcuts: true, // Ctrl+Alt+<key> shortcuts active everywhere (see shared/shortcuts.js)
};

// Keys accepted in addition to those of DEFAULTS.
const EXTRA_KEYS = ['sceneLayout', 'fps30'];

const ENUMS = {
  style: Catalog.STYLE_ORDER,
  theme: Catalog.THEME_ORDER,
  mode: ['wallpaper', 'top', 'normal'],
  layout: ['scene', 'strip'],
  sceneScreen: ['primary', 'secondary'],
  audioSource: ['app', 'system'],
  language: I18n.PREFERENCES,
  discRays: Catalog.DISC_RAYS.map(([id]) => id),
  discColors: ['album', 'custom', ...Catalog.FIXED_THEMES.map(([id]) => id)],
};

// [min, max] bounds of the numeric settings.
const RANGES = {
  discIntensity: [0.5, 2],
  discBloom: [0, 1.5],
  edgeGlow: [0, 2],
  sensitivity: [0.4, 2.5],
  opacity: [0.2, 1],
  discX: [0, 1],
  discY: [0, 1],
  discSize: [0.6, 1.6],
  sleepAfter: [0, 1440],
  veilleDelay: [0, 1440],
};

const MAX_STRING = 200;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const MAX_OFFSETS = 5000;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ok = (value) => ({ ok: true, value });
const no = { ok: false };

function sanitizeBounds(v) {
  if (v === null) return ok(null);
  if (!isObject(v)) return no;
  const out = {};
  for (const k of ['x', 'y', 'rx', 'ry', 'width', 'height']) {
    if (k in v) {
      const n = num(v[k]);
      if (n === null) return no;
      out[k] = n;
    }
  }
  if (!(out.width > 0) || !(out.height > 0)) return no;
  return ok(out);
}

function sanitizeOffsets(v) {
  if (!isObject(v)) return no;
  const out = {};
  let n = 0;
  for (const [k, val] of Object.entries(v)) {
    if (k === '__proto__' || num(val) === null) continue;
    if (++n > MAX_OFFSETS) break;
    out[k] = Math.max(-60, Math.min(60, val));
  }
  return ok(out);
}

// Validates a value for a key. Returns { ok, value }.
function sanitizeValue(key, v) {
  if (key === 'bounds') return sanitizeBounds(v);
  if (key === 'lyricsOffsets') return sanitizeOffsets(v);
  if (key === 'sceneLayout') return isObject(v) ? ok(SceneLayout.fromSettings({ sceneLayout: v })) : no;
  if (key === 'fps30') return typeof v === 'boolean' ? ok(v) : no;
  // "#rrggbb" color (short "#rgb" form accepted), stored in lowercase.
  if (key === 'customColor') {
    if (typeof v !== 'string') return no;
    const c = /^#[0-9a-f]{3}$/i.test(v) ? '#' + [...v.slice(1)].map((x) => x + x).join('') : v;
    return HEX_COLOR.test(c) ? ok(c.toLowerCase()) : no;
  }
  if (key === 'fps') return v === 30 || v === 60 ? ok(v) : no;
  if (Object.hasOwn(ENUMS, key)) return ENUMS[key].includes(v) ? ok(v) : no;
  const def = DEFAULTS[key];
  if (typeof def === 'boolean') return typeof v === 'boolean' ? ok(v) : no;
  if (typeof def === 'number') {
    const n = num(v);
    if (n === null) return no;
    const [min, max] = Object.hasOwn(RANGES, key) ? RANGES[key] : [-Infinity, Infinity];
    return ok(Math.max(min, Math.min(max, n)));
  }
  if (typeof def === 'string') return typeof v === 'string' && v.length <= MAX_STRING ? ok(v) : no;
  return no;
}

// Keeps from the patch only the known keys whose value is valid.
function sanitize(patch) {
  const out = {};
  if (!isObject(patch)) return out;
  for (const key of Object.keys(patch)) {
    if (!Object.hasOwn(DEFAULTS, key) && !EXTRA_KEYS.includes(key)) continue;
    const r = sanitizeValue(key, patch[key]);
    if (r.ok) out[key] = r.value;
  }
  return out;
}

module.exports = { DEFAULTS, sanitize };
