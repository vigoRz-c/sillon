// Le widget : la scène (tout le bureau) ou le bandeau, accroché au fond d'écran.

const { BrowserWindow, screen } = require('electron');
const path = require('path');
const S = require('./state');
const { WallpaperAttacher } = require('./wallpaper');

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

// La scène occupe toute la zone de travail d'un écran. Elle n'a de sens que
// sur le fond d'écran : en mode "premier plan" ou "fenêtre", elle couvrirait
// tout, on revient alors au bandeau.
function isScene() {
  return S.settings.get('layout') !== 'strip' && S.settings.get('mode') === 'wallpaper';
}

// Écran de la scène : le principal de Windows, ou le premier autre écran.
function sceneDisplay() {
  const primary = screen.getPrimaryDisplay();
  if (S.settings.get('sceneScreen') !== 'secondary') return primary;
  return screen.getAllDisplays().find((d) => d.id !== primary.id) || primary;
}

// Le bandeau suit l'écran principal choisi dans Windows : sa position est
// enregistrée relativement à la zone de travail de cet écran (rx, ry).
function widgetBounds() {
  if (isScene()) {
    const { workArea: wa } = sceneDisplay();
    return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
  }
  const b = S.settings.get('bounds');
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
    // Les fenêtres transparentes ne se redimensionnent pas bien sous Windows :
    // le coin de redimensionnement est géré dans la page (mode placement).
    resizable: false,
    show: false,
    title: 'Sillon',
    webPreferences: { preload: S.PRELOAD, backgroundThrottling: false },
  });
  S.widget = widget;
  widget.loadFile(path.join(S.RENDERER, 'widget.html'));
  S.attacher = new WallpaperAttacher(widget);

  widget.once('ready-to-show', () => {
    applyMode();
    S.actions.startAudio(widget);
    S.actions.startWallpaperSampling();
  });
  widget.webContents.on('did-finish-load', () => {
    widget.webContents.send('settings', S.settings.get());
    widget.webContents.send('media', S.lastMedia);
    if (S.lastLyrics) widget.webContents.send('lyrics', S.lastLyrics);
    widget.webContents.send('queue', S.lastQueue);
    if (S.wallpaperSample) widget.webContents.send('wallpaper', S.wallpaperSample);
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
      const layout = S.attacher.attach(bounds);
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
  widget.webContents.send('editing', S.editing);
  S.actions.updateControls();
}

function setEditing(on) {
  if (!on && S.editing && S.alive(S.widget)) saveWidgetBounds(S.widget.getBounds());
  S.editing = on;
  applyMode();
  S.actions.buildTray();
  if (!on) setTimeout(S.actions.sampleWallpaper, 800);
}

module.exports = { isScene, widgetBounds, createWidget, applyMode, setEditing };
