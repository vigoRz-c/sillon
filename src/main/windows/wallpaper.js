// Attaching an Electron window under the desktop icons.
//
// Explorer draws the wallpaper in a "WorkerW" window. The message
// 0x052C sent to "Progman" makes it appear; we slip into it with SetParent.
// Deux dispositions existent :
//   - Windows 10 / 11 before 24H2: WorkerW is a top-level window,
//     just behind the one that holds the icons (SHELLDLL_DefView).
//   - Windows 11 24H2 and later: WorkerW is a child of Progman, under DefView.
//     We then go into Progman, between the icons and the background.

const { screen } = require('electron');

let api = null;
// Logs a failure only once per origin (these calls run in a
// loop: a breakdown must not fill the console).
const reported = new Set();
function reportOnce(what, e) {
  if (reported.has(what)) return;
  reported.add(what);
  console.error(`${what} :`, (e && e.message) || e);
}

function win32() {
  if (api) return api;
  if (process.platform !== 'win32') throw new Error('Wallpaper mode: Windows only.');
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  koffi.struct('POINT', { x: 'long', y: 'long' });
  koffi.proto('bool __stdcall EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
  api = {
    FindWindowW: user32.func('intptr_t __stdcall FindWindowW(const char16_t *cls, const char16_t *name)'),
    FindWindowExW: user32.func(
      'intptr_t __stdcall FindWindowExW(intptr_t parent, intptr_t after, const char16_t *cls, const char16_t *name)',
    ),
    SendMessageTimeoutW: user32.func(
      'intptr_t __stdcall SendMessageTimeoutW(intptr_t hWnd, uint32_t msg, uintptr_t wParam, intptr_t lParam, uint32_t flags, uint32_t timeout, _Out_ uintptr_t *result)',
    ),
    EnumWindows: user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)'),
    SetParent: user32.func('intptr_t __stdcall SetParent(intptr_t child, intptr_t parent)'),
    GetAncestor: user32.func('intptr_t __stdcall GetAncestor(intptr_t hwnd, uint32_t flags)'),
    IsWindow: user32.func('bool __stdcall IsWindow(intptr_t hwnd)'),
    SetWindowPos: user32.func(
      'bool __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int cx, int cy, uint32_t flags)',
    ),
    ScreenToClient: user32.func('bool __stdcall ScreenToClient(intptr_t hwnd, _Inout_ POINT *pt)'),
    ShowWindow: user32.func('bool __stdcall ShowWindow(intptr_t hwnd, int cmd)'),
    LockWorkStation: user32.func('bool __stdcall LockWorkStation()'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int index)'),
    SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hwnd, int index, intptr_t value)'),
    SetLayeredWindowAttributes: user32.func(
      'bool __stdcall SetLayeredWindowAttributes(intptr_t hwnd, uint32_t key, uint8_t alpha, uint32_t flags)',
    ),
    WindowFromPoint: user32.func('intptr_t __stdcall WindowFromPoint(POINT pt)'),
    GetWindow: user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32_t cmd)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t hwnd, _Out_ char16_t *buf, int max)'),
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

