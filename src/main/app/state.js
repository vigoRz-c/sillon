// @ts-check
// Shared state of the main process.
//
// The modules (windows, current track, screen saver, queue, menu...)
// read and change this object. Calls from one module to another go through
// S.actions, filled at startup by main.js: no circular dependency.

const path = require('path');

const S = {
  settings: null, // Settings (saved settings)
  media: null, // WindowsMediaSource
  spotify: null, // SpotifyApi (queue, optional)
  tray: null,

  widget: null, // scene or strip, on the wallpaper
  attacher: null, // WallpaperAttacher of the widget
  fullscreen: null, // full screen or main screen saver
  settingsWin: null,
  controlsWin: null, // buttons of the scene panel
  controlsRect: null, // where to put them (reported by the widget page)
  editorWin: null, // scene layout editor
  placeWin: null, // strip placement window ("Move / resize")
  veilleWins: [],
  editing: false, // strip placement mode
  gamePaused: false, // a game or a video covers the scene's screen
  asleep: false, // no music for a long time: scene asleep
  renderPaused: false, // last state sent to the scene with "render-pause"

  lastMedia: { active: false },
  lastLyrics: null,
  lastQueue: { items: [], connected: false },
  playerState: null, // shuffle / repeat read from the Spotify API
  appVolume: null, // player volume in the Windows mixer (0-100)
  wallpaperSample: null,

  actions: {}, // functions shared between modules (see main.js)
};

S.RENDERER = path.join(__dirname, '..', '..', 'renderer', 'pages');
S.ASSETS = path.join(__dirname, '..', '..', '..', 'assets');
S.PRELOAD = path.join(__dirname, 'preload.js');

// Sends a message to the windows still open among those given. A
// window that dies on the way does not keep the others from receiving it.
S.send = (wins, channel, data) => {
  for (const w of wins) {
    if (!w || w.isDestroyed()) continue;
    try {
      w.webContents.send(channel, data);
    } catch (e) {
      console.error(`Could not send "${channel}":`, e.message);
    }
  }
};

S.alive = (w) => !!(w && !w.isDestroyed());

// Current track to pages. The cover (data URL of 100 to 250 KB) is only
// sent once per window: after that, as long as it does not change, the
// message only says "coverKept" and the page keeps its own (see
// common.js). full: complete send (page that has just loaded).
const coverSent = new WeakMap(); // window -> last cover sent
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

// Replays the current state in a page that has just loaded (or
// reloaded after a crash): settings, track, lyrics, queue, background.
S.replayTo = (win) => {
  if (!S.alive(win)) return;
  S.send([win], 'settings', S.settings.get());
  S.sendMedia([win], S.lastMedia, { full: true });
  if (S.lastLyrics) S.send([win], 'lyrics', S.lastLyrics);
  S.send([win], 'queue', S.lastQueue);
  if (S.wallpaperSample) S.send([win], 'wallpaper', S.wallpaperSample);
};

// Is the scene shown and alive? (visible, awake, no game)
S.sceneActive = () =>
  S.alive(S.widget) && (S.editing || (!S.settings.get('sceneHidden') && !S.gamePaused && !S.asleep));

module.exports = S;
