// Spoti-View : processus principal.
//
// Ce fichier assemble les modules, gère les réglages, la communication avec
// les pages (IPC) et le démarrage. Le reste est rangé par thème :
//   widget-window.js    scène / bandeau sur le fond d'écran
//   controls-window.js  boutons du panneau de la scène
//   windows.js          plein écran et paramètres
//   veille.js           écran de veille
//   now-playing.js      morceau en cours, pochette, paroles
//   queue.js            file d'attente (API Spotify)
//   capture.js          son du système, couleurs du fond d'écran
//   tray.js             menu de l'icône
//   state.js            état partagé

const { app, ipcMain, screen, globalShortcut, shell } = require('electron');
const path = require('path');
const S = require('./state');
const { Settings } = require('./settings');
const diskCache = require('./disk-cache');
const { fullscreenAppRunning, foregroundRect } = require('./wallpaper');
const widgetWindow = require('./widget-window');
const { updateControls } = require('./controls-window');
const capture = require('./capture');
const windows = require('./windows');
const veille = require('./veille');
const nowPlaying = require('./now-playing');
const queue = require('./queue');
const { buildTray } = require('./tray');

if (!app.requestSingleInstanceLock()) app.quit();

// ---------- Réglages ----------

function updateSettings(patch) {
  const all = S.settings.set(patch);
  S.send([S.widget, S.fullscreen, S.settingsWin], 'settings', all);
  if ('mode' in patch || 'layout' in patch || 'sceneHidden' in patch || 'sceneScreen' in patch) {
    widgetWindow.applyMode();
    setTimeout(capture.sampleWallpaper, 1200);
  }
  if ('showPanel' in patch) updateControls();
  if ('preferApp' in patch && S.media) S.media.setPreferredApp(patch.preferApp);
  if ('launchAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin });
  buildTray();
}

// Fonctions partagées entre modules (voir state.js).
Object.assign(S.actions, {
  updateSettings, buildTray, updateControls,
  isScene: widgetWindow.isScene, widgetBounds: widgetWindow.widgetBounds,
  applyMode: widgetWindow.applyMode, setEditing: widgetWindow.setEditing,
  startAudio: capture.startAudio, sampleWallpaper: capture.sampleWallpaper,
  startWallpaperSampling: capture.startWallpaperSampling,
  toggleFullscreen: windows.toggleFullscreen, openSettings: windows.openSettings,
  startVeille: veille.startVeille,
  refreshQueue: queue.refreshQueue,
  lyricsOffsetFor: nowPlaying.lyricsOffsetFor, nudgeLyrics: nowPlaying.nudgeLyrics,
});

// ---------- Mode jeu ----------
// Un jeu, une vidéo ou une présentation en plein écran cache le bureau : la
// scène s'arrête de dessiner (et d'analyser le son) jusqu'à leur fermeture.

// Windows dit seulement « une appli est en plein écran », sans dire où : on
// vérifie que la fenêtre au premier plan couvre bien l'écran de la scène
// (sinon un plein écran sur l'autre écran arrêterait la scène à tort).
function coversSceneScreen() {
  const r = foregroundRect();
  if (!r || !S.alive(S.widget)) return false;
  const fg = screen.screenToDipRect(null, r);
  const d = screen.getDisplayMatching(widgetWindow.widgetBounds()).bounds;
  return fg.x <= d.x + 2 && fg.y <= d.y + 2
    && fg.x + fg.width >= d.x + d.width - 2 && fg.y + fg.height >= d.y + d.height - 2;
}

let gamePaused = false;
function watchGameMode() {
  setInterval(() => {
    const on = S.settings.get('gameMode') !== false && fullscreenAppRunning() && coversSceneScreen();
    if (on === gamePaused) return;
    gamePaused = on;
    S.send([S.widget], 'render-pause', on);
  }, 3000);
}

// ---------- Écrans ----------
// Écran branché/débranché, résolution ou écran principal changés : on se
// replace. Un contrôle périodique couvre les cas où Windows ne prévient pas.

function watchDisplays() {
  let timer = null;
  const primaryKey = () => {
    const p = screen.getPrimaryDisplay();
    return `${p.id}|${JSON.stringify(p.workArea)}|${p.scaleFactor}|${screen.getAllDisplays().length}`;
  };
  let last = primaryKey();
  const replace = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      last = primaryKey();
      if (!S.editing) widgetWindow.applyMode();
      setTimeout(capture.sampleWallpaper, 1000);
    }, 500);
  };
  screen.on('display-added', replace);
  screen.on('display-removed', replace);
  screen.on('display-metrics-changed', replace);
  setInterval(() => { if (primaryKey() !== last) replace(); }, 3000);
}

