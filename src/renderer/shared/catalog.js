/* Catalog of the visualizers and color sets: ids and English names.
 *
 * Single source shared by the engine (engine.js, visualizers.js), the full
 * screen, the settings page, the tray menu (tray.js) and settings validation
 * (main process, via require). The order is that of the menus and of the
 * full screen's V / C shortcuts. Other languages translate the names with the
 * catalog.style.*, catalog.rays.* and catalog.theme.* keys (see name()).
 */
(function (root) {
  'use strict';

  const STYLES = [
    ['bars', 'Bars'],
    ['mirror', 'Mirror'],
    ['blocks', 'Blocks'],
    ['ring', 'Ring'],
    ['halo', 'Halo'],
    ['wave', 'Wave'],
    ['aurora', 'Aurora'],
    ['spectrum', 'Spectrum'],
    ['dots', 'Dots'],
    ['sparks', 'Sparks'],
    ['rosace', 'Rosette'],
  ];

  // Ring of the scene's and screen saver's disc (discRays setting).
  const DISC_RAYS = [
    ['fine', 'Fine, tight rays'],
    ['bold', 'Thick, spaced rays'],
    ['wave', 'Wave'],
    ['dots', 'Dots'],
    ['arcs', 'Arcs'],
    ['ripples', 'Ripples'],
  ];

  const THEMES = [
    ['wallpaper', 'Wallpaper colors'],
    ['album', 'Album cover colors'],
    ['spotify', 'Spotify'],
    ['neon', 'Neon'],
    ['sunset', 'Sunset'],
    ['ocean', 'Ocean'],
    ['violet', 'Violet'],
    ['mono', 'White'],
    // Bright
    ['cyberpunk', 'Cyberpunk'],
    ['synthwave', 'Synthwave'],
    ['acid', 'Acid'],
    // Soft
    ['pastel', 'Pastel'],
    ['lavender', 'Lavender'],
    ['peach', 'Peach'],
    ['mint', 'Mint'],
    // Natural
    ['forest', 'Forest'],
    ['fire', 'Embers'],
    ['ice', 'Ice'],
    ['desert', 'Desert'],
    // Dark
    ['gold', 'Gold and black'],
    ['blood', 'Blood red'],
    ['midnight', 'Midnight'],
    // Picked on the color wheel (customColor setting): computed palette.
    ['custom', 'Custom color'],
  ];

  // Three colors per set: main (glows, halo), secondary, highlight.
  // "wallpaper" and "album" are computed from the image, "custom" from the
  // picked color (see paletteFromCustom in colors.js).
  const PALETTES = {
    spotify: ['#1db954', '#1ed760', '#b8f5cf'],
    neon: ['#7c3aed', '#ec4899', '#22d3ee'],
    sunset: ['#f97316', '#ef4444', '#facc15'],
    ocean: ['#0ea5e9', '#6366f1', '#5eead4'],
    mono: ['#e5e7eb', '#ffffff', '#cbd5e1'],
    violet: ['#a855f7', '#ec4899', '#f0abfc'],
    cyberpunk: ['#ff2a6d', '#05d9e8', '#d1f7ff'],
    synthwave: ['#f72585', '#7209b7', '#4cc9f0'],
    acid: ['#a3e635', '#facc15', '#ecfccb'],
    pastel: ['#f9a8d4', '#a5b4fc', '#99f6e4'],
    lavender: ['#a78bfa', '#c4b5fd', '#ede9fe'],
    peach: ['#fb923c', '#fda4af', '#fed7aa'],
    mint: ['#34d399', '#5eead4', '#d1fae5'],
    forest: ['#16a34a', '#65a30d', '#bef264'],
    fire: ['#dc2626', '#f97316', '#fde047'],
    ice: ['#38bdf8', '#7dd3fc', '#e0f2fe'],
    desert: ['#d97706', '#b45309', '#fde68a'],
    gold: ['#ca8a04', '#eab308', '#fef08a'],
    blood: ['#b91c1c', '#7f1d1d', '#fca5a5'],
    midnight: ['#2563eb', '#1e40af', '#93c5fd'],
  };

  const api = {
    STYLES,
    DISC_RAYS,
    THEMES,
    PALETTES,
    // Fixed sets (without "wallpaper" and "album"): possible disc colors.
    FIXED_THEMES: THEMES.filter(([id]) => Object.hasOwn(PALETTES, id)),
    // Default color of the color wheel (customColor setting).
    CUSTOM_DEFAULT: '#8b5cf6',
    STYLE_ORDER: STYLES.map(([id]) => id),
    THEME_ORDER: THEMES.map(([id]) => id),
    STYLE_NAMES: Object.fromEntries(STYLES),
    THEME_NAMES: Object.fromEntries(THEMES),
  };

  // Name of a style, disc ring or color set (kind: 'style' | 'rays' | 'theme')
  // in the language of `t` (a SillonI18n translate function); English without `t`.
  const LISTS = { style: STYLES, rays: DISC_RAYS, theme: THEMES };
  api.name = (kind, id, t) => {
    const entry = (LISTS[kind] || []).find(([k]) => k === id);
    const english = entry ? entry[1] : id;
    if (!t) return english;
    const key = `catalog.${kind}.${id}`;
    const s = t(key);
    return s === key ? english : s;
  };
  // [id, name] pairs of a list, translated.
  api.list = (kind, t) => (LISTS[kind] || []).map(([id]) => [id, api.name(kind, id, t)]);

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SillonCatalog = api;
})(typeof window !== 'undefined' ? window : globalThis);
