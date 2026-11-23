// Mises à jour automatiques (version installée uniquement).
//
// Sillon regarde les Releases GitHub du dépôt (voir "publish" dans
// package.json). Quand une version plus récente existe, elle est téléchargée
// en arrière-plan puis installée à la fermeture de l'app, ou tout de suite
// avec « Redémarrer pour mettre à jour ». La version portable et `npm start`
// ne se mettent pas à jour.

const { app, Notification } = require('electron');
const S = require('./state');

const CHECK_EVERY = 4 * 3600 * 1000; // toutes les 4 heures

let autoUpdater = null;
const U = { state: 'idle', version: null, progress: 0, error: '' };

function status() {
  return { ...U, current: app.getVersion(), enabled: app.isPackaged, auto: S.settings.get('autoUpdate') !== false };
}

function changed() {
  S.send([S.settingsWin], 'update-status', status());
  if (S.actions.buildTray) S.actions.buildTray();
}

function set(patch) {
  Object.assign(U, patch);
  changed();
}

function init() {
  if (!app.isPackaged) {
    U.state = 'dev';
    return;
  }
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info() {}, debug() {}, warn: console.warn, error: console.error };

  autoUpdater.on('checking-for-update', () => set({ state: 'checking', error: '' }));
  autoUpdater.on('update-not-available', () => set({ state: 'uptodate' }));
  autoUpdater.on('update-available', (info) => set({ state: 'downloading', version: info.version, progress: 0 }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', progress: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'ready', version: info.version, progress: 100 });
    if (Notification.isSupported()) {
      const n = new Notification({
        title: `Sillon ${info.version} est prêt`,
        body: "La mise à jour s'installera à la fermeture. Clique pour redémarrer maintenant.",
      });
      n.on('click', installNow);
      n.show();
    }
  });
  autoUpdater.on('error', (e) => set({ state: 'error', error: friendly(e) }));

  setTimeout(() => {
    if (S.settings.get('autoUpdate') !== false) check();
  }, 15000);
  setInterval(() => {
    if (S.settings.get('autoUpdate') !== false) check();
  }, CHECK_EVERY);
}

// Messages lisibles pour les erreurs les plus probables.
function friendly(e) {
  const msg = String((e && e.message) || e);
  if (/404|Cannot find latest|No published versions/i.test(msg)) {
    return 'Aucune version publiée trouvée sur GitHub (le dépôt doit être public et avoir une Release).';
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::/i.test(msg)) return 'Pas de connexion : nouvel essai plus tard.';
  return `Mise à jour impossible : ${msg.split('\n')[0]}`;
}

function check() {
  if (!autoUpdater) {
    changed();
    return;
  }
  if (U.state === 'downloading' || U.state === 'ready') {
    changed();
    return;
  }
  autoUpdater.checkForUpdates().catch((e) => set({ state: 'error', error: friendly(e) }));
}

function installNow() {
  if (!autoUpdater || U.state !== 'ready') return;
  // Installation silencieuse, puis Sillon redémarre tout seul.
  autoUpdater.quitAndInstall(true, true);
}

module.exports = { init, check, installNow, status };
