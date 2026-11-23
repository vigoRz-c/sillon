// Durcissement commun des fenêtres : aucune nouvelle fenêtre, aucune
// navigation hors de la page chargée.

function secureWindow(win) {
  const wc = win.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame) e.preventDefault();
  });
  return win;
}

module.exports = { secureWindow };
