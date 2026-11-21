// Accrocher une fenêtre Electron sous les icônes du bureau.
//
// Explorer dessine le fond d'écran dans une fenêtre "WorkerW". Le message
// 0x052C envoyé à "Progman" la fait apparaître ; on s'y glisse avec SetParent.
// Deux dispositions existent :
//   - Windows 10 / 11 avant 24H2 : WorkerW est une fenêtre de premier niveau,
//     juste derrière celle qui contient les icônes (SHELLDLL_DefView).
//   - Windows 11 24H2 et + : WorkerW est un enfant de Progman, sous DefView.
//     On se place alors dans Progman, entre les icônes et le fond.

const { screen } = require('electron');

let api = null;
function win32() {
  if (api) return api;
  if (process.platform !== 'win32') throw new Error('Mode fond d\'écran : Windows uniquement.');
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });
  const EnumWindowsProc = koffi.proto('bool __stdcall EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
  api = {
    FindWindowW: user32.func('intptr_t __stdcall FindWindowW(const char16_t *cls, const char16_t *name)'),
    FindWindowExW: user32.func('intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, const char16_t *cls, const char16_t *name)'),
    SendMessageTimeoutW: user32.func('intptr_t __stdcall SendMessageTimeoutW(intptr_t hWnd, uint32_t msg, uintptr_t wParam, intptr_t lParam, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)'),
    EnumWindows: user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)'),
    SetParent: user32.func('intptr_t __stdcall SetParent(intptr_t child, intptr_t parent)'),
    GetAncestor: user32.func('intptr_t __stdcall GetAncestor(intptr_t hwnd, uint32_t flags)'),
    IsWindow: user32.func('bool __stdcall IsWindow(intptr_t hwnd)'),
    SetWindowPos: user32.func('bool __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)'),
    ScreenToClient: user32.func('bool __stdcall ScreenToClient(intptr_t hwnd, _Inout_ POINT *pt)'),
    ShowWindow: user32.func('bool __stdcall ShowWindow(intptr_t hwnd, int cmd)'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)'),
    SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hwnd, int index, intptr_t value)'),
    SetLayeredWindowAttributes: user32.func('bool __stdcall SetLayeredWindowAttributes(intptr_t hwnd, uint32_t key, uint8_t alpha, uint32_t flags)'),
  };
  return api;
}

const SMTO_NORMAL = 0x0000;
const SWP_NOACTIVATE = 0x0010;
const SWP_SHOWWINDOW = 0x0040;
const GA_PARENT = 1;
const GWL_EXSTYLE = -20;
const WS_EX_LAYERED = 0x80000;
const LWA_ALPHA = 0x2;

function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}

// Renvoie { parent, insertAfter } où insérer notre fenêtre, ou null.
function findWallpaperHost() {
  const w = win32();
  const progman = w.FindWindowW('Progman', null);
  if (!progman) return null;

  // Demande à Explorer de créer le WorkerW (sans effet s'il existe déjà).
  const out = [0];
  w.SendMessageTimeoutW(progman, 0x052C, 0xD, 0x1, SMTO_NORMAL, 1000, out);
  w.SendMessageTimeoutW(progman, 0x052C, 0, 0, SMTO_NORMAL, 1000, out);

  // Disposition 24H2 : WorkerW enfant de Progman.
  const childWorker = w.FindWindowExW(progman, 0, 'WorkerW', null);
  if (childWorker) {
    const defView = w.FindWindowExW(progman, 0, 'SHELLDLL_DefView', null);
    return { parent: progman, insertAfter: defView || 0, layout: '24H2' };
  }

  // Disposition classique : le WorkerW qui suit la fenêtre contenant les icônes.
  let worker = 0;
  w.EnumWindows((hwnd) => {
    const defView = w.FindWindowExW(hwnd, 0, 'SHELLDLL_DefView', null);
    if (defView) {
      worker = w.FindWindowExW(0, hwnd, 'WorkerW', null);
      return false;
    }
    return true;
  }, 0);
  if (worker) return { parent: worker, insertAfter: 0, layout: 'classic' };

  // Dernier recours : directement dans Progman.
  return { parent: progman, insertAfter: 0, layout: 'progman' };
}

class WallpaperAttacher {
  constructor(win) {
    this.win = win;
    this.host = null;
    this.watch = null;
  }

  attach(bounds) {
    const w = win32();
    const host = findWallpaperHost();
    if (!host) throw new Error('Impossible de trouver la fenêtre du bureau (Progman).');
    const hwnd = hwndOf(this.win);
    w.SetParent(hwnd, host.parent);
    // Sous 24H2, une fenêtre "layered" glissée dans Progman reste invisible tant
    // que ses attributs d'opacité ne sont pas posés (la page tourne, mais rien
    // n'est composé à l'écran). Wallpaper Engine fait de même.
    const ex = Number(w.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
    w.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED);
    w.SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
    this.host = host;
    // Electron repositionne la fenêtre en coordonnées écran quand il l'affiche ;
    // devenue enfant de Progman, Windows lit ces coordonnées par rapport au bureau
    // et la fenêtre file sur un autre écran. On l'affiche d'abord, puis on la place.
    this.win.showInactive();
    this.place(bounds);
    setTimeout(() => !this.win.isDestroyed() && this.host && this.place(bounds), 300);

    // Si Explorer redémarre ou que le fond change, on se ré-accroche.
    clearInterval(this.watch);
    this.watch = setInterval(() => {
      if (this.win.isDestroyed()) return clearInterval(this.watch);
      const parent = w.GetAncestor(hwnd, GA_PARENT);
      if (!w.IsWindow(this.host.parent) || parent !== this.host.parent) {
        try { this.attach(this.lastBounds); } catch { /* on réessaiera */ }
      }
    }, 5000);
    return host.layout;
  }

  // bounds en DIP (coordonnées Electron) -> pixels physiques relatifs au parent.
  place(bounds) {
    if (!this.host) return;
    this.lastBounds = bounds;
    const w = win32();
    // dipToScreenRect(null, …) : conversion selon l'écran visé par bounds, pas
    // celui où la fenêtre se trouve actuellement (sinon mauvais écran / mauvaise échelle).
    const px = screen.dipToScreenRect(null, bounds);
    // Coordonnées relatives au parent : on laisse Windows faire la conversion
    // plutôt que de supposer que Progman commence au coin de l'écran virtuel.
    const pt = { x: px.x, y: px.y };
    w.ScreenToClient(this.host.parent, pt);
    w.SetWindowPos(
      hwndOf(this.win), this.host.insertAfter,
      pt.x, pt.y, px.width, px.height,
      SWP_NOACTIVATE | SWP_SHOWWINDOW
    );
  }

  detach() {
    clearInterval(this.watch);
    this.watch = null;
    if (!this.host || this.win.isDestroyed()) return;
    win32().SetParent(hwndOf(this.win), 0);
    this.host = null;
  }
}

// Place une fenêtre tout en bas de la pile (au-dessus du bureau, sous toutes
// les applications), sans l'activer.
const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
function sendToBottom(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  try {
    win32().SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
  } catch (e) { console.error('Fenêtre au fond :', e.message); }
}

module.exports = { WallpaperAttacher, sendToBottom };
