const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, globalShortcut,
  session, desktopCapturer, nativeImage, powerMonitor,
} = require('electron');
const path = require('path');
const { Settings } = require('./settings');
const { WindowsMediaSource } = require('./media');
const { lookupCover } = require('./cover-lookup');
const { lookupLyrics } = require('./lyrics');
const { WallpaperAttacher, sendToBottom, lockWorkstation } = require('./wallpaper');

if (!app.requestSingleInstanceLock()) app.quit();

const RENDERER = path.join(__dirname, '..', 'renderer');
const ASSETS = path.join(__dirname, '..', '..', 'assets');

let settings;
let media;
let tray;
let widget;
let attacher;
let fullscreen = null;
let settingsWin = null;
let controlsWin = null;
let veilleWins = [];
let controlsRect = null;
let editing = false;
let lastMedia = { active: false };
let lastLyrics = null;

const STYLES = [
  ['bars', 'Barres'], ['mirror', 'Miroir'], ['ring', 'Anneau'],
  ['wave', 'Onde'], ['aurora', 'Aurore'],
];
const THEMES = [
  ['wallpaper', 'Couleurs du fond d\'écran'],
  ['album', 'Couleurs de la pochette'], ['spotify', 'Spotify'], ['neon', 'Néon'],
  ['sunset', 'Coucher de soleil'], ['ocean', 'Océan'], ['mono', 'Blanc'],
];
const LAYOUTS = [
  ['scene', 'Scène : disque, paroles et panneau sur tout le bureau'],
  ['strip', 'Bandeau : barres et morceau en bas de l\'écran'],
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

// Le widget suit l'écran principal choisi dans Windows : la position enregistrée
// est relative à la zone de travail de cet écran (rx, ry), pas au bureau entier.
// Changer d'écran principal le fait donc suivre, à la même place.
// La scène occupe toute la zone de travail de l'écran principal. Elle n'a de
// sens que sur le fond d'écran : en mode "premier plan" ou "fenêtre", elle
// couvrirait tout, on revient alors au bandeau.
function isScene() {
  return settings.get('layout') !== 'strip' && settings.get('mode') === 'wallpaper';
}

function widgetBounds() {
  if (isScene()) {
    const { workArea: wa } = screen.getPrimaryDisplay();
    return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  }
  const b = settings.get('bounds');
  if (!b) return defaultBounds();
  const { workArea: wa } = screen.getPrimaryDisplay();
  if (!('rx' in b)) return defaultBounds(); // ancien format absolu : on repart du défaut
  const width = Math.min(b.width, wa.width);
  const height = Math.min(b.height, wa.height);
  return {
    x: Math.round(wa.x + Math.max(0, Math.min(b.rx, wa.width - width))),
    y: Math.round(wa.y + Math.max(0, Math.min(b.ry, wa.height - height))),
    width, height,
  };
}

function saveWidgetBounds(b) {
  const { workArea: wa } = screen.getPrimaryDisplay();
  settings.set({ bounds: { rx: b.x - wa.x, ry: b.y - wa.y, width: b.width, height: b.height } });
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
    startWallpaperSampling();
  });
  widget.webContents.on('did-finish-load', () => {
    widget.webContents.send('settings', settings.get());
    widget.webContents.send('media', lastMedia);
    if (lastLyrics) widget.webContents.send('lyrics', lastLyrics);
    if (wallpaperSample) widget.webContents.send('wallpaper', wallpaperSample);
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
  updateControls();
}

// ---------- Boutons du panneau (scène) ----------
// La scène vit sous les icônes du bureau : elle ne reçoit aucun clic. Les
// boutons du panneau sont donc une petite fenêtre à part, posée exactement
// au-dessus d'eux et maintenue tout en bas de la pile des fenêtres (au-dessus
// du bureau, sous toutes les applications). Elle ne prend jamais le focus.

function updateControls() {
  const wanted = isScene() && !editing && settings.get('showPanel') !== false && controlsRect;
  if (!wanted) {
    if (controlsWin && !controlsWin.isDestroyed()) controlsWin.close();
    return;
  }
  const wb = widgetBounds();
  const bounds = {
    x: Math.round(wb.x + controlsRect.x), y: Math.round(wb.y + controlsRect.y),
    width: Math.round(controlsRect.width), height: Math.round(controlsRect.height),
  };
  if (!controlsWin || controlsWin.isDestroyed()) {
    controlsWin = new BrowserWindow({
      ...bounds,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      // Non activable : un clic sur un bouton ne la fait pas passer devant les
      // autres fenêtres et ne vole pas le focus.
      resizable: false, minimizable: false, maximizable: false, skipTaskbar: true,
      focusable: false, show: false,
      title: 'Spoti-View · boutons',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
    });
    controlsWin.loadFile(path.join(RENDERER, 'controls.html'));
    controlsWin.webContents.on('did-finish-load', () => {
      controlsWin.webContents.send('media', lastMedia);
      controlsWin.showInactive();
      sendToBottom(controlsWin);
    });
    controlsWin.on('closed', () => { controlsWin = null; });
  } else {
    controlsWin.setBounds(bounds);
    sendToBottom(controlsWin);
  }
}

function setEditing(on) {
  if (!on && editing && widget && !widget.isDestroyed()) {
    saveWidgetBounds(widget.getBounds());
  }
  editing = on;
  applyMode();
  buildTray();
  if (!on) setTimeout(sampleWallpaper, 800);
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

// ---------- Couleurs du fond d'écran ----------
// On prend une petite capture de l'écran qui porte le widget, recadrée sur la
// zone du widget, pour que la page en tire sa palette. Rafraîchie régulièrement
// (fond d'écran animé, diaporama). Une fenêtre ouverte par-dessus peut fausser
// une mesure : la suivante corrige.

let wallpaperSample = null;
let wallpaperTimer = null;

async function sampleWallpaper() {
  if (!widget || widget.isDestroyed()) return;
  try {
    const bounds = widget.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const W = 480, H = Math.round(480 * display.bounds.height / display.bounds.width);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: W, height: H } });
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) return;
    // Zone du widget, élargie pour capter l'ambiance autour.
    const sx = W / display.bounds.width, sy = H / display.bounds.height;
    const pad = 80;
    const x = Math.max(0, Math.round((bounds.x - display.bounds.x - pad) * sx));
    const y = Math.max(0, Math.round((bounds.y - display.bounds.y - pad) * sy));
    const crop = {
      x, y,
      width: Math.min(W - x, Math.round((bounds.width + pad * 2) * sx)),
      height: Math.min(H - y, Math.round((bounds.height + pad * 2) * sy)),
    };
    const img = crop.width > 4 && crop.height > 4 ? src.thumbnail.crop(crop) : src.thumbnail;
    wallpaperSample = img.toDataURL();
    for (const w of [widget, fullscreen]) {
      if (w && !w.isDestroyed()) w.webContents.send('wallpaper', wallpaperSample);
    }
  } catch (e) {
    console.error('Couleurs du fond d\'écran :', e.message);
  }
}

