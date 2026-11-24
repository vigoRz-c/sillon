// Common window hardening: no new window, no
// navigation away from the loaded page.

function secureWindow(win) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame) e.preventDefault();
  });
  return win;
}

// Security preferences written out in full: they are Electron's defaults
// today, but a change of default or an option added by mistake must not
// undo them without anyone noticing.
const SAFE_PREFS = Object.freeze({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
});

module.exports = { secureWindow, SAFE_PREFS };
