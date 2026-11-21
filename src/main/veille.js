// Écran de veille.
//
// Windows + L ouvre un bureau sécurisé où aucune application ne peut dessiner.
// À la place : après un temps d'inactivité (ou avec Ctrl+Alt+L), la scène
// s'affiche en plein écran par-dessus tout ; au premier mouvement ou à la
// première touche, elle se ferme et la session est verrouillée.

const { BrowserWindow, screen, powerMonitor } = require('electron');
const path = require('path');
const S = require('./state');
const { lockWorkstation } = require('./wallpaper');

const veilleActive = () => S.veilleWins.some((w) => !w.isDestroyed());

function startVeille() {
  if (veilleActive()) return;
  if (S.alive(S.fullscreen)) S.fullscreen.close();
  if (S.alive(S.settingsWin)) S.settingsWin.close();
  const primary = screen.getPrimaryDisplay();
  for (const d of screen.getAllDisplays()) {
    const main = d.id === primary.id;
    const win = new BrowserWindow({
      ...d.bounds, frame: false, fullscreen: true, backgroundColor: '#000000',
      alwaysOnTop: true, skipTaskbar: true, show: false, title: 'Spoti-View · veille',
      webPreferences: { preload: S.PRELOAD, backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    if (main) {
      win.loadFile(path.join(S.RENDERER, 'fullscreen.html'), { query: { veille: '1' } });
      win.webContents.on('did-finish-load', () => {
        win.webContents.send('settings', S.settings.get());
        win.webContents.send('media', S.lastMedia);
        if (S.lastLyrics) win.webContents.send('lyrics', S.lastLyrics);
        S.actions.startAudio(win);
      });
      S.fullscreen = win; // reçoit les mises à jour du morceau, des paroles et des réglages
    } else {
      // Les autres écrans : noirs, et ils réveillent aussi.
      win.loadURL('data:text/html,' + encodeURIComponent('<body style="margin:0;background:#000;cursor:none"><script>setTimeout(()=>{for(const e of ["mousedown","keydown","wheel"])addEventListener(e,()=>bridge.veilleExit())},1500)</script></body>'));
    }
    win.once('ready-to-show', () => { if (main) { win.show(); win.focus(); } else win.showInactive(); });
    win.on('closed', () => { S.veilleWins = S.veilleWins.filter((w) => w !== win); });
    S.veilleWins.push(win);
  }
}

// Ferme toutes les fenêtres de veille ; verrouille la session si demandé.
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
    if (S.alive(S.fullscreen)) return; // déjà en plein écran Spoti-View
    const m = S.lastMedia;
    if (S.settings.get('veilleOnlyPlaying') !== false && !(m.active && m.status === 'Playing')) return;
    if (powerMonitor.getSystemIdleTime() >= delay * 60) startVeille();
  }, 5000);
  // Session verrouillée ou mise en veille par ailleurs : on range sans reverrouiller.
  const quiet = () => { if (S.veilleWins.length) closeAll(false); };
  powerMonitor.on('lock-screen', quiet);
  powerMonitor.on('suspend', quiet);
}

module.exports = { startVeille, stopVeille, watchIdle };