function startWallpaperSampling() {
  clearInterval(wallpaperTimer);
  setTimeout(sampleWallpaper, 1500);
  wallpaperTimer = setInterval(sampleWallpaper, 60000);
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
    if (lastLyrics) fullscreen.webContents.send('lyrics', lastLyrics);
    if (wallpaperSample) fullscreen.webContents.send('wallpaper', wallpaperSample);
    startAudio(fullscreen);
  });
  fullscreen.on('closed', () => { fullscreen = null; });
}

// ---------- Écran de veille ----------
// Windows + L ouvre un bureau sécurisé où aucune application ne peut dessiner.
// À la place : après un temps d'inactivité (ou avec Ctrl+Alt+L), la scène
// s'affiche en plein écran par-dessus tout ; au premier mouvement ou à la
// première touche, elle se ferme et la session est verrouillée.

const veilleActive = () => veilleWins.some((w) => !w.isDestroyed());

function startVeille() {
  if (veilleActive()) return;
  if (fullscreen && !fullscreen.isDestroyed()) fullscreen.close();
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  const primary = screen.getPrimaryDisplay();
  for (const d of screen.getAllDisplays()) {
    const main = d.id === primary.id;
    const win = new BrowserWindow({
      ...d.bounds, frame: false, fullscreen: true, backgroundColor: '#000000',
      alwaysOnTop: true, skipTaskbar: true, show: false, title: 'Spoti-View · veille',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    if (main) {
      win.loadFile(path.join(RENDERER, 'fullscreen.html'), { query: { veille: '1' } });
      win.webContents.on('did-finish-load', () => {
        win.webContents.send('settings', settings.get());
        win.webContents.send('media', lastMedia);
        if (lastLyrics) win.webContents.send('lyrics', lastLyrics);
        startAudio(win);
      });
      fullscreen = win; // reçoit les mises à jour du morceau, des paroles et des réglages
    } else {
      // Les autres écrans : noirs, et ils réveillent aussi.
      win.loadURL('data:text/html,' + encodeURIComponent('<body style="margin:0;background:#000;cursor:none"><script>setTimeout(()=>{for(const e of ["mousedown","keydown","wheel"])addEventListener(e,()=>bridge.veilleExit())},1500)</script></body>'));
    }
    win.once('ready-to-show', () => { if (main) { win.show(); win.focus(); } else win.showInactive(); });
    win.on('closed', () => { veilleWins = veilleWins.filter((w) => w !== win); });
    veilleWins.push(win);
  }
}

function stopVeille() {
  if (!veilleActive()) return;
  const wins = veilleWins;
  veilleWins = [];
  for (const w of wins) if (!w.isDestroyed()) w.destroy();
  fullscreen = null;
  if (settings.get('veilleLock') !== false) lockWorkstation();
}

function watchIdle() {
  setInterval(() => {
    const delay = Number(settings.get('veilleDelay')) || 0;
    if (!delay || veilleActive() || editing) return;
    if (fullscreen && !fullscreen.isDestroyed()) return; // déjà en plein écran Spoti-View
    if (settings.get('veilleOnlyPlaying') !== false && !(lastMedia.active && lastMedia.status === 'Playing')) return;
    if (powerMonitor.getSystemIdleTime() >= delay * 60) startVeille();
  }, 5000);
  // Session verrouillée ou mise en veille par ailleurs : on range la scène sans reverrouiller.
  const quiet = () => {
    for (const w of veilleWins) if (!w.isDestroyed()) w.destroy();
    veilleWins = [];
    fullscreen = null;
  };
  powerMonitor.on('lock-screen', quiet);
  powerMonitor.on('suspend', quiet);
}

// ---------- Fenêtre de paramètres ----------

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  // Sur l'écran du plein écran s'il est ouvert, sinon sur l'écran principal.
  const parent = fullscreen && !fullscreen.isDestroyed() ? fullscreen : null;
  const display = parent ? screen.getDisplayMatching(parent.getBounds()) : screen.getPrimaryDisplay();
  const width = 420, height = 700;
  const { workArea: wa } = display;
  settingsWin = new BrowserWindow({
    width, height,
    x: Math.round(wa.x + wa.width - width - 24),
    y: Math.round(wa.y + 80),
    parent: parent || undefined,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    alwaysOnTop: !!parent,
    skipTaskbar: !!parent,
    title: 'Paramètres · Spoti-View',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  settingsWin.loadFile(path.join(RENDERER, 'settings.html'));
  settingsWin.on('closed', () => {
    settingsWin = null;
    // La fenêtre de paramètres a pu remonter les boutons : on les renvoie au fond.
    if (controlsWin && !controlsWin.isDestroyed()) sendToBottom(controlsWin);
  });
}

// ---------- Morceau en cours ----------

function startMedia() {
  media = new WindowsMediaSource({ prefer: settings.get('preferApp') });
  const broadcast = (m) => {
    lastMedia = m;
    for (const w of [widget, fullscreen, controlsWin]) {
      if (w && !w.isDestroyed()) w.webContents.send('media', m);
    }
  };
  const sendLyrics = (l) => {
    lastLyrics = l;
    for (const w of [widget, fullscreen]) {
      if (w && !w.isDestroyed()) w.webContents.send('lyrics', l);
    }
  };
  // L'image donnée par Windows est remplacée par la pochette officielle (Deezer)
  // dès qu'elle est trouvée ; sinon on garde celle de Windows.
  let trackKey = '';
  let officialCover = null;
  media.on('media', (m) => {
    const key = m.active ? `${m.app}|${m.title}|${m.artist}|${m.album}` : '';
    if (key !== trackKey) {
      trackKey = key;
      officialCover = null;
      // Paroles : vides tant qu'on cherche, puis celles de LRCLIB si elles existent.
      sendLyrics({ title: m.title || '', artist: m.artist || '', lines: [], pending: !!key });
      if (key) {
        lookupLyrics(m).then((l) => {
          if (trackKey !== key) return;
          sendLyrics({ title: m.title, artist: m.artist, lines: l ? l.lines : [], instrumental: !!(l && l.instrumental) });
        });
        lookupCover(m).then((cover) => {
          if (!cover || trackKey !== key) return;
          officialCover = cover;
          broadcast({ ...lastMedia, cover });
        });
      }
    }
    broadcast(officialCover ? { ...m, cover: officialCover } : m);
    buildTray();
  });
  media.on('error', (e) => console.error('Média :', e.message));
  media.start();
}

// ---------- Réglages ----------

function updateSettings(patch) {
  const all = settings.set(patch);
  for (const w of [widget, fullscreen, settingsWin]) {
    if (w && !w.isDestroyed()) w.webContents.send('settings', all);
  }
  if ('mode' in patch || 'layout' in patch) {
    applyMode();
    setTimeout(sampleWallpaper, 1200);
  }
  if ('showPanel' in patch) updateControls();
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
    { label: 'Disposition', submenu: radio(LAYOUTS, 'layout') },
    { label: 'Position', submenu: radio(MODES, 'mode') },
    {
      label: 'Réglages', submenu: [
        { label: 'Afficher le morceau en cours', type: 'checkbox', checked: s.showNowPlaying,
          click: (i) => updateSettings({ showNowPlaying: i.checked }) },
        { label: 'Afficher les paroles', type: 'checkbox', checked: s.showLyrics !== false,
          click: (i) => updateSettings({ showLyrics: i.checked }) },
        { label: 'Afficher le panneau (scène)', type: 'checkbox', checked: s.showPanel !== false,
          click: (i) => updateSettings({ showPanel: i.checked }) },
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
        { label: 'Écran de veille', submenu: [
          ...[0, 1, 2, 5, 10, 15, 30].map((v) => ({
            label: v ? `Après ${v} min d'inactivité` : 'Jamais', type: 'radio',
            checked: Number(s.veilleDelay) === v, click: () => updateSettings({ veilleDelay: v }) })),
          { type: 'separator' },
          { label: 'Seulement pendant la lecture', type: 'checkbox', checked: s.veilleOnlyPlaying !== false,
            click: (i) => updateSettings({ veilleOnlyPlaying: i.checked }) },
          { label: 'Verrouiller la session en sortant', type: 'checkbox', checked: s.veilleLock !== false,
            click: (i) => updateSettings({ veilleLock: i.checked }) },
        ] },
        { label: 'Lancer au démarrage de Windows', type: 'checkbox', checked: s.launchAtLogin,
          click: (i) => updateSettings({ launchAtLogin: i.checked }) },
        { label: 'Remettre la position par défaut', click: () => { settings.set({ bounds: null }); applyMode(); } },
      ],
    },
    { type: 'separator' },
    { label: 'Paramètres…', click: openSettings },
    { label: editing ? '✔ Terminer le placement' : 'Déplacer / redimensionner…', click: () => setEditing(!editing),
      enabled: editing || !isScene() },
    { label: 'Plein écran   Ctrl+Alt+F', click: toggleFullscreen },
    { label: 'Écran de veille   Ctrl+Alt+L', click: startVeille },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]));
}

