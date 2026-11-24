// Automatic updates (installed version only).
//
// Sillon looks at the repository's GitHub Releases (see "publish" in
// package.json). When a newer version exists, it is downloaded
// in the background and then installed when the app closes, or right away
// with "Restart to update". The portable version and `npm start`
// do not update.

const { app, Notification } = require('electron');
const S = require('./state');
const diagnostic = require('./diagnostic');
const { t } = require('./i18n');

const CHECK_EVERY = 4 * 3600 * 1000; // every 4 hours
const DOWNLOAD_STALL = 10 * 60 * 1000; // download with no progress news: give up

let autoUpdater = null;
const U = { state: 'idle', version: null, progress: 0, error: '' };

// The portable version (standalone executable) does not go through the installer.
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

// If the network drops without an "error" event, the state would stay "downloading"
// forever (and no more checks). With no progress during
// DOWNLOAD_STALL, we go back to "idle": the next check tries again.
let stallTimer = null;
function set(patch) {
  Object.assign(U, patch);
  clearTimeout(stallTimer);
  stallTimer = null;
  if (U.state === 'downloading') {
    stallTimer = setTimeout(() => {
      stallTimer = null;
      if (U.state !== 'downloading') return;
      diagnostic.note('update', `download without progress for 10 min (${U.progress} %): giving up`);
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

// Readable messages for the most likely errors.
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
  // Silent install, then Sillon restarts on its own.
  autoUpdater.quitAndInstall(true, true);
}

module.exports = { init, check, installNow, status, DOWNLOAD_STALL };
