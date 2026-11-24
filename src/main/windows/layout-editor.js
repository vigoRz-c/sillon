// Scene layout editor.
//
// A foreground window, the size of the scene's screen, that
// shows the same page as the scene in edit mode (widget.html?edit=1), over
// the Windows wallpaper. "Done" saves the layout,
// "Cancel" (or Esc) closes without changing anything.

const { BrowserWindow, nativeImage, screen } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const S = require('../app/state');
const { t } = require('../app/i18n');
const diagnostic = require('../app/diagnostic');
const ipc = require('../app/ipc');
const { secureWindow, SAFE_PREFS } = require('./secure');
const SceneLayout = require('../../renderer/shared/scene-layout');

// Path of the Windows wallpaper (registry), or its internal copy.
function wallpaperPath() {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Control Panel\\Desktop', '/v', 'WallPaper'], { windowsHide: true }, (err, out) => {
      const m = !err && /WallPaper\s+REG_SZ\s+(.+)/i.exec(out || '');
      const p = m && m[1].trim();
      if (p && fs.existsSync(p)) return resolve(p);
      const t = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
      resolve(fs.existsSync(t) ? t : null);
    });
  });
}

// A single image may cover every screen (Windows' "span" mode,
// Wallpaper Engine): only the part of the wanted screen is kept.
function cropToDisplay(img, display) {
  const all = screen.getAllDisplays().map((d) => screen.dipToScreenRect(null, d.bounds));
  if (all.length < 2) return img;
  const vx = Math.min(...all.map((r) => r.x)),
    vy = Math.min(...all.map((r) => r.y));
  const vw = Math.max(...all.map((r) => r.x + r.width)) - vx;
  const vh = Math.max(...all.map((r) => r.y + r.height)) - vy;
  const { width: iw, height: ih } = img.getSize();
  // Does the image have the proportions of the whole desktop rather than of one screen?
  if (Math.abs(iw / ih - vw / vh) > 0.02) return img;
  const r = screen.dipToScreenRect(null, display.bounds);
  const k = iw / vw;
  return img.crop({
    x: Math.round((r.x - vx) * k),
    y: Math.round((r.y - vy) * k),
    width: Math.round(r.width * k),
    height: Math.round(r.height * k),
  });
}

async function wallpaperDataUrl(display) {
  try {
    const p = await wallpaperPath();
    if (!p) return S.wallpaperSample;
    let img = nativeImage.createFromPath(p);
    if (img.isEmpty()) return S.wallpaperSample;
    img = cropToDisplay(img, display);
    return img.resize({ width: Math.min(img.getSize().width, 1920), quality: 'good' }).toDataURL();
  } catch (e) {
    console.error('Could not read the wallpaper:', e.message);
    diagnostic.note('editor', `could not read the wallpaper (${e.message})`);
    return S.wallpaperSample;
  }
}

function openLayoutEditor() {
  if (S.alive(S.editorWin)) {
    S.editorWin.focus();
    return;
  }
  if (S.alive(S.settingsWin)) S.settingsWin.close();
  const display = S.actions.sceneDisplay();
  const { workArea: wa } = display;
  const win = new BrowserWindow({
    x: wa.x,
    y: wa.y,
    width: wa.width,
    height: wa.height,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    backgroundColor: '#0b0b10',
    show: false,
    title: t('window.editor'),
    icon: path.join(S.ASSETS, 'icon.png'),
    webPreferences: { ...SAFE_PREFS, preload: S.PRELOAD, backgroundThrottling: false },
  });
  S.editorWin = win;
  S.actions.updateControls();
  win.loadFile(path.join(S.RENDERER, 'widget.html'), { query: { edit: '1' } });
  secureWindow(win);
  win.webContents.on('did-finish-load', async () => {
    try {
      S.replayTo(win);
      S.actions.startAudio(win);
      setTimeout(S.actions.sampleWallpaper, 800);
      const background = await wallpaperDataUrl(display);
      if (!S.alive(win)) return; // closed while the wallpaper was being read
      S.send([win], 'editor-background', background);
    } catch (e) {
      console.error('Editor: loading the page:', e.message);
      diagnostic.note('editor', `loading the page: ${e.message}`);
    }
  });
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  win.on('closed', () => {
    if (S.editorWin === win) S.editorWin = null;
    S.actions.updateControls();
  });
}

function fromEditor(e) {
  return S.alive(S.editorWin) && e.sender === S.editorWin.webContents;
}

ipc.on('layout:open', () => openLayoutEditor());
ipc.on('layout:cancel', (e) => {
  if (fromEditor(e)) S.editorWin.close();
});
ipc.on('layout:done', (e, patch) => {
  if (!fromEditor(e) || !patch || typeof patch !== 'object') return;
  // Only these keys may come from the editor.
  const allowed = ['sceneLayout', 'discRays', 'discColors', 'panelRing', 'style'];
  const clean = {};
  for (const k of allowed) if (k in patch) clean[k] = patch[k];
  if ('sceneLayout' in clean) clean.sceneLayout = SceneLayout.fromSettings({ sceneLayout: clean.sceneLayout });
  S.actions.updateSettings(clean);
  S.editorWin.close();
});

module.exports = { openLayoutEditor };
