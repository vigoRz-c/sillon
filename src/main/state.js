// État partagé du processus principal.
//
// Les modules (fenêtres, morceau en cours, veille, file d'attente, menu...)
// lisent et modifient cet objet. Les appels d'un module à l'autre passent par
// S.actions, rempli au démarrage par main.js : pas de dépendance circulaire.

const path = require('path');

const S = {
  settings: null,          // Settings (réglages sauvegardés)
  media: null,             // WindowsMediaSource
  spotify: null,           // SpotifyApi (file d'attente, facultatif)
  tray: null,

  widget: null,            // scène ou bandeau, sur le fond d'écran
  attacher: null,          // WallpaperAttacher du widget
  fullscreen: null,        // plein écran ou écran de veille principal
  settingsWin: null,
  controlsWin: null,       // boutons du panneau de la scène
  controlsRect: null,      // où les poser (rapporté par la page du widget)
  editorWin: null,         // éditeur de disposition de la scène
  veilleWins: [],
  editing: false,          // mode placement du bandeau

  lastMedia: { active: false },
  lastLyrics: null,
  lastQueue: { items: [], connected: false },
  playerState: null,       // aléatoire / répétition lus dans l'API Spotify
  appVolume: null,        // volume du lecteur dans le mélangeur de Windows (0-100)
  wallpaperSample: null,

  actions: {},             // fonctions partagées entre modules (voir main.js)
};

S.RENDERER = path.join(__dirname, '..', 'renderer');
S.ASSETS = path.join(__dirname, '..', '..', 'assets');
S.PRELOAD = path.join(__dirname, 'preload.js');

// Envoie un message aux fenêtres encore ouvertes parmi celles données.
S.send = (wins, channel, data) => {
  for (const w of wins) if (w && !w.isDestroyed()) w.webContents.send(channel, data);
};

S.alive = (w) => !!(w && !w.isDestroyed());

module.exports = S;
