/* Raccourcis clavier globaux de Sillon : identifiant, touche et libellé.
 *
 * Source unique partagée par le processus principal (enregistrement avec
 * globalShortcut, menu de l'icône) et la page des paramètres (liste lisible).
 * Tous les textes visibles des raccourcis sont ici, pour les traduire d'un coup.
 *
 * Choix des touches : toujours Ctrl+Alt+<lettre>. Pas de chiffres,
 * de ponctuation ni de E, Q ou M : sur un clavier AZERTY ou QWERTZ, Ctrl+Alt
 * équivaut à AltGr, qui tape € @ # { } [ ] | µ… Un raccourci global sur ces
 * touches empêcherait de taper ces caractères dans toutes les applis. Pas de
 * flèches non plus : Ctrl+Alt+flèche fait pivoter l'écran sur beaucoup de PC
 * (pilotes Intel). Ctrl+Alt+Suppr et Ctrl+Alt+Tab appartiennent à Windows, et
 * Ctrl+Alt+Espace est souvent pris par la saisie rapide d'une appli de bureau.
 * U, J, K se suivent sur le clavier : afficher, retarder, avancer les paroles.
 */
(function (root) {
  'use strict';

  // [identifiant, touche (accélérateur Electron), libellé], dans l'ordre de la liste des paramètres
  const LIST = [
    ['playpause', 'P', 'Lecture / pause'],
    ['next', 'N', 'Morceau suivant'],
    ['previous', 'B', 'Morceau précédent'],
    ['shuffle', 'A', 'Lecture aléatoire (avec Spotify)'],
    ['repeat', 'R', 'Répéter (avec Spotify)'],
    ['fullscreen', 'F', 'Ouvrir / fermer le plein écran'],
    ['toggleScene', 'H', 'Afficher / masquer Sillon sur le bureau'],
    ['toggleLayout', 'T', 'Passer de la scène au bandeau, et inversement'],
    ['nextStyle', 'V', 'Visualiseur suivant'],
    ['nextTheme', 'C', 'Couleurs suivantes'],
    ['veille', 'L', "Lancer l'écran de veille"],
    ['toggleLyrics', 'U', 'Afficher / masquer les paroles'],
    ['lyricsLater', 'J', 'Paroles plus tard (−0,25 s)'],
    ['lyricsEarlier', 'K', 'Paroles plus tôt (+0,25 s)'],
    ['settings', 'O', 'Ouvrir les paramètres'],
    ['sceneEditor', 'G', 'Personnaliser la scène'],
    ['placeStrip', 'D', 'Déplacer / redimensionner le bandeau'],
  ];

  const SHORTCUTS = LIST.map(([id, key, label]) => ({
    id,
    accelerator: `CommandOrControl+Alt+${key}`,
    display: `Ctrl+Alt+${key}`,
    label,
  }));

  const api = {
    SHORTCUTS,
    BY_ID: Object.fromEntries(SHORTCUTS.map((s) => [s.id, s])),
    // Autres textes : page des paramètres, journal et diagnostic du processus principal.
    TEXT: {
      taken: 'Pris par une autre application',
      takenLog: (keys) => `${keys} déjà pris par une autre application`,
      failedLog: (label, error) => `« ${label} » a échoué : ${error}`,
      fromShortcut: 'depuis un raccourci clavier',
    },
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SillonShortcuts = api;
})(typeof window !== 'undefined' ? window : globalThis);
