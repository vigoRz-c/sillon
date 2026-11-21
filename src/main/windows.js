// Fenêtres ouvertes à la demande : plein écran et paramètres.

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const S = require('./state');
const { sendToBottom } = require('./wallpaper');

function toggleFullscreen() {
  if (S.alive(S.fullscreen)) { S.fullscreen.close(); return; }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const win = new BrowserWindow({
    ...display.bounds,
    fullscreen: true,
    frame: false,
    backgroundColor: '#000000',
    skipTaskbar: false,
    title: 'Spoti-View',
    icon: path.join(S.ASSETS, 'icon.png'),
    webPreferences: { preload: S.PRELOAD, backgroundThrottling: false },
  });
  S.fullscreen = win;
  win.loadFile(path.join(S.RENDERER, 'fullscreen.html'));
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('settings', S.settings.get());
    win.webContents.send('media', S.lastMedia);
    if (S.lastLyrics) win.webContents.send('lyrics', S.lastLyrics);
    if (S.wallpaperSample) win.webContents.send('wallpaper', S.wallpaperSample);
    S.actions.startAudio(win);
  });
  win.on('closed', () => { if (S.fullscreen === win) S.fullscreen = null; });
}

function openSettings() {
  if (S.alive(S.settingsWin)) { S.settingsWin.show(); S.settingsWin.focus(); return; }
  // Sur l'écran du plein écran s'il est ouvert, sinon sur l'écran principal.
  const parent = S.alive(S.fullscreen) ? S.fullscreen : null;
  const display = parent ? screen.getDisplayMatching(parent.getBounds()) : screen.getPrimaryDisplay();
  const width = 420, height = 700;
  const { workArea: wa } = display;
  const win = new BrowserWindow({
    width, height,
    x: Math.round(wa.x + wa.width - width - 24),
    y: Math.round(wa.y + 80),
    parent: parent || undefined,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    alwaysOnTop: !!parent,
    skipTaskbar: !!parent,
    title: 'Paramètres · Spoti-View',
    icon: path.join(S.ASSETS, 'icon.png'),
    webPreferences: { preload: S.PRELOAD },
  });
  S.settingsWin = win;
  win.loadFile(path.join(S.RENDERER, 'settings.html'));
  win.on('closed', () => {
    if (S.settingsWin === win) S.settingsWin = null;
    // La fenêtre de paramètres a pu remonter les boutons : on les renvoie au fond.
    if (S.alive(S.controlsWin)) sendToBottom(S.controlsWin);
  });
}

module.exports = { toggleFullscreen, openSettings };
