/* Catalogue des visualiseurs et des jeux de couleurs : identifiants et libellés.
 *
 * Source unique partagée par le moteur (engine.js), le plein écran, la page des
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
  ];

  const api = {
    STYLES,
    THEMES,
    STYLE_ORDER: STYLES.map(([id]) => id),
    THEME_ORDER: THEMES.map(([id]) => id),
    STYLE_NAMES: Object.fromEntries(STYLES),
    THEME_NAMES: Object.fromEntries(THEMES),
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SillonCatalog = api;
})(typeof window !== 'undefined' ? window : globalThis);
