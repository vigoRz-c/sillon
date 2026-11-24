// Sillon : processus principal.
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
//   ipc.js              handlers IPC contrôlés (expéditeur, erreurs)

const { app, screen, globalShortcut, shell, clipboard, dialog } = require('electron');

// Une seule instance : la seconde se ferme sans rien démarrer. Le fichier est
// un module CommonJS : `return` arrête ici toute la suite (IPC, démarrage).
if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

const path = require('path');
const fs = require('fs');
const S = require('./state');
const { Settings } = require('./settings');
const diskCache = require('../media/disk-cache');
const { fullscreenAppRunning, foregroundRect } = require('../windows/wallpaper');
const widgetWindow = require('../windows/widget-window');
const { updateControls } = require('../windows/controls-window');
const capture = require('../audio/capture');
const windows = require('../windows/windows');
const veille = require('../windows/veille');
const nowPlaying = require('../media/now-playing');
const queue = require('../media/queue');
const { buildTray } = require('../windows/tray');
const updater = require('./updater');
const diagnostic = require('./diagnostic');
const layoutEditor = require('../windows/layout-editor');
const appAudio = require('../audio/app-audio');
const ipc = require('./ipc');
const { MEDIA_COMMANDS, finite, validRect } = require('./ipc-guard');
const { isAsleep } = require('./rest');

// Mémoire graphique : par défaut, Chromium garde un gros cache sur la carte
// graphique (~300 Mo pour la scène). Plafonné, il reste vers 180 Mo sans
// différence à l'écran (mesuré sur une scène plein écran à 30 i/s).
app.commandLine.appendSwitch('force-gpu-mem-available-mb', '96');
// Le son démarre sur un message du processus principal (« audio:start »), pas
// sur un geste de l'utilisateur.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ---------- Réglages ----------

// Le menu de l'icône est reconstruit au plus une fois par rafale de changements.
let trayTimer = null;
function scheduleTray() {
  clearTimeout(trayTimer);
  trayTimer = setTimeout(() => {
    trayTimer = null;
    buildTray();
  }, 150);
}

function updateSettings(patch) {
  const { all, changed } = S.settings.change(patch);
  if (!Object.keys(changed).length) return; // rien de nouveau : rien à renvoyer ni à reconstruire
  const has = (...keys) => keys.some((k) => k in changed);
  S.send([S.widget, S.fullscreen, S.settingsWin, S.editorWin, S.placeWin], 'settings', all);
  // Disposition ou mode changés pendant « Déplacer / redimensionner » : on sort
  // du placement d'abord (la scène plein écran n'a rien à placer).
  if (S.editing && has('layout', 'mode')) widgetWindow.setEditing(false);
  if (has('mode', 'layout', 'sceneHidden', 'sceneScreen')) {
    widgetWindow.applyMode();
    applyRest();
    setTimeout(capture.sampleWallpaper, 1200);
  }
  if (changed.theme === 'wallpaper') setTimeout(capture.sampleWallpaper, 500);
  if (has('sleepAfter')) restTick();
  if (has('sceneLayout')) updateControls();
  if (has('spotifyCustomClientId', 'spotifyClientId') && S.spotify) {
    S.spotify.setError('');
    queue.refreshQueue();
  }
  if (has('audioSource', 'preferApp')) appAudio.onSettingChanged();
  if (has('preferApp') && S.media) S.media.setPreferredApp(changed.preferApp);
  if (has('launchAtLogin')) app.setLoginItemSettings({ openAtLogin: !!changed.launchAtLogin });
  if (changed.autoUpdate === true) updater.check();
  scheduleTray();
}

// Fonctions partagées entre modules (voir state.js).
Object.assign(S.actions, {
  updateSettings,
  buildTray: scheduleTray,
  updateControls,
  isScene: widgetWindow.isScene,
  sceneDisplay: widgetWindow.sceneDisplay,
  openLayoutEditor: layoutEditor.openLayoutEditor,
  widgetBounds: widgetWindow.widgetBounds,
  applyMode: widgetWindow.applyMode,
  setEditing: widgetWindow.setEditing,
  startAudio: appAudio.startAudio,
  audioOnMedia: (m) => {
    restTick();
    appAudio.onMedia(m);
  },
  audioStatus: appAudio.status,
  sampleWallpaper: capture.sampleWallpaper,
  startWallpaperSampling: capture.startWallpaperSampling,
  toggleFullscreen: windows.toggleFullscreen,
  openSettings: windows.openSettings,
  startVeille: veille.startVeille,
  refreshQueue: queue.refreshQueue,
  mediaCommand: queue.mediaCommand,
  refreshPlayer: queue.refreshPlayer,
  rebroadcast: () => {}, // remplacé par now-playing.js
  lyricsOffsetFor: nowPlaying.lyricsOffsetFor,
  nudgeLyrics: nowPlaying.nudgeLyrics,
  copyDiagnostic: () => copyDiagnostic(),
  updateStatus: updater.status,
  checkUpdates: updater.check,
  installUpdate: updater.installNow,
});

