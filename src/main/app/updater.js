// Mises à jour automatiques (version installée uniquement).
//
// Sillon regarde les Releases GitHub du dépôt (voir "publish" dans
// package.json). Quand une version plus récente existe, elle est téléchargée
// en arrière-plan puis installée à la fermeture de l'app, ou tout de suite
// avec « Redémarrer pour mettre à jour ». La version portable et `npm start`
// ne se mettent pas à jour.

const { app, Notification } = require('electron');
const S = require('./state');
const diagnostic = require('./diagnostic');
const { t } = require('./i18n');

const CHECK_EVERY = 4 * 3600 * 1000; // toutes les 4 heures
const DOWNLOAD_STALL = 10 * 60 * 1000; // téléchargement sans nouvelle de progression : abandon

let autoUpdater = null;
const U = { state: 'idle', version: null, progress: 0, error: '' };

// La version portable (exécutable autonome) ne passe pas par l'installateur.
const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_DIR;

function status() {
  return {
    ...U,
    current: app.getVersion(),
    enabled: app.isPackaged && !isPortable(),
    auto: S.settings.get('autoUpdate') !== false,
  };
}

function changed() {
  S.send([S.settingsWin], 'update-status', status());
  if (S.actions.buildTray) S.actions.buildTray();
}

// Si le réseau coupe sans événement « error », l'état resterait « downloading »
// pour toujours (et plus aucune vérification). Sans progression pendant
// DOWNLOAD_STALL, on repasse à « idle » : la prochaine vérification réessaie.
let stallTimer = null;
function set(patch) {
  Object.assign(U, patch);
  clearTimeout(stallTimer);
  stallTimer = null;
  if (U.state === 'downloading') {
    stallTimer = setTimeout(() => {
      stallTimer = null;
      if (U.state !== 'downloading') return;
      diagnostic.note('mise à jour', `téléchargement sans progression depuis 10 min (${U.progress} %) : abandon`);
      set({ state: 'idle', progress: 0 });
    }, DOWNLOAD_STALL);
    if (stallTimer.unref) stallTimer.unref();
  }
  changed();
}

function init() {
  if (!app.isPackaged) {
    U.state = 'dev';
    return;
  }
  if (isPortable()) {
    U.state = 'portable';
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
        title: t('updater.readyTitle', { version: info.version }),
        body: t('updater.readyBody'),
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
    return t('updater.noRelease');
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::/i.test(msg)) return t('updater.offline');
  return t('updater.failed', { error: msg.split('\n')[0] });
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

module.exports = { init, check, installNow, status, DOWNLOAD_STALL };
