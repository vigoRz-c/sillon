const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, globalShortcut,
  session, desktopCapturer, nativeImage,
} = require('electron');
const path = require('path');
const { Settings } = require('./settings');
const { WindowsMediaSource } = require('./media');
const { WallpaperAttacher } = require('./wallpaper');

if (!app.requestSingleInstanceLock()) app.quit();

const RENDERER = path.join(__dirname, '..', 'renderer');
const ASSETS = path.join(__dirname, '..', '..', 'assets');

let settings;
let media;
let tray;
let widget;
let attacher;
let fullscreen = null;
let editing = false;
let lastMedia = { active: false };

const STYLES = [
  ['bars', 'Barres'], ['mirror', 'Miroir'], ['ring', 'Anneau'],
  ['wave', 'Onde'], ['aurora', 'Aurore'],
];
const THEMES = [
  ['album', 'Couleurs de la pochette'], ['spotify', 'Spotify'], ['neon', 'Néon'],
  ['sunset', 'Coucher de soleil'], ['ocean', 'Océan'], ['mono', 'Blanc'],
];
const MODES = [
  ['wallpaper', 'Sur le fond d\'écran (derrière les fenêtres)'],
  ['top', 'Toujours au premier plan'],
  ['normal', 'Fenêtre normale'],
];

// ---------- Fenêtre widget ----------

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.round(Math.min(960, workArea.width * 0.6));
  const height = 300;
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + workArea.height - height - 40),
    width, height,
  };
}

function widgetBounds() {
  const b = settings.get('bounds');
  if (!b) return defaultBounds();
  // Si l'écran qui l'accueillait a disparu, on revient au placement par défaut.
  const visible = screen.getAllDisplays().some(({ bounds: d }) =>
    b.x < d.x + d.width && b.x + b.width > d.x && b.y < d.y + d.height && b.y + b.height > d.y);
  return visible ? b : defaultBounds();
}