// Returns { parent, insertAfter } where to insert our window, or null.
function findWallpaperHost() {
  const w = win32();
  const progman = w.FindWindowW('Progman', null);
  if (!progman) return null;

  // Asks Explorer to create the WorkerW (no effect if it already exists).
  const out = [0];
  w.SendMessageTimeoutW(progman, 0x052c, 0xd, 0x1, SMTO_NORMAL, 1000, out);
  w.SendMessageTimeoutW(progman, 0x052c, 0, 0, SMTO_NORMAL, 1000, out);

  // Disposition 24H2 : WorkerW enfant de Progman.
  const childWorker = w.FindWindowExW(progman, 0, 'WorkerW', null);
  if (childWorker) {
    const defView = w.FindWindowExW(progman, 0, 'SHELLDLL_DefView', null);
    return { parent: progman, insertAfter: defView || 0, layout: '24H2' };
  }

  // Classic layout: the WorkerW that follows the window holding the icons.
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

  // Last resort: directly in Progman.
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
    if (!host) throw new Error('Could not find the desktop window (Progman).');
    const hwnd = hwndOf(this.win);
    w.SetParent(hwnd, host.parent);
    // On 24H2, a "layered" window slipped into Progman stays invisible as long
    // as its opacity attributes are not set (the page runs, but nothing
    // is composited on screen). Wallpaper Engine does the same.
    const ex = Number(w.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
    w.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED);
    w.SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA);
    this.host = host;
    // Electron repositions the window in screen coordinates when it shows it;
    // once a child of Progman, Windows reads these coordinates relative to the desktop
    // and the window runs off to another screen. So we show it first, then place it.
    this.win.showInactive();
    this.place(bounds);
    // The size may have changed during these 300 ms: take the latest.
    setTimeout(() => !this.win.isDestroyed() && this.host && this.place(this.lastBounds), 300);

    // If Explorer restarts or the background changes, we attach again.
    clearInterval(this.watch);
    this.watch = setInterval(() => {
      if (this.win.isDestroyed()) return clearInterval(this.watch);
      const parent = w.GetAncestor(hwnd, GA_PARENT);
      if (!w.IsWindow(this.host.parent) || parent !== this.host.parent) {
        try {
          this.attach(this.lastBounds);
        } catch (e) {
          reportOnce('Re-attaching to the wallpaper (new attempt in 5 s)', e);
        }
      }
    }, 5000);
    return host.layout;
  }

  // bounds in DIP (Electron coordinates) -> physical pixels relative to the parent.
  place(bounds) {
    if (!this.host) return;
    this.lastBounds = bounds;
    const w = win32();
    // dipToScreenRect(null, …): conversion for the screen that bounds targets, not
    // the one the window is currently on (otherwise wrong screen / wrong scale).
    const px = screen.dipToScreenRect(null, bounds);
    // Coordinates relative to the parent: we let Windows do the conversion
    // rather than assume that Progman starts at the corner of the virtual screen.
    const pt = { x: px.x, y: px.y };
    w.ScreenToClient(this.host.parent, pt);
    w.SetWindowPos(
      hwndOf(this.win),
      this.host.insertAfter,
      pt.x,
      pt.y,
      px.width,
      px.height,
      SWP_NOACTIVATE | SWP_SHOWWINDOW,
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

// Puts a window at the very bottom of the stack (above the desktop, under every
// application), without activating it.
const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
function sendToBottom(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  try {
    win32().SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
  } catch (e) {
    console.error('Window to the bottom:', e.message);
  }
}

// Is an application taking the screen (Direct3D game, full-screen video or
// presentation)? SHQueryUserNotificationState: 2 = busy (full screen),
// 3 = full-screen Direct3D game, 4 = presentation mode.
let shell32 = null;
function fullscreenAppRunning() {
  if (process.platform !== 'win32') return false;
  try {
    if (!shell32) {
      const koffi = require('koffi');
      const lib = koffi.load('shell32.dll');
      shell32 = { query: lib.func('int __stdcall SHQueryUserNotificationState(_Out_ int *state)') };
    }
    const out = [0];
    if (shell32.query(out) !== 0) return false;
    return out[0] === 2 || out[0] === 3 || out[0] === 4;
  } catch (e) {
    reportOnce('Full-screen detection (koffi)', e);
    return false;
  }
}

// Rectangle (physical pixels) of the foreground window, or null.
let rectApi = null;
function foregroundRect() {
  if (process.platform !== 'win32') return null;
  try {
    if (!rectApi) {
      const koffi = require('koffi');
      koffi.struct('SV_RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
      const u = koffi.load('user32.dll');
      rectApi = {
        fg: u.func('intptr_t __stdcall GetForegroundWindow()'),
        rect: u.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ SV_RECT *r)'),
      };
    }
    const h = rectApi.fg();
    if (!h) return null;
    const r = {};
    if (!rectApi.rect(h, r)) return null;
    return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
  } catch (e) {
    reportOnce('Foreground window (koffi)', e);
    return null;
  }
}

// Puts a window just above the desktop (Progman), under every
// application. Safer than HWND_BOTTOM alone, which can slip it under the
// desktop: it then becomes invisible and the clicks fall on the background.
function placeAboveDesktop(win) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  try {
    const w = win32();
    const me = hwndOf(win);
    const progman = w.FindWindowW('Progman', null);
    const above = progman ? w.GetWindow(progman, 3) : 0; // GW_HWNDPREV: the window just above
    if (above === me) return; // already in the right place
    // "Insert after X" = just under X, so just above Progman.
    w.SetWindowPos(me, above || HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
  } catch (e) {
    console.error('Window above the desktop:', e.message);
  }
}

// Window under a point of the screen (physical pixels), for the diagnostic.
function windowAt(pt) {
  if (process.platform !== 'win32') return null;
  try {
    const w = win32();
    const cls = (h) => {
      const b = Buffer.alloc(512);
      const n = w.GetClassNameW(h, b, 256);
      return b.toString('utf16le', 0, n * 2);
    };
    const hwnd = w.WindowFromPoint({ x: Math.round(pt.x), y: Math.round(pt.y) });
    if (!hwnd) return null;
    const root = w.GetAncestor(hwnd, 2); // GA_ROOT
    return { hwnd, root, cls: cls(hwnd), rootCls: cls(root) };
  } catch (e) {
    reportOnce('Window under a point (koffi)', e);
    return null;
  }
}

// Same as Windows + L.
function lockWorkstation() {
  if (process.platform !== 'win32') return false;
  try {
    return win32().LockWorkStation();
  } catch (e) {
    console.error('Verrouillage :', e.message);
    return false;
  }
}

module.exports = {
  WallpaperAttacher,
  sendToBottom,
  lockWorkstation,
  fullscreenAppRunning,
  foregroundRect,
  windowAt,
  hwndOf,
  placeAboveDesktop,
};
