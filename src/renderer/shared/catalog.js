/* Catalogue des visualiseurs et des jeux de couleurs : identifiants et libellés.
 *
 * Source unique partagée par le moteur (engine.js, visualizers.js), le plein écran, la page des
 * réglages, le menu de l'icône (tray.js) et la validation des réglages
 * (processus principal, via require). L'ordre est celui des menus et des
 * raccourcis V / C du plein écran.
 */
(function (root) {
  'use strict';

  const STYLES = [
    ['bars', 'Barres'],
    ['mirror', 'Miroir'],
    ['blocks', 'Blocs'],
    ['ring', 'Anneau'],
    ['halo', 'Halo'],
    ['wave', 'Onde'],
    ['aurora', 'Aurore'],
    ['spectrum', 'Spectre'],
    ['dots', 'Points'],
    ['sparks', 'Étincelles'],
    ['rosace', 'Rosace'],
  ];

  const THEMES = [
    ['wallpaper', "Couleurs du fond d'écran"],
    ['album', 'Couleurs de la pochette'],
    ['spotify', 'Spotify'],
    ['neon', 'Néon'],
    ['sunset', 'Coucher de soleil'],
    ['ocean', 'Océan'],
    ['violet', 'Violet'],
    ['mono', 'Blanc'],
    // Vifs
    ['cyberpunk', 'Cyberpunk'],
    ['synthwave', 'Synthwave'],
    ['acid', 'Acide'],
    // Doux
    ['pastel', 'Pastel'],
    ['lavender', 'Lavande'],
    ['peach', 'Pêche'],
    ['mint', 'Menthe'],
    // Naturels
    ['forest', 'Forêt'],
    ['fire', 'Braise'],
    ['ice', 'Glace'],
    ['desert', 'Désert'],
    // Sombres
    ['gold', 'Or et noir'],
    ['blood', 'Rouge sang'],
    ['midnight', 'Minuit'],
    // Choisie à la roue des couleurs (réglage customColor) : palette calculée.
    ['custom', 'Couleur personnalisée'],
  ];

  // Trois couleurs par jeu : principale (lueurs, halo), secondaire, éclat.
  // « wallpaper » et « album » sont calculés à partir de l'image, « custom » à
  // partir de la couleur choisie (voir paletteFromCustom dans colors.js).
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
    THEMES,
    PALETTES,
    // Jeux fixes (sans « wallpaper » ni « album ») : couleurs possibles du disque.
    FIXED_THEMES: THEMES.filter(([id]) => Object.hasOwn(PALETTES, id)),
    // Couleur par défaut de la roue des couleurs (réglage customColor).
    CUSTOM_DEFAULT: '#8b5cf6',
    STYLE_ORDER: STYLES.map(([id]) => id),
    THEME_ORDER: THEMES.map(([id]) => id),
    STYLE_NAMES: Object.fromEntries(STYLES),
    THEME_NAMES: Object.fromEntries(THEMES),
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SillonCatalog = api;
})(typeof window !== 'undefined' ? window : globalThis);
