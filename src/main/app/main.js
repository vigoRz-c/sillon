// Sillon: main process.
//
// This file wires the modules together and handles the settings, the
// communication with the pages (IPC) and startup. The rest is sorted by theme:
//   widget-window.js    scene / strip on the wallpaper
//   controls-window.js  buttons of the scene panel
//   windows.js          full screen and settings
//   veille.js           screen saver
//   now-playing.js      current track, cover, lyrics
//   queue.js            queue (Spotify API)
//   capture.js          system sound, wallpaper colors
//   tray.js             icon menu
//   state.js            shared state
//   ipc.js              checked IPC handlers (sender, errors)

const { app, screen, globalShortcut, shell, clipboard, dialog } = require('electron');

// Single instance: the second one quits without starting anything. The file is
// a CommonJS module: `return` stops everything after it here (IPC, startup).
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
const { createShortcuts } = require('./shortcuts');
const { TEXT: SHORTCUT_TEXT } = require('../../renderer/shared/shortcuts');
const { STYLE_ORDER, THEME_ORDER } = require('../../renderer/shared/catalog');
const i18n = require('./i18n');

// Graphics memory: by default, Chromium keeps a large cache on the graphics
// card (~300 MB for the scene). Capped, it stays around 180 MB with no
// visible difference (measured on a full-screen scene at 30 fps).
app.commandLine.appendSwitch('force-gpu-mem-available-mb', '96');
// The sound starts on a message from the main process ("audio:start"), not
// on a user gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ---------- Settings ----------

// The icon menu is rebuilt at most once per burst of changes.
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
  if (!Object.keys(changed).length) return; // nothing new: nothing to send or rebuild
  const has = (...keys) => keys.some((k) => k in changed);
  // Before sending: the settings page asks for the shortcut states again when it receives the settings.
  if (has('globalShortcuts')) shortcuts.apply(changed.globalShortcuts);
  S.send([S.widget, S.fullscreen, S.settingsWin, S.editorWin, S.placeWin], 'settings', all);
  if (has('language')) {
    // The pages translate themselves live; the settings page is rebuilt instead (reloaded from
    // here, since secure.js refuses the navigations a page starts itself, location.reload() included).
    const wins = [S.widget, S.fullscreen, S.editorWin, S.placeWin, S.controlsWin, ...S.veilleWins];
    S.send(wins, 'language', i18n.language());
    if (S.settingsWin && !S.settingsWin.isDestroyed()) S.settingsWin.webContents.reload();
  }
  // Layout or mode changed during "Move / resize": leave placement
  // first (the full-screen scene has nothing to place).
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

// Functions shared between modules (see state.js).
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
  rebroadcast: () => {}, // replaced by now-playing.js
  lyricsOffsetFor: nowPlaying.lyricsOffsetFor,
  nudgeLyrics: nowPlaying.nudgeLyrics,
  copyDiagnostic: () => copyDiagnostic(),
  updateStatus: updater.status,
  checkUpdates: updater.check,
  installUpdate: updater.installNow,
});

// ---------- Global keyboard shortcuts ----------
// Ctrl+Alt+<key> (list and labels in renderer/shared/shortcuts.js).

const next = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];
const toggle = (key, fallback = false) => {
  const v = S.settings.get(key);
  updateSettings({ [key]: !(v === undefined ? fallback : v) });
};
const shortcutCommand = (cmd) => () => {
  diagnostic.note('click', `${cmd} ${SHORTCUT_TEXT.fromShortcut}`);
  queue.mediaCommand(cmd);
};
const shortcuts = createShortcuts({
  globalShortcut,
  note: (msg) => diagnostic.note('shortcut', msg),
  actions: {
    playpause: shortcutCommand('playpause'),
    next: shortcutCommand('next'),
    previous: shortcutCommand('previous'),
    shuffle: shortcutCommand('shuffle'),
    repeat: shortcutCommand('repeat'),
    fullscreen: windows.toggleFullscreen,
    toggleScene: () => toggle('sceneHidden'),
    toggleLayout: () => updateSettings({ layout: widgetWindow.isScene() ? 'strip' : 'scene' }),
    nextStyle: () => updateSettings({ style: next(STYLE_ORDER, S.settings.get('style')) }),
    nextTheme: () => updateSettings({ theme: next(THEME_ORDER, S.settings.get('theme')) }),
    veille: veille.startVeille,
    toggleLyrics: () => toggle('showLyrics', true),
    lyricsLater: () => nowPlaying.nudgeLyrics(-0.25),
    lyricsEarlier: () => nowPlaying.nudgeLyrics(0.25),
    settings: windows.openSettings,
    // The editor is only for the scene, placement only for the strip (as in the icon menu).
    sceneEditor: () => widgetWindow.isScene() && layoutEditor.openLayoutEditor(),
    placeStrip: () => {
      if (widgetWindow.isScene()) return;
      if (!S.editing) {
        if (S.alive(S.fullscreen)) S.fullscreen.close();
        if (S.alive(S.settingsWin)) S.settingsWin.close();
      }
      widgetWindow.setEditing(!S.editing);
    },
  },
});
S.actions.shortcutAccelerator = shortcuts.acceleratorOf;

// ---------- Rest and game mode ----------
// A full-screen game, video or presentation hides the desktop: the
// scene stops drawing (and analyzing the sound) until they close.
// Same when the scene is hidden, or asleep for lack of music.