// ---------- Repos et mode jeu ----------
// Un jeu, une vidéo ou une présentation en plein écran cache le bureau : la
// scène s'arrête de dessiner (et d'analyser le son) jusqu'à leur fermeture.
// Même chose quand la scène est masquée, ou endormie faute de musique.

// Windows dit seulement « une appli est en plein écran », sans dire où : on
// vérifie que la fenêtre au premier plan couvre bien l'écran de la scène
// (sinon un plein écran sur l'autre écran arrêterait la scène à tort).
function coversSceneScreen() {
  const r = foregroundRect();
  if (!r || !S.alive(S.widget)) return false;
  // Avec la fenêtre de la scène (et non null) : sur des écrans d'échelles
  // différentes, la conversion se fait avec l'échelle de l'écran de la scène.
  const fg = screen.screenToDipRect(S.widget, r);
  const d = screen.getDisplayMatching(widgetWindow.widgetBounds()).bounds;
  return (
    fg.x <= d.x + 2 && fg.y <= d.y + 2 && fg.x + fg.width >= d.x + d.width - 2 && fg.y + fg.height >= d.y + d.height - 2
  );
}

// Envoie « render-pause » à la scène (jeu ou scène masquée) quand cela change,
// et prévient la chaîne audio et l'échantillonnage du fond d'écran.
let wasActive = null;
function applyRest() {
  const pause = !S.editing && (S.gamePaused || !!S.settings.get('sceneHidden'));
  if (pause !== S.renderPaused) {
    S.renderPaused = pause;
    S.send([S.widget], 'render-pause', pause);
  }
  appAudio.onActivityChanged();
  const active = S.sceneActive();
  if (active && wasActive === false) {
    // Réveil : couleurs et file d'attente à jour (la file n'est pas lue pendant le repos).
    setTimeout(capture.sampleWallpaper, 1200);
    queue.refreshQueue();
  }
  wasActive = active;
}
S.actions.applyRest = applyRest;

function watchGameMode() {
  setInterval(() => {
    const on = S.settings.get('gameMode') !== false && fullscreenAppRunning() && coversSceneScreen();
    if (on === S.gamePaused) return;
    S.gamePaused = on;
    applyRest();
  }, 3000);
}

// Endormie : même règle que la page de la scène (voir rest.js).
let silentSince = Date.now();
function restTick() {
  if (!S.settings) return;
  const m = S.lastMedia;
  const playing = !!(m && m.active && m.status === 'Playing');
  const now = Date.now();
  if (playing) silentSince = now;
  const asleep = isAsleep({ playing, silentSince, now, minutes: S.settings.get('sleepAfter') });
  if (asleep === S.asleep) return;
  S.asleep = asleep;
  applyRest();
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
  setInterval(() => {
    if (primaryKey() !== last) replace();
  }, 3000);
}

// ---------- IPC ----------
// Chaque handler passe par ipc.js : expéditeur contrôlé, erreurs journalisées.
// Les arguments sont validés ici (types, nombres finis, liste blanche).

ipc.handle('settings:get', () => S.settings.get());
ipc.on('settings:set', (_e, patch) => updateSettings(patch));
ipc.on('settings:open', () => windows.openSettings());
ipc.on('media:volume', (_e, percent) => {
  const v = finite(percent, 0, 100);
  if (v !== null && S.actions.setVolume) S.actions.setVolume(v);
});
ipc.on('media:command', (e, cmd) => {
  if (typeof cmd !== 'string' || !MEDIA_COMMANDS.includes(cmd)) return;
  const from =
    S.controlsWin && e.sender === S.controlsWin.webContents
      ? 'boutons de la scène'
      : S.fullscreen && e.sender === S.fullscreen.webContents
        ? 'plein écran'
        : 'autre fenêtre';
  diagnostic.note('clic', `${cmd} depuis ${from}`);
  queue.mediaCommand(cmd);
});
function copyDiagnostic() {
  const text = diagnostic.collect();
  clipboard.writeText(text);
  return text;
}
ipc.handle('diagnostic:copy', copyDiagnostic);

ipc.on('edit:done', () => widgetWindow.setEditing(false));
ipc.on('edit:start', () => {
  if (widgetWindow.isScene()) return; // la scène occupe tout l'écran : rien à déplacer
  if (S.alive(S.fullscreen)) S.fullscreen.close();
  if (S.alive(S.settingsWin)) S.settingsWin.close();
  widgetWindow.setEditing(true);
});
ipc.on('bounds:reset', () => {
  S.settings.set({ bounds: null });
  widgetWindow.applyMode();
});
ipc.on('widget:resize', (e, size) => {
  // Seule la fenêtre de placement se redimensionne (voir setEditing).
  const win = S.placeWin;
  if (!S.editing || !S.alive(win) || e.sender !== win.webContents || !size || typeof size !== 'object') return;
  const width = finite(size.width, 0, 20000);
  const height = finite(size.height, 0, 20000);
  if (width === null || height === null) return;
  const b = win.getBounds();
  win.setBounds({ ...b, width: Math.max(240, Math.round(width)), height: Math.max(120, Math.round(height)) });
});
ipc.on('scene:controls-rect', (e, rect) => {
  if (!S.widget || e.sender !== S.widget.webContents) return;
  const r = validRect(rect);
  S.controlsRect = r && r.width > 0 ? r : null;
  updateControls();
});

