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

// Préférences de sécurité écrites noir sur blanc : ce sont les valeurs par
// défaut d'Electron aujourd'hui, mais un changement de défaut ou une option
// ajoutée par erreur ne doit pas les défaire sans qu'on le voie.
const SAFE_PREFS = Object.freeze({
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
});

module.exports = { secureWindow, SAFE_PREFS };