// Windows only says "an app is in full screen", not where: we
// check that the foreground window really covers the scene's screen
// (otherwise a full screen on the other screen would wrongly stop the scene).
function coversSceneScreen() {
  const r = foregroundRect();
  if (!r || !S.alive(S.widget)) return false;
  // With the scene window (and not null): on screens with different scales,
  // the conversion uses the scale of the scene's screen.
  const fg = screen.screenToDipRect(S.widget, r);
  const d = screen.getDisplayMatching(widgetWindow.widgetBounds()).bounds;
  return (
    fg.x <= d.x + 2 && fg.y <= d.y + 2 && fg.x + fg.width >= d.x + d.width - 2 && fg.y + fg.height >= d.y + d.height - 2
  );
}

// Sends "render-pause" to the scene (game or hidden scene) when it changes,
// and tells the audio chain and the wallpaper sampling.
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
    // Waking up: colors and queue up to date (the queue is not read while resting).
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

// Asleep: same rule as the scene page (see rest.js).
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

// ---------- Screens ----------
// Screen plugged/unplugged, resolution or primary screen changed: we
// reposition. A periodic check covers the cases where Windows does not tell.

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
// Every handler goes through ipc.js: sender checked, errors logged.
// The arguments are validated here (types, finite numbers, allow list).

ipc.handle('settings:get', () => S.settings.get());
ipc.handle('i18n:language', () => i18n.language());
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
      ? 'scene buttons'
      : S.fullscreen && e.sender === S.fullscreen.webContents
        ? 'full screen'
        : 'other window';
  diagnostic.note('click', `${cmd} from ${from}`);
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
  if (widgetWindow.isScene()) return; // the scene fills the whole screen: nothing to move
  if (S.alive(S.fullscreen)) S.fullscreen.close();
  if (S.alive(S.settingsWin)) S.settingsWin.close();
  widgetWindow.setEditing(true);
});
ipc.on('bounds:reset', () => {
  S.settings.set({ bounds: null });
  widgetWindow.applyMode();
});
ipc.on('widget:resize', (e, size) => {
  // Only the placement window resizes (see setEditing).
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
  if (delta === null) return nowPlaying.nudgeLyrics(null); // reset
  const d = finite(delta, -60, 60);
  if (d !== null) nowPlaying.nudgeLyrics(d);
});
ipc.handle('update:status', () => updater.status());
ipc.on('update:check', () => updater.check());
ipc.on('update:install', () => updater.installNow());
ipc.on('fullscreen:close', () => S.alive(S.fullscreen) && S.fullscreen.close());
// Shortcut states for the settings list; retries those that were taken.
ipc.handle('shortcuts:status', () => {
  const st = shortcuts.status({ retry: true });
  scheduleTray(); // a shortcut freed in the meantime also shows up in the menu
  return st;
});

ipc.handle('spotify:status', () => (S.spotify ? S.spotify.status() : { connected: false }));
ipc.on('spotify:login', () => S.spotify && S.spotify.login());
ipc.on('spotify:logout', () => {
  if (S.spotify) {
    S.spotify.logout();
    queue.refreshQueue();
  }
});
// The only external page the settings can open: the Spotify dashboard.
ipc.on('spotify:dashboard', () => shell.openExternal('https://developer.spotify.com/dashboard'));

// ---------- Former name (Spoti-View) ----------
// The settings folder follows the app's name: %APPDATA%/Sillon. On first
// launch, the settings and cache of %APPDATA%/Spoti-View are taken over.
// The Spotify tokens are not: they are encrypted with a key specific
// to the old folder, signing in again once is enough.
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
    console.log('Settings taken over from Spoti-View.');
  } catch (e) {
    console.error('Taking over the Spoti-View settings:', e.message);
    diagnostic.note('settings', `Spoti-View takeover incomplete: ${e.message}`);
  }
}

// ---------- Startup ----------

// An unexpected error must not go unnoticed: it goes to the diagnostic
// (Settings → Diagnostic), not only to an invisible console.
const fatal = (kind) => (e) => {
  console.error(`${kind} :`, e);
  try {
    diagnostic.note('error', `${kind} : ${(e && e.stack) || e}`);
  } catch {
    /* the diagnostic itself failed: the console will do */
  }
};
process.on('unhandledRejection', fatal('rejected promise'));
// "Monitor": noted in the diagnostic without changing Electron's reaction (error box).
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
  // Before the icon menu, which shows the registered combinations.
  shortcuts.apply(S.settings.get('globalShortcuts') !== false);
  buildTray();
  restTick();
  setInterval(restTick, 2000);
  veille.watchIdle();
  updater.init();
  watchDisplays();
  watchGameMode();
}

// Failed startup: without an icon in the notification area, there would be no
// way left to quit (window-all-closed is neutralized below). Say so
// and stop.
app
  .whenReady()
  .then(start)
  .catch((e) => {
    fatal('startup')(e);
    dialog.showErrorBox('Sillon', i18n.t('main.startFailed', { error: (e && e.message) || e }));
    app.exit(1);
  });

app.on('second-instance', () => S.tray && S.tray.popUpContextMenu());
app.on('window-all-closed', (e) => e.preventDefault()); // we live in the notification area
app.on('will-quit', () => {
  shortcuts.unregisterAll();
  globalShortcut.unregisterAll(); // safety net: nothing must stay taken after exit
  clearTimeout(trayTimer);
  if (S.settings) S.settings.flush(); // writes what is still pending
  appAudio.stop();
  if (S.media) S.media.stop();
  if (S.attacher) S.attacher.detach();
  if (S.alive(S.controlsWin)) S.controlsWin.destroy();
});
