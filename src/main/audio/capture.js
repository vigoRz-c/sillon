// Captures: system sound (loopback) and wallpaper colors.

const { session, desktopCapturer, screen } = require('electron');
const S = require('../app/state');
const diagnostic = require('../app/diagnostic');
const { isAppUrl } = require('../app/ipc-guard');

// ---------- Sound: capture of the PC's output ----------

// Only the app's pages get permissions (sound capture,
// clipboard of the settings…); any other page gets none.
const fromApp = (url) => isAppUrl(url, S.RENDERER);

function setupPermissions(ses) {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const ok = fromApp(details && details.requestingUrl);
    if (!ok) diagnostic.note('security', `permission "${permission}" refused to an external page`);
    callback(ok);
  });
  // Without a precise address (some checks), rely on the origin: file:// for our pages.
  ses.setPermissionCheckHandler((_wc, _permission, origin, details) =>
    details && details.requestingUrl ? fromApp(details.requestingUrl) : origin === 'file://',
  );
}

function setupLoopback() {
  const ses = session.defaultSession;
  setupPermissions(ses);
  // getDisplayMedia() in the page receives the screen (ignored) + the system sound.
  // Never the microphone.
  ses.setDisplayMediaRequestHandler((req, callback) => {
    // Request from a page that is not the app's (or already closed): nothing.
    if (!fromApp(req && req.frame && req.frame.url)) {
      diagnostic.note('security', 'sound capture refused to an external page');
      callback({});
      return;
    }
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch((e) => {
        console.error('Could not capture the system sound:', e.message);
        diagnostic.note('sound', `could not capture the system sound (${e.message})`);
        callback({});
      });
  });
}

// Starting in the windows and choosing the source: see app-audio.js.

// ---------- Wallpaper colors ----------
// Small capture of the screen that holds the widget, cropped to its area, so
// that the page takes its palette from it. Refreshed regularly (animated background,
// slideshow). A window opened on top may skew a measure: the
// next one corrects it.

let timer = null;

// Only the "wallpaper" theme uses it, and only if a page shows it
// (scene awake, full screen or editor).
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
    // Widget area, widened to catch the surrounding mood.
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
    const url = img.toDataURL();
    // Background unchanged: the pages already have these colors (no need to decode the image again).
    if (url === S.wallpaperSample) return;
    S.wallpaperSample = url;
    S.send([S.widget, S.fullscreen, S.editorWin], 'wallpaper', url);
  } catch (e) {
    console.error('Wallpaper colors:', e.message);
    diagnostic.note('wallpaper', `wallpaper colors impossible (${e.message})`);
  }
}

function startWallpaperSampling() {
  clearInterval(timer);
  setTimeout(sampleWallpaper, 1500);
  timer = setInterval(sampleWallpaper, 60000);
}

module.exports = { setupLoopback, sampleWallpaper, startWallpaperSampling };
