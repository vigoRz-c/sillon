// Boutons du panneau de la scène.
//
// La scène vit sous les icônes du bureau : elle ne reçoit aucun clic. Les
// boutons sont donc une petite fenêtre à part, posée exactement au-dessus
// d'eux et maintenue tout en bas de la pile des fenêtres (au-dessus du bureau,
// sous toutes les applications). Elle ne prend jamais le focus.

const { BrowserWindow } = require('electron');
const path = require('path');
const S = require('./state');
const { sendToBottom } = require('./wallpaper');

function updateControls() {
  const { isScene, widgetBounds } = S.actions;
  const rect = S.controlsRect;
  const wanted = isScene() && !S.editing && !S.settings.get('sceneHidden')
    && S.settings.get('showPanel') !== false && rect;
  if (!wanted) {
    if (S.alive(S.controlsWin)) S.controlsWin.close();
    return;
  }
  const wb = widgetBounds();
  const bounds = {
    x: Math.round(wb.x + rect.x), y: Math.round(wb.y + rect.y),
    width: Math.round(rect.width), height: Math.round(rect.height),
  };
  if (!S.alive(S.controlsWin)) {
    const win = new BrowserWindow({
      ...bounds,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      // Non activable : un clic sur un bouton ne la fait pas passer devant les
      // autres fenêtres et ne vole pas le focus.
      resizable: false, minimizable: false, maximizable: false, skipTaskbar: true,
      focusable: false, show: false,
      title: 'Spoti-View · boutons',
      webPreferences: { preload: S.PRELOAD, backgroundThrottling: false },
    });
    S.controlsWin = win;
    win.loadFile(path.join(S.RENDERER, 'controls.html'));
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('media', S.lastMedia);
      win.showInactive();
      sendToBottom(win);
    });
    win.on('closed', () => { if (S.controlsWin === win) S.controlsWin = null; });
  } else {
    S.controlsWin.setBounds(bounds);
    sendToBottom(S.controlsWin);
  }
}

module.exports = { updateControls };