// ---------- IPC ----------

ipcMain.handle('settings:get', () => settings.get());
ipcMain.on('settings:set', (_e, patch) => updateSettings(patch));
ipcMain.on('media:command', (_e, cmd) => media && media.command(cmd));
ipcMain.on('edit:done', () => setEditing(false));
ipcMain.on('settings:open', openSettings);
ipcMain.on('edit:start', () => {
  if (isScene()) return; // la scène occupe tout l'écran : rien à déplacer
  if (fullscreen && !fullscreen.isDestroyed()) fullscreen.close();
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
  setEditing(true);
});
ipcMain.on('bounds:reset', () => { settings.set({ bounds: null }); applyMode(); });
ipcMain.on('widget:resize', (_e, { width, height }) => {
  if (!editing || !widget || widget.isDestroyed()) return;
  const b = widget.getBounds();
  widget.setBounds({ ...b, width: Math.max(240, Math.round(width)), height: Math.max(120, Math.round(height)) });
});
ipcMain.on('scene:controls-rect', (e, rect) => {
  if (!widget || e.sender !== widget.webContents) return;
  controlsRect = rect && rect.width > 0 ? rect : null;
  updateControls();
});
ipcMain.on('veille:exit', stopVeille);
ipcMain.on('veille:start', () => setTimeout(startVeille, 300));
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
  if (!globalShortcut.register('CommandOrControl+Alt+L', startVeille)) {
    console.error('Raccourci Ctrl+Alt+L déjà pris par une autre application.');
  }
  watchIdle();

  // Écrans branchés/débranchés ou changement de résolution : on se replace.
  // Changer d'écran principal dans les paramètres Windows déplace les écrans :
  // on suit le nouveau principal. Un contrôle périodique couvre les cas où
  // Windows ne prévient pas.
  let replaceTimer = null;
  const primaryKey = () => { const p = screen.getPrimaryDisplay(); return `${p.id}|${JSON.stringify(p.workArea)}|${p.scaleFactor}`; };
  let lastPrimary = primaryKey();
  const replace = () => {
    clearTimeout(replaceTimer);
    replaceTimer = setTimeout(() => {
      lastPrimary = primaryKey();
      if (!editing) applyMode();
      setTimeout(sampleWallpaper, 1000);
    }, 500);
  };
  screen.on('display-added', replace);
  screen.on('display-removed', replace);
  screen.on('display-metrics-changed', replace);
  setInterval(() => { if (primaryKey() !== lastPrimary) replace(); }, 3000);
});

app.on('second-instance', () => tray && tray.popUpContextMenu());
app.on('window-all-closed', (e) => e.preventDefault()); // on vit dans la zone de notification
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (media) media.stop();
  if (attacher) attacher.detach();
  if (controlsWin && !controlsWin.isDestroyed()) controlsWin.destroy();
});