function createWidget() {
  widget = new BrowserWindow({
    ...widgetBounds(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    // Les fenêtres transparentes ne se redimensionnent pas bien sous Windows :
    // le coin de redimensionnement est géré dans la page (mode placement).
    resizable: false,
    show: false,
    title: 'Spoti-View',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  widget.loadFile(path.join(RENDERER, 'widget.html'));
  attacher = new WallpaperAttacher(widget);

  widget.once('ready-to-show', () => {
    applyMode();
    startAudio(widget);
  });
  widget.webContents.on('did-finish-load', () => {
    widget.webContents.send('settings', settings.get());
    widget.webContents.send('media', lastMedia);
  });
}

function applyMode() {
  if (!widget || widget.isDestroyed()) return;
  const mode = settings.get('mode');
  const bounds = widgetBounds();
  attacher.detach();
  widget.setAlwaysOnTop(false);

  if (editing) {
    widget.setIgnoreMouseEvents(false);
    widget.setFocusable(true);
    widget.setAlwaysOnTop(true);
    widget.setBounds(bounds);
    widget.show();
    widget.focus();
  } else if (mode === 'wallpaper') {
    widget.setIgnoreMouseEvents(true);
    widget.setFocusable(false);
    widget.setBounds(bounds);
    try {
      const layout = attacher.attach(bounds);
      console.log('Accroché au fond d\'écran, disposition :', layout);
    } catch (e) {
      // Pas d'accroche possible : on reste une fenêtre au fond de la pile.
      console.error(e.message);
      widget.showInactive();
    }
  } else {
    widget.setIgnoreMouseEvents(mode === 'top', { forward: true });
    widget.setFocusable(mode === 'normal');
    widget.setAlwaysOnTop(mode === 'top', 'floating');
    widget.setBounds(bounds);
    widget.showInactive();
  }
  widget.webContents.send('editing', editing);
}

function setEditing(on) {
  if (!on && editing && widget && !widget.isDestroyed()) {
    settings.set({ bounds: widget.getBounds() });
  }
  editing = on;
  applyMode();
  buildTray();
}

// ---------- Audio : capture de la sortie du PC (loopback) ----------

function setupLoopback() {
  // getDisplayMedia() dans la page reçoit l'écran (ignoré) + le son du système.
  // Jamais le micro.
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch(() => callback({}));
  });
}

function startAudio(win) {
  // Le "true" simule un geste utilisateur, exigé par getDisplayMedia.
  win.webContents.executeJavaScript('window.spotiView && window.spotiView.startAudio()', true)
    .catch((e) => console.error('Audio :', e.message));
}

// ---------- Plein écran ----------

function toggleFullscreen() {
  if (fullscreen && !fullscreen.isDestroyed()) { fullscreen.close(); return; }
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  fullscreen = new BrowserWindow({
    ...display.bounds,
    fullscreen: true,
    frame: false,
    backgroundColor: '#000000',
    skipTaskbar: false,
    title: 'Spoti-View',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  fullscreen.loadFile(path.join(RENDERER, 'fullscreen.html'));
  fullscreen.webContents.on('did-finish-load', () => {
    fullscreen.webContents.send('settings', settings.get());
    fullscreen.webContents.send('media', lastMedia);
    startAudio(fullscreen);
  });
  fullscreen.on('closed', () => { fullscreen = null; });
}

// ---------- Morceau en cours ----------

function startMedia() {
  media = new WindowsMediaSource({ prefer: settings.get('preferApp') });
  media.on('media', (m) => {
    lastMedia = m;
    for (const w of [widget, fullscreen]) {
      if (w && !w.isDestroyed()) w.webContents.send('media', m);
    }
    buildTray();
  });
  media.on('error', (e) => console.error('Média :', e.message));
  media.start();
}

// ---------- Réglages ----------

function updateSettings(patch) {
  const all = settings.set(patch);
  for (const w of [widget, fullscreen]) {
    if (w && !w.isDestroyed()) w.webContents.send('settings', all);
  }
  if ('mode' in patch) applyMode();
  if ('preferApp' in patch && media) media.setPreferredApp(patch.preferApp);
  if ('launchAtLogin' in patch) app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin });
  buildTray();
}

// ---------- Barre des tâches (zone de notification) ----------

function radio(list, key) {
  return list.map(([value, label]) => ({
    label, type: 'radio', checked: settings.get(key) === value,
    click: () => updateSettings({ [key]: value }),
  }));
}

function buildTray() {
  if (!tray) {
    tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'tray.png')));
    tray.setToolTip('Spoti-View');
    tray.on('click', () => tray.popUpContextMenu());
  }
  const now = lastMedia.active && lastMedia.title
    ? `${lastMedia.title} — ${lastMedia.artist || ''}`.slice(0, 60)
    : 'Rien en lecture';
  const s = settings.get();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: now, enabled: false },
    { label: 'Lecture / pause', click: () => media && media.command('playpause') },
    { label: 'Suivant', click: () => media && media.command('next') },
    { label: 'Précédent', click: () => media && media.command('previous') },
    { type: 'separator' },
    { label: 'Style', submenu: radio(STYLES, 'style') },
    { label: 'Couleurs', submenu: radio(THEMES, 'theme') },
    { label: 'Position', submenu: radio(MODES, 'mode') },
    {
      label: 'Réglages', submenu: [
        { label: 'Afficher le morceau en cours', type: 'checkbox', checked: s.showNowPlaying,
          click: (i) => updateSettings({ showNowPlaying: i.checked }) },
        { label: 'Sensibilité', submenu: [0.6, 1, 1.5, 2.2].map((v) => ({
          label: `× ${v}`, type: 'radio', checked: s.sensitivity === v,
          click: () => updateSettings({ sensitivity: v }) })) },
        { label: 'Opacité', submenu: [0.4, 0.6, 0.8, 1].map((v) => ({
          label: `${v * 100} %`, type: 'radio', checked: s.opacity === v,
          click: () => updateSettings({ opacity: v }) })) },
        { label: 'Images par seconde', submenu: [30, 60].map((v) => ({
          label: `${v}`, type: 'radio', checked: s.fps === v,
          click: () => updateSettings({ fps: v }) })) },
        { label: 'Suivre en priorité', submenu: [
          { label: 'Spotify', type: 'radio', checked: s.preferApp === 'spotify',
            click: () => updateSettings({ preferApp: 'spotify' }) },
          { label: 'Le lecteur actif (YouTube, VLC…)', type: 'radio', checked: !s.preferApp,
            click: () => updateSettings({ preferApp: '' }) },
        ] },
        { label: 'Lancer au démarrage de Windows', type: 'checkbox', checked: s.launchAtLogin,
          click: (i) => updateSettings({ launchAtLogin: i.checked }) },
        { label: 'Remettre la position par défaut', click: () => { settings.set({ bounds: null }); applyMode(); } },
      ],
    },
    { type: 'separator' },
    { label: editing ? '✔ Terminer le placement' : 'Déplacer / redimensionner…', click: () => setEditing(!editing) },
    { label: 'Plein écran   Ctrl+Alt+F', click: toggleFullscreen },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]));
}

// ---------- IPC ----------

ipcMain.handle('settings:get', () => settings.get());
ipcMain.on('settings:set', (_e, patch) => updateSettings(patch));
ipcMain.on('media:command', (_e, cmd) => media && media.command(cmd));
ipcMain.on('edit:done', () => setEditing(false));
ipcMain.on('widget:resize', (_e, { width, height }) => {
  if (!editing || !widget || widget.isDestroyed()) return;
  const b = widget.getBounds();
  widget.setBounds({ ...b, width: Math.max(240, Math.round(width)), height: Math.max(120, Math.round(height)) });
});
ipcMain.on('fullscreen:close', () => fullscreen && !fullscreen.isDestroyed() && fullscreen.close());

// ---------- Démarrage ----------

app.whenReady().then(() => {
  app.setAppUserModelId('com.loicrestout.spotiview');
  settings = new Settings();
  setupLoopback();
  createWidget();
  startMedia();
  buildTray();
  globalShortcut.register('CommandOrControl+Alt+F', toggleFullscreen);

  // Écrans branchés/débranchés ou changement de résolution : on se replace.
  const replace = () => setTimeout(applyMode, 500);
  screen.on('display-added', replace);
  screen.on('display-removed', replace);
  screen.on('display-metrics-changed', replace);
});

app.on('second-instance', () => tray && tray.popUpContextMenu());
app.on('window-all-closed', (e) => e.preventDefault()); // on vit dans la zone de notification
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (media) media.stop();
  if (attacher) attacher.detach();
});
