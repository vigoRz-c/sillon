// Boutons du panneau de la scène.
//
// La scène vit sous les icônes du bureau : elle ne reçoit aucun clic. Les
// boutons sont donc une petite fenêtre à part, posée exactement au-dessus
// d'eux et maintenue tout en bas de la pile des fenêtres (au-dessus du bureau,
// sous toutes les applications). Elle ne prend jamais le focus.

const { BrowserWindow } = require('electron');
const path = require('path');
const S = require('../app/state');
const { screen } = require('electron');
const { sendToBottom, windowAt, hwndOf, placeAboveDesktop } = require('./wallpaper');
const diagnostic = require('../app/diagnostic');

// Surveillance : si le bureau repasse au-dessus des boutons (verrouillage,
// redémarrage d'Explorer…), ils deviennent invisibles et les clics tombent sur
// le fond d'écran. On le détecte et on les remet au-dessus du bureau.
const DESKTOP = /^(Progman|WorkerW)$/;
let watching = null;
function watchControls() {
  if (watching) return;
  watching = setInterval(() => {
    const win = S.controlsWin;
    if (!S.alive(win)) return;
    if (win.isMinimized() || !win.isVisible()) {
      diagnostic.note('boutons', 'fenêtre réduite ou masquée : réaffichée');
      win.showInactive();
      placeAboveDesktop(win);
      return;
    }
    const b = win.getBounds();
    const hit = windowAt(screen.dipToScreenPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }));
    if (hit && hit.root !== hwndOf(win) && DESKTOP.test(hit.rootCls)) {
      diagnostic.note('boutons', `passés sous le bureau (${hit.rootCls}) : remis au-dessus`);
      placeAboveDesktop(win);
    }
  }, 2000);
}

function updateControls() {
  const { isScene, widgetBounds } = S.actions;
  const rect = S.controlsRect;
  const wanted = isScene() && !S.editing && !S.settings.get('sceneHidden') && rect
    && !S.alive(S.editorWin); // l'éditeur a ses propres boutons factices
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
      title: 'Sillon · boutons',
      webPreferences: { preload: S.PRELOAD, backgroundThrottling: false },
    });
    S.controlsWin = win;
    win.loadFile(path.join(S.RENDERER, 'controls.html'));
    win.webContents.on('did-finish-load', () => {
      win.webContents.send('media', S.lastMedia);
      win.showInactive();
      sendToBottom(win);
      placeAboveDesktop(win);
    });
    win.webContents.on('render-process-gone', (_e, d) => diagnostic.note('boutons', `page plantée (${d.reason}) : rechargement`));
    win.webContents.on('render-process-gone', () => setTimeout(() => S.alive(win) && win.reload(), 500));
    watchControls();
    win.on('closed', () => { if (S.controlsWin === win) S.controlsWin = null; });
  } else {
    S.controlsWin.setBounds(bounds);
    sendToBottom(S.controlsWin);
    placeAboveDesktop(S.controlsWin);
  }
}

module.exports = { updateControls };
