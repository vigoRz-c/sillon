// The widget: the scene (whole desktop) or the strip, attached to the wallpaper.

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const S = require('../app/state');
const { t } = require('../app/i18n');
const { WallpaperAttacher } = require('./wallpaper');
const { secureWindow, SAFE_PREFS } = require('./secure');
const diagnostic = require('../app/diagnostic');

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.round(Math.min(960, workArea.width * 0.6));
  const height = 300;
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + workArea.height - height - 40),
    width,
    height,
  };
}

// The scene takes the whole work area of a screen. It only makes sense
// on the wallpaper: in "top" or "window" mode, it would cover
// everything, so we fall back to the strip.
function isScene() {
  return S.settings.get('layout') !== 'strip' && S.settings.get('mode') === 'wallpaper';
}

// Scene's screen: Windows' primary one, or the first other screen.
function sceneDisplay() {
  const primary = screen.getPrimaryDisplay();
  if (S.settings.get('sceneScreen') !== 'secondary') return primary;
  return screen.getAllDisplays().find((d) => d.id !== primary.id) || primary;
}

// The strip follows the primary screen chosen in Windows: its position is
// saved relative to the work area of that screen (rx, ry).
function widgetBounds() {
  if (isScene()) {
    const { workArea: wa } = sceneDisplay();
    return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  }
  const b = S.settings.get('bounds');
  if (!b) return defaultBounds();
  const { workArea: wa } = screen.getPrimaryDisplay();
  if (!('rx' in b)) return defaultBounds(); // old absolute format: start again from the default
  const width = Math.min(b.width, wa.width);
  const height = Math.min(b.height, wa.height);
  return {
    x: Math.round(wa.x + Math.max(0, Math.min(b.rx, wa.width - width))),
    y: Math.round(wa.y + Math.max(0, Math.min(b.ry, wa.height - height))),
    width,
    height,
  };
}

function saveWidgetBounds(b) {
  const { workArea: wa } = screen.getPrimaryDisplay();
  S.settings.set({ bounds: { rx: b.x - wa.x, ry: b.y - wa.y, width: b.width, height: b.height } });
}

function createWidget() {
  const widget = new BrowserWindow({
    ...widgetBounds(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    skipTaskbar: true,
    // Transparent windows do not resize well on Windows:
    // the resize corner is handled in the page (placement mode).
    resizable: false,
    show: false,
    title: 'Sillon',
    webPreferences: { ...SAFE_PREFS, preload: S.PRELOAD, backgroundThrottling: false },
  });
  S.widget = widget;
  secureWindow(widget);
  widget.loadFile(path.join(S.RENDERER, 'widget.html'));
  S.attacher = new WallpaperAttacher(widget);

  widget.once('ready-to-show', () => {
    applyMode();
    S.actions.startAudio(widget);
    S.actions.startWallpaperSampling();
  });

  // Crashed page: reload it, then (did-finish-load) give it back all
  // its state and restart the sound. At most 3 crashes per minute, so as not
  // to loop.
  let reloading = false;
  let crashes = [];
  widget.webContents.on('render-process-gone', (_e, d) => {
    const now = Date.now();
    crashes = crashes.filter((t) => now - t < 60000);
    crashes.push(now);
    console.error(`Scene page crashed (${d.reason}).`);
    diagnostic.note('scene', `page crashed (${d.reason})${crashes.length > 3 ? ': giving up' : ': reloading'}`);
    if (crashes.length > 3) return;
    reloading = true;
    setTimeout(() => S.alive(widget) && widget.reload(), 500);
  });
  widget.webContents.on('did-finish-load', () => {
    S.replayTo(widget);
    S.send([widget], 'editing', S.editing);
    if (S.renderPaused) S.send([widget], 'render-pause', true);
    if (reloading) {
      reloading = false;
      S.actions.startAudio(widget);
    }
  });
}

function applyMode() {
  const widget = S.widget;
  if (!S.alive(widget)) return;
  const mode = S.settings.get('mode');
  const bounds = widgetBounds();
  S.attacher.detach();
  widget.setAlwaysOnTop(false);

  if (S.settings.get('sceneHidden') && !S.editing) {
    widget.hide();
  } else if (S.editing) {
    // Placement: the strip is hidden, the placement window replaces it.
    widget.hide();
  } else if (mode === 'wallpaper') {
    widget.setIgnoreMouseEvents(true);
    widget.setFocusable(false);
    widget.setBounds(bounds);
    try {
      const layout = S.attacher.attach(bounds);
      console.log('Attached to the wallpaper, layout:', layout);
    } catch (e) {
      // No attachment possible: we stay a window at the bottom of the stack.
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
  S.send([widget], 'editing', S.editing);
  S.actions.updateControls();
}

// Strip placement ("Move / resize"): a separate window,
// in the foreground, that shows the strip (widget.html?place=1), like
// the scene editor. The strip window stays attached to the
// wallpaper (hidden): no detaching / re-attaching on every placement.
let placeStart = null;

// Size chosen in the placement window, without Windows' rounding.
function placedBounds(win) {
  const b = win.getBounds();
  if (!placeStart) return b;
  const { target, actual } = placeStart;
  return {
    ...b,
    width: Math.max(1, target.width + b.width - actual.width),
    height: Math.max(1, target.height + b.height - actual.height),
  };
}

function openPlacer() {
  if (S.alive(S.placeWin)) {
    S.placeWin.focus();
    return;
  }
  const target = widgetBounds();
  const win = new BrowserWindow({
    ...target,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false, // handle managed in the page (see widget:resize)
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    show: false,
    title: t('window.place'),
    icon: path.join(S.ASSETS, 'icon.png'),
    webPreferences: { ...SAFE_PREFS, preload: S.PRELOAD, backgroundThrottling: false },
  });
  S.placeWin = win;
  secureWindow(win);
  win.loadFile(path.join(S.RENDERER, 'widget.html'), { query: { place: '1' } });
  win.webContents.on('did-finish-load', () => {
    S.replayTo(win);
    S.send([win], 'editing', true);
    S.actions.startAudio(win);
  });
  // With a fractional display scale (125 %…), Windows rounds a
  // transparent window to a few pixels more than asked: we remember
  // the difference so as not to grow the strip on every placement.
  placeStart = { target, actual: win.getBounds() };
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  // Closed other than with "Done" (Alt+F4…): placement stops too.
  win.on('closed', () => {
    if (S.placeWin !== win) return;
    S.placeWin = null;
    if (S.editing) setEditing(false);
  });
}

function setEditing(on) {
  if (on && isScene()) return; // the scene fills the whole screen: nothing to place
  if (!on && S.alive(S.placeWin)) {
    // If the layout became the scene during placement, these are no
    // longer the strip's dimensions: they are not saved.
    if (!isScene()) saveWidgetBounds(placedBounds(S.placeWin));
    const win = S.placeWin;
    S.placeWin = null;
    win.close();
  }
  S.editing = on;
  if (on) openPlacer();
  applyMode();
  S.actions.buildTray();
  if (S.actions.applyRest) S.actions.applyRest();
  if (!on) setTimeout(S.actions.sampleWallpaper, 800);
}

module.exports = { isScene, sceneDisplay, widgetBounds, createWidget, applyMode, setEditing };