// ---------- IPC ----------

ipcMain.handle('settings:get', () => S.settings.get());
ipcMain.on('settings:set', (_e, patch) => updateSettings(patch));
ipcMain.on('settings:open', windows.openSettings);
ipcMain.on('media:command', (_e, cmd) => S.media && S.media.command(cmd));

ipcMain.on('edit:done', () => widgetWindow.setEditing(false));
ipcMain.on('edit:start', () => {
  if (widgetWindow.isScene()) return; // la scène occupe tout l'écran : rien à déplacer
  if (S.alive(S.fullscreen)) S.fullscreen.close();
  if (S.alive(S.settingsWin)) S.settingsWin.close();
  widgetWindow.setEditing(true);
});
ipcMain.on('bounds:reset', () => { S.settings.set({ bounds: null }); widgetWindow.applyMode(); });
ipcMain.on('widget:resize', (_e, { width, height }) => {
  if (!S.editing || !S.alive(S.widget)) return;
  const b = S.widget.getBounds();
  S.widget.setBounds({ ...b, width: Math.max(240, Math.round(width)), height: Math.max(120, Math.round(height)) });
});
ipcMain.on('scene:controls-rect', (e, rect) => {
  if (!S.widget || e.sender !== S.widget.webContents) return;
  S.controlsRect = rect && rect.width > 0 ? rect : null;
  updateControls();
});

ipcMain.on('veille:start', () => setTimeout(veille.startVeille, 300));
ipcMain.on('veille:exit', veille.stopVeille);
ipcMain.on('lyrics:nudge', (_e, delta) => nowPlaying.nudgeLyrics(typeof delta === 'number' ? delta : null));
ipcMain.on('fullscreen:close', () => S.alive(S.fullscreen) && S.fullscreen.close());

ipcMain.handle('spotify:status', () => (S.spotify ? S.spotify.status() : { connected: false }));
ipcMain.on('spotify:login', () => S.spotify && S.spotify.login());
ipcMain.on('spotify:logout', () => { if (S.spotify) { S.spotify.logout(); queue.refreshQueue(); } });
// Seule page externe que les paramètres peuvent ouvrir : le tableau de bord Spotify.
ipcMain.on('spotify:dashboard', () => shell.openExternal('https://developer.spotify.com/dashboard'));

// ---------- Démarrage ----------

app.whenReady().then(() => {
  app.setAppUserModelId('com.loicrestout.spotiview');
  S.settings = new Settings();
  diskCache.init(path.join(app.getPath('userData'), 'cache'));
  capture.setupLoopback();
  widgetWindow.createWidget();
  nowPlaying.startMedia();
  queue.startSpotify();
  buildTray();
  globalShortcut.register('CommandOrControl+Alt+F', windows.toggleFullscreen);
  if (!globalShortcut.register('CommandOrControl+Alt+L', veille.startVeille)) {
    console.error('Raccourci Ctrl+Alt+L déjà pris par une autre application.');
  }
  veille.watchIdle();
  watchDisplays();
  watchGameMode();
});

app.on('second-instance', () => S.tray && S.tray.popUpContextMenu());
app.on('window-all-closed', (e) => e.preventDefault()); // on vit dans la zone de notification
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (S.media) S.media.stop();
  if (S.attacher) S.attacher.detach();
  if (S.alive(S.controlsWin)) S.controlsWin.destroy();
});