ipc.on('veille:start', () => setTimeout(veille.startVeille, 300));
ipc.on('veille:exit', () => veille.stopVeille());
ipc.on('lyrics:nudge', (_e, delta) => {
  if (delta === null) return nowPlaying.nudgeLyrics(null); // remise à zéro
  const d = finite(delta, -60, 60);
  if (d !== null) nowPlaying.nudgeLyrics(d);
});
ipc.handle('update:status', () => updater.status());
ipc.on('update:check', () => updater.check());
ipc.on('update:install', () => updater.installNow());
ipc.on('fullscreen:close', () => S.alive(S.fullscreen) && S.fullscreen.close());

ipc.handle('spotify:status', () => (S.spotify ? S.spotify.status() : { connected: false }));
ipc.on('spotify:login', () => S.spotify && S.spotify.login());
ipc.on('spotify:logout', () => {
  if (S.spotify) {
    S.spotify.logout();
    queue.refreshQueue();
  }
});
// Seule page externe que les paramètres peuvent ouvrir : le tableau de bord Spotify.
ipc.on('spotify:dashboard', () => shell.openExternal('https://developer.spotify.com/dashboard'));

// ---------- Ancien nom (Spoti-View) ----------
// Le dossier des réglages suit le nom de l'app : %APPDATA%/Sillon. Au premier
// lancement, on reprend les réglages et le cache de %APPDATA%/Spoti-View.
// Les jetons Spotify ne sont pas repris : ils sont chiffrés avec une clé
// propre à l'ancien dossier, il suffit de se reconnecter une fois.
function migrateFromSpotiView() {
  try {
    const dir = app.getPath('userData');
    const old = path.join(path.dirname(dir), 'Spoti-View');
    if (fs.existsSync(path.join(dir, 'settings.json')) || !fs.existsSync(old)) return;
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['settings.json', 'cache']) {
      const from = path.join(old, name);
      if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, name), { recursive: true });
    }
    console.log('Réglages repris de Spoti-View.');
  } catch (e) {
    console.error('Reprise des réglages de Spoti-View :', e.message);
    diagnostic.note('réglages', `reprise de Spoti-View incomplète : ${e.message}`);
  }
}

// ---------- Démarrage ----------

// Une erreur imprévue ne doit pas passer inaperçue : elle va au diagnostic
// (Paramètres → Diagnostic), pas seulement dans une console invisible.
const fatal = (kind) => (e) => {
  console.error(`${kind} :`, e);
  try {
    diagnostic.note('erreur', `${kind} : ${(e && e.stack) || e}`);
  } catch {
    /* le diagnostic lui-même a échoué : la console suffit */
  }
};
process.on('unhandledRejection', fatal('promesse rejetée'));
// « Monitor » : noté au diagnostic sans changer la réaction d'Electron (boîte d'erreur).
process.on('uncaughtExceptionMonitor', fatal('exception'));

function start() {
  app.setAppUserModelId('com.loicrestout.sillon');
  migrateFromSpotiView();
  S.settings = new Settings();
  diskCache.init(path.join(app.getPath('userData'), 'cache'));
  capture.setupLoopback();
  widgetWindow.createWidget();
  nowPlaying.startMedia();
  queue.startSpotify();
  buildTray();
  restTick();
  setInterval(restTick, 2000);
  for (const [keys, fn] of [
    ['CommandOrControl+Alt+F', windows.toggleFullscreen],
    ['CommandOrControl+Alt+L', veille.startVeille],
  ]) {
    if (!globalShortcut.register(keys, fn)) {
      console.error(`Raccourci ${keys} déjà pris par une autre application.`);
      diagnostic.note('raccourci', `${keys} déjà pris par une autre application`);
    }
  }
  veille.watchIdle();
  updater.init();
  watchDisplays();
  watchGameMode();
}

// Démarrage raté : sans icône dans la zone de notification, il n'y aurait plus
// aucun moyen de quitter (window-all-closed est neutralisé plus bas). On le dit
// et on s'arrête.
app
  .whenReady()
  .then(start)
  .catch((e) => {
    fatal('démarrage')(e);
    dialog.showErrorBox('Sillon', `Démarrage impossible : ${(e && e.message) || e}`);
    app.exit(1);
  });

app.on('second-instance', () => S.tray && S.tray.popUpContextMenu());
app.on('window-all-closed', (e) => e.preventDefault()); // on vit dans la zone de notification
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  clearTimeout(trayTimer);
  if (S.settings) S.settings.flush(); // écrit ce qui est encore en attente
  appAudio.stop();
  if (S.media) S.media.stop();
  if (S.attacher) S.attacher.detach();
  if (S.alive(S.controlsWin)) S.controlsWin.destroy();
});
