// Buttons of the scene panel.
//
// The scene lives under the desktop icons: it gets no clicks. The
// buttons are therefore a small separate window, laid exactly over
// them and kept at the very bottom of the window stack (above the desktop,
// under every application). It never takes the focus.

const { BrowserWindow } = require('electron');
const path = require('path');
const S = require('../app/state');
const { screen } = require('electron');
const { sendToBottom, windowAt, hwndOf, placeAboveDesktop } = require('./wallpaper');
const diagnostic = require('../app/diagnostic');
const { secureWindow, SAFE_PREFS } = require('./secure');

// Watch: if the desktop goes back above the buttons (lock,
// Explorer restart…), they become invisible and the clicks fall on
// the wallpaper. We detect it and put them back above the desktop.
const DESKTOP = /^(Progman|WorkerW)$/;
let watching = null;
function watchControls() {
  if (watching) return;
  watching = setInterval(() => {
    const win = S.controlsWin;
    if (!S.alive(win)) return;
    if (win.isMinimized() || !win.isVisible()) {
      diagnostic.note('buttons', 'window minimized or hidden: shown again');
      win.showInactive();
      placeAboveDesktop(win);
      return;
    }
    const b = win.getBounds();
    const hit = windowAt(screen.dipToScreenPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }));
    if (hit && hit.root !== hwndOf(win) && DESKTOP.test(hit.rootCls)) {
      diagnostic.note('buttons', `went under the desktop (${hit.rootCls}): put back above`);
      placeAboveDesktop(win);
    }
  }, 2000);
}

function updateControls() {
  const { isScene, widgetBounds } = S.actions;
  const rect = S.controlsRect;
  const wanted = isScene() && !S.editing && !S.settings.get('sceneHidden') && rect && !S.alive(S.editorWin); // the editor has its own dummy buttons
  if (!wanted) {
    // destroy() rather than close(): the window disappears right away, a
    // quick request to recreate it does not land on a half-closed window.
    const old = S.controlsWin;
    S.controlsWin = null;
    if (S.alive(old)) old.destroy();
    return;
  }
  const wb = widgetBounds();
  const bounds = {
    x: Math.round(wb.x + rect.x),
    y: Math.round(wb.y + rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
  if (!S.alive(S.controlsWin)) {
    const win = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      // Not activatable: a click on a button does not bring it in front of the
      // other windows and does not steal the focus.
      resizable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      focusable: false,
      show: false,
      title: 'Sillon · buttons',
      webPreferences: { ...SAFE_PREFS, preload: S.PRELOAD, backgroundThrottling: false },
    });
    S.controlsWin = win;
    secureWindow(win);
    win.loadFile(path.join(S.RENDERER, 'controls.html'));
    win.webContents.on('did-finish-load', () => {
      if (!S.alive(win)) return;
      S.send([win], 'media', { ...S.lastMedia, cover: undefined }); // the buttons do not show the cover
      win.showInactive();
      sendToBottom(win);
      placeAboveDesktop(win);
    });
    win.webContents.on('render-process-gone', (_e, d) =>
      diagnostic.note('buttons', `page crashed (${d.reason}): reloading`),
    );
    win.webContents.on('render-process-gone', () => setTimeout(() => S.alive(win) && win.reload(), 500));
    watchControls();
    win.on('closed', () => {
      if (S.controlsWin === win) S.controlsWin = null;
    });
  } else {
    S.controlsWin.setBounds(bounds);
    sendToBottom(S.controlsWin);
    placeAboveDesktop(S.controlsWin);
  }
}

module.exports = { updateControls };
