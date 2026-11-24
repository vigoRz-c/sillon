// @ts-check
// État partagé du processus principal.
//
// Les modules (fenêtres, morceau en cours, veille, file d'attente, menu...)
// lisent et modifient cet objet. Les appels d'un module à l'autre passent par
// S.actions, rempli au démarrage par main.js : pas de dépendance circulaire.

const path = require('path');

const S = {
  settings: null, // Settings (réglages sauvegardés)
  media: null, // WindowsMediaSource
  spotify: null, // SpotifyApi (file d'attente, facultatif)
  tray: null,

  widget: null, // scène ou bandeau, sur le fond d'écran
  attacher: null, // WallpaperAttacher du widget
  fullscreen: null, // plein écran ou écran de veille principal
  settingsWin: null,
  controlsWin: null, // boutons du panneau de la scène
  controlsRect: null, // où les poser (rapporté par la page du widget)
  editorWin: null, // éditeur de disposition de la scène
  placeWin: null, // fenêtre de placement du bandeau (« Déplacer / redimensionner »)
  veilleWins: [],
  editing: false, // mode placement du bandeau
  gamePaused: false, // un jeu ou une vidéo couvre l'écran de la scène
  asleep: false, // aucune musique depuis longtemps : scène endormie
  renderPaused: false, // dernier état envoyé à la scène par « render-pause »

  lastMedia: { active: false },
  lastLyrics: null,
  lastQueue: { items: [], connected: false },
  playerState: null, // aléatoire / répétition lus dans l'API Spotify
  appVolume: null, // volume du lecteur dans le mélangeur de Windows (0-100)
  wallpaperSample: null,

  actions: {}, // fonctions partagées entre modules (voir main.js)
};

S.RENDERER = path.join(__dirname, '..', '..', 'renderer', 'pages');
S.ASSETS = path.join(__dirname, '..', '..', '..', 'assets');
S.PRELOAD = path.join(__dirname, 'preload.js');

// Envoie un message aux fenêtres encore ouvertes parmi celles données. Une
// fenêtre qui meurt en route n'empêche pas les autres de le recevoir.
S.send = (wins, channel, data) => {
  for (const w of wins) {
    if (!w || w.isDestroyed()) continue;
    try {
      w.webContents.send(channel, data);
    } catch (e) {
      console.error(`Envoi « ${channel} » impossible :`, e.message);
    }
  }
};

S.alive = (w) => !!(w && !w.isDestroyed());

// Morceau en cours vers des pages. La pochette (data URL de 100 à 250 Ko) n'est
// envoyée qu'une fois par fenêtre : ensuite, tant qu'elle ne change pas, le
// message dit seulement « coverKept » et la page garde la sienne (voir
// common.js). full : envoi complet (page qui vient de se charger).
const coverSent = new WeakMap(); // fenêtre -> dernière pochette envoyée
S.sendMedia = (wins, m, { full = false } = {}) => {
  for (const w of wins) {
    if (!S.alive(w)) continue;
    if (!full && m.cover && coverSent.get(w) === m.cover) {
      S.send([w], 'media', { ...m, cover: undefined, coverKept: true });
    } else {
      coverSent.set(w, m.cover);
      S.send([w], 'media', m);
    }
  }
};

// Rejoue l'état courant dans une page qui vient de se charger (ou de se
// recharger après un plantage) : réglages, morceau, paroles, file, fond.
S.replayTo = (win) => {
  if (!S.alive(win)) return;
  S.send([win], 'settings', S.settings.get());
  S.sendMedia([win], S.lastMedia, { full: true });
  if (S.lastLyrics) S.send([win], 'lyrics', S.lastLyrics);
  S.send([win], 'queue', S.lastQueue);
  if (S.wallpaperSample) S.send([win], 'wallpaper', S.wallpaperSample);
};

// La scène est-elle affichée et vivante ? (visible, éveillée, pas de jeu)
S.sceneActive = () =>
  S.alive(S.widget) && (S.editing || (!S.settings.get('sceneHidden') && !S.gamePaused && !S.asleep));

module.exports = S;
