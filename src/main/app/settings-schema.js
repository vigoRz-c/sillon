// @ts-check
// Réglages : valeurs par défaut et validation, sans dépendance à Electron
// (testé à part, voir test/settings.test.js).

const Catalog = require('../../renderer/shared/catalog');
const SceneLayout = require('../../renderer/shared/scene-layout');

const DEFAULTS = {
  style: 'bars', // bars | mirror | blocks | ring | halo | wave | aurora | spectrum | dots | sparks | rosace
  theme: 'wallpaper', // wallpaper | album | custom | un jeu fixe du catalogue (spotify, neon…)
  customColor: Catalog.CUSTOM_DEFAULT, // couleur de la roue (#rrggbb), utilisée par theme / discColors « custom »
  mode: 'wallpaper', // wallpaper | top | normal
  layout: 'scene', // scene (disque, paroles, panneau) | strip (bandeau)
  showLyrics: true,
  showPanel: true, // ancien réglage, lu par scene-layout.js tant qu'il n'y a pas de disposition enregistrée
  sceneHidden: false, // masquée par le bouton du panneau, réaffichée depuis l'icône
  sceneScreen: 'primary', // primary | secondary
  gameMode: true, // s'arrêter pendant un jeu / une vidéo en plein écran
  dimOnPause: true, // scène atténuée quand la musique est en pause
  sleepAfter: 0, // minutes sans musique avant de masquer la scène (0 = jamais, par défaut)
  lyricsOffsets: {}, // décalage des paroles par morceau ("artiste|titre" -> secondes)
  discIntensity: 1.3, // taille de l'anneau du disque (0,5 à 2), sans effet sur le halo
  discX: 0.6, // anciens réglages de position et taille du disque (voir showPanel)
  discY: 0.45,
  discSize: 1,
  discRays: 'fine', // anneau du disque : fine | bold (rayons) | wave | dots | arcs | ripples (catalog.js)
  discColors: 'album', // couleurs du disque : album (pochette) | custom (roue) | un jeu fixe du catalogue
  discBloom: 0.8, // lueur au centre du disque (0 à 1,5)
  edgeGlow: 0.8, // bord de l'écran lumineux qui pulse (0 = aucun, jusqu'à 2)
  panelRing: true, // anneaux qui vibrent autour de la pochette du panneau
  showClock: true, // ancien réglage de l'horloge (voir showPanel)
  reduceMotion: false, // réduire les animations et les lueurs
  veilleDelay: 5, // minutes d'inactivité avant l'écran de veille (0 = jamais)
  veilleOnlyPlaying: true, // seulement quand de la musique joue
  veilleLock: true, // verrouiller la session (comme Windows + L) en sortant
  spotifyCustomClientId: false, // false : app Spotify intégrée à Sillon ; true : la sienne
  spotifyClientId: '', // Client ID de sa propre app Spotify (si spotifyCustomClientId)
  bounds: null, // { rx, ry, width, height } en DIP, null = placement par défaut
  showNowPlaying: true,
  opacity: 1,
  sensitivity: 1,
  audioSource: 'app', // son analysé : app (seulement le lecteur suivi) | system (tout le PC)
  fps: 30, // images par seconde (30 : bien plus léger, 60 : plus fluide)
  preferApp: 'spotify', // session média préférée ('' = celle que Windows met en avant)
  launchAtLogin: false,
  autoUpdate: true, // chercher et installer les nouvelles versions (version installée)
};

// Clés acceptées en plus de celles de DEFAULTS.
const EXTRA_KEYS = ['sceneLayout', 'fps30'];

const ENUMS = {
  style: Catalog.STYLE_ORDER,
  theme: Catalog.THEME_ORDER,
  mode: ['wallpaper', 'top', 'normal'],
  layout: ['scene', 'strip'],
  sceneScreen: ['primary', 'secondary'],
  audioSource: ['app', 'system'],
  discRays: Catalog.DISC_RAYS.map(([id]) => id),
  discColors: ['album', 'custom', ...Catalog.FIXED_THEMES.map(([id]) => id)],
};

// Bornes [min, max] des réglages numériques.
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

// Valide une valeur pour une clé. Renvoie { ok, value }.
function sanitizeValue(key, v) {
  if (key === 'bounds') return sanitizeBounds(v);
  if (key === 'lyricsOffsets') return sanitizeOffsets(v);
  if (key === 'sceneLayout') return isObject(v) ? ok(SceneLayout.fromSettings({ sceneLayout: v })) : no;
  if (key === 'fps30') return typeof v === 'boolean' ? ok(v) : no;
  // Couleur « #rrggbb » (forme courte « #rgb » acceptée), rangée en minuscules.
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

// Ne garde du patch que les clés connues dont la valeur est valide.
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
