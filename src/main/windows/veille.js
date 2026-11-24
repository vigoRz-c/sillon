// Screen saver.
//
// Windows + L opens a secure desktop where no application can draw.
// Instead: after some inactivity (or with Ctrl+Alt+L), the scene
// shows in full screen over everything; on the first move or the
// first key, it closes and the session is locked.

const { BrowserWindow, screen, powerMonitor } = require('electron');
const path = require('path');
const S = require('../app/state');
const { lockWorkstation, fullscreenAppRunning } = require('./wallpaper');
const { secureWindow, SAFE_PREFS } = require('./secure');

const veilleActive = () => S.veilleWins.some((w) => !w.isDestroyed());

function startVeille() {
  if (veilleActive()) return;
  if (S.alive(S.fullscreen)) S.fullscreen.close();
  if (S.alive(S.settingsWin)) S.settingsWin.close();
  const primary = screen.getPrimaryDisplay();
  for (const d of screen.getAllDisplays()) {
    const main = d.id === primary.id;
    const win = new BrowserWindow({
      ...d.bounds,
      frame: false,
      fullscreen: true,
      backgroundColor: '#000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      title: 'Sillon · screen saver',
      webPreferences: { ...SAFE_PREFS, preload: S.PRELOAD, backgroundThrottling: false },
    });
    secureWindow(win);
    win.setAlwaysOnTop(true, 'screen-saver');
    if (main) {
      win.loadFile(path.join(S.RENDERER, 'fullscreen.html'), { query: { veille: '1' } });
      win.webContents.on('did-finish-load', () => {
        S.replayTo(win);
        S.actions.startAudio(win);
      });
      S.fullscreen = win; // gets the updates of the track, lyrics and settings
    } else {
      // The other screens: black, and they wake up too.
      win.loadFile(path.join(S.RENDERER, 'veille-black.html'));
    }
    win.once('ready-to-show', () => {
      if (main) {
        win.show();
        win.focus();
      } else win.showInactive();
    });
    win.on('closed', () => {
      S.veilleWins = S.veilleWins.filter((w) => w !== win);
    });
    S.veilleWins.push(win);
  }
}

// Closes every screen saver window; locks the session if asked.
function closeAll(lock) {
  const wins = S.veilleWins;
  S.veilleWins = [];
  for (const w of wins) if (!w.isDestroyed()) w.destroy();
  S.fullscreen = null;
  if (lock && S.settings.get('veilleLock') !== false) lockWorkstation();
}

function stopVeille() {
  if (veilleActive()) closeAll(true);
}

function watchIdle() {
  setInterval(() => {
    const delay = Number(S.settings.get('veilleDelay')) || 0;
    if (!delay || veilleActive() || S.editing) return;
    if (S.alive(S.fullscreen)) return; // already in Sillon's full screen
    const m = S.lastMedia;
    if (S.settings.get('veilleOnlyPlaying') !== false && !(m.active && m.status === 'Playing')) return;
    if (powerMonitor.getSystemIdleTime() < delay * 60) return;
    // A full-screen video or game does not move the mouse (Windows
    // does not count video as activity): the screen saver would
    // cover it, then the first move would lock the PC.
    if (S.gamePaused || fullscreenAppRunning()) return;
    startVeille();
  }, 5000);
  // Session locked or put to sleep elsewhere: tidy up without locking again.
  const quiet = () => {
    if (S.veilleWins.length) closeAll(false);
  };
  powerMonitor.on('lock-screen', quiet);
  powerMonitor.on('suspend', quiet);
}

module.exports = { startVeille, stopVeille, watchIdle };
