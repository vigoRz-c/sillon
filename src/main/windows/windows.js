// Windows opened on demand: full screen and settings.

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const S = require('../app/state');
const { t } = require('../app/i18n');
const { sendToBottom } = require('./wallpaper');
const { secureWindow, SAFE_PREFS } = require('./secure');

function toggleFullscreen() {
  if (S.alive(S.fullscreen)) {
    S.fullscreen.close();
    return;
  }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const win = new BrowserWindow({
    ...display.bounds,
    fullscreen: true,
    frame: false,
    backgroundColor: '#000000',
    skipTaskbar: false,
    title: 'Sillon',
    icon: path.join(S.ASSETS, 'icon.png'),
    webPreferences: { ...SAFE_PREFS, preload: S.PRELOAD, backgroundThrottling: false },
  });
  S.fullscreen = win;
  secureWindow(win);
  win.loadFile(path.join(S.RENDERER, 'fullscreen.html'));
  win.webContents.on('did-finish-load', () => {
    S.replayTo(win);
    S.actions.startAudio(win);
    setTimeout(S.actions.sampleWallpaper, 800); // the scene may have stopped sampling
  });
  win.on('closed', () => {
    if (S.fullscreen === win) S.fullscreen = null;
  });
}

function openSettings() {
  if (S.alive(S.settingsWin)) {
    S.settingsWin.show();
    S.settingsWin.focus();
    return;
  }
  // On the full screen's screen if it is open, otherwise on the primary screen.
  const parent = S.alive(S.fullscreen) ? S.fullscreen : null;
  const display = parent ? screen.getDisplayMatching(parent.getBounds()) : screen.getPrimaryDisplay();
  // Sections menu on the left, preview and settings on the right; smaller on a small screen.
  const { workArea: wa } = display;
  const width = Math.min(880, wa.width - 48),
    height = Math.min(660, wa.height - 104);
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(wa.x + wa.width - width - 24),
    y: Math.round(wa.y + 80),
    parent: parent || undefined,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    alwaysOnTop: !!parent,
    skipTaskbar: !!parent,
    title: t('window.settings'),
    icon: path.join(S.ASSETS, 'icon.png'),
    webPreferences: { ...SAFE_PREFS, preload: S.PRELOAD },
  });
  S.settingsWin = win;
  secureWindow(win);
  win.loadFile(path.join(S.RENDERER, 'settings.html'));
  win.on('closed', () => {
    if (S.settingsWin === win) S.settingsWin = null;
    // The settings window may have raised the buttons: send them back to the bottom.
    if (S.alive(S.controlsWin)) sendToBottom(S.controlsWin);
  });
}

module.exports = { toggleFullscreen, openSettings };
