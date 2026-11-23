// Captures : son du système (loopback) et couleurs du fond d'écran.

const { session, desktopCapturer, screen } = require('electron');
const S = require('../app/state');
const diagnostic = require('../app/diagnostic');

// ---------- Son : capture de la sortie du PC ----------

function setupLoopback() {
  // getDisplayMedia() dans la page reçoit l'écran (ignoré) + le son du système.
  // Jamais le micro.
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch((e) => {
        console.error('Capture du son du système impossible :', e.message);
        diagnostic.note('son', `capture du son du système impossible (${e.message})`);
        callback({});
      });
  });
}

// Le démarrage dans les fenêtres et le choix de la source : voir app-audio.js.

// ---------- Couleurs du fond d'écran ----------
// Petite capture de l'écran qui porte le widget, recadrée sur sa zone, pour
// que la page en tire sa palette. Rafraîchie régulièrement (fond animé,
// diaporama). Une fenêtre ouverte par-dessus peut fausser une mesure : la
// suivante corrige.

let timer = null;

// Seul le thème « fond d'écran » s'en sert, et seulement si une page l'affiche
// (scène éveillée, plein écran ou éditeur).
function wanted() {
  if (!S.settings || S.settings.get('theme') !== 'wallpaper') return false;
  return S.sceneActive() || S.alive(S.fullscreen) || S.alive(S.editorWin);
}

async function sampleWallpaper() {
  const widget = S.widget;
  if (!S.alive(widget) || !wanted()) return;
  try {
    const bounds = widget.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const W = 480,
      H = Math.round((480 * display.bounds.height) / display.bounds.width);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: W, height: H } });
    const src = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) return;
    // Zone du widget, élargie pour capter l'ambiance autour.
    const sx = W / display.bounds.width,
      sy = H / display.bounds.height;
    const pad = 80;
    const x = Math.max(0, Math.round((bounds.x - display.bounds.x - pad) * sx));
    const y = Math.max(0, Math.round((bounds.y - display.bounds.y - pad) * sy));
    const crop = {
      x,
      y,
      width: Math.min(W - x, Math.round((bounds.width + pad * 2) * sx)),
      height: Math.min(H - y, Math.round((bounds.height + pad * 2) * sy)),
    };
    const img = crop.width > 4 && crop.height > 4 ? src.thumbnail.crop(crop) : src.thumbnail;
    S.wallpaperSample = img.toDataURL();
    S.send([S.widget, S.fullscreen, S.editorWin], 'wallpaper', S.wallpaperSample);
  } catch (e) {
    console.error("Couleurs du fond d'écran :", e.message);
    diagnostic.note('fond', `couleurs du fond d'écran impossibles (${e.message})`);
  }
}

function startWallpaperSampling() {
  clearInterval(timer);
  setTimeout(sampleWallpaper, 1500);
  timer = setInterval(sampleWallpaper, 60000);
}

module.exports = { setupLoopback, sampleWallpaper, startWallpaperSampling };
