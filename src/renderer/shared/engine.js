/* Sillon — shared engine: render loop (Renderer), track position and
   assembly of window.SV. The parts are in audio-engine.js, colors.js,
   visualizers.js (and catalog.js), all loaded before this file.
   Loaded as a classic script (not a module) by widget.html, fullscreen.html
   and settings.html. */
(function () {
  'use strict';

  const CAT = window.SillonCatalog;
  const AUD = window.SillonAudio;
  const COL = window.SillonColors;
  const VIS = window.SillonVisuals;
  if (!CAT) throw new Error('catalog.js must be loaded before engine.js');
  if (!AUD || !COL || !VIS)
    throw new Error('audio-engine.js, colors.js and visualizers.js must be loaded before engine.js');

  const { AudioEngine, FakeAudio } = AUD;
  const { paletteFromImage, paletteFromColor, paletteFromCustom, prepareColor } = COL;
  const { VISUALIZERS, drawEdgeGlow, drawCoverRings } = VIS;

  // Colors of the fixed sets: catalog.js (single source).
  const THEMES = CAT.PALETTES;

  // Palette of a set that depends on no image: a fixed set, or "custom"
  // (color wheel, customColor setting). null for wallpaper / album.
  function themePalette(id, customColor) {
    if (id === 'custom') return paletteFromCustom(customColor);
    return Object.hasOwn(THEMES, id) ? THEMES[id] : null;
  }

  // Shared catalog (catalog.js, loaded before this file by every page).
  const { STYLE_ORDER, THEME_ORDER, STYLE_NAMES, THEME_NAMES } = CAT;

  // ================= Render loop =================

  // Beyond that, the pixel ratio is lowered (never below 1): a full-desktop
  // scene in 4K is expensive to fill for an invisible gain in sharpness.
  const MAX_PIXELS = 4200000;

  class Renderer {
    constructor(canvas, engine) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.engine = engine;
      this.style = 'bars';
      this._palette = THEMES.neon;
      prepareColor('#ffffff');
      this.fps = 60;
      this.opts = { glow: true };
      this.hooks = [];
      this.last = 0;
      this.maxDpr = Infinity; // pixel ratio cap (the full-desktop scene sets it to 1)
      this.dpr = 1;
      this.reduceMotion = false;
      this._paused = false;
      this._slow = false;
      this.raf = 0;
      this.timer = 0;
      this.blank = false;
      this.frameOpts = {}; // options passed to the visualizer, reused from one frame to the next
      this.optsSrc = null;
      this.loop = this.loop.bind(this);
      new ResizeObserver(() => this.resize()).observe(canvas);
      this.resize();
      this.schedule();
    }
    get palette() {
      return this._palette;
    }
    // Color strings with variable opacity are prepared when the palette changes.
    set palette(pal) {
      this._palette = pal;
      for (const c of pal) prepareColor(c);
    }
    // Suspended (full-screen game, hidden or sleeping scene): no more frames,
    // and the audio context is suspended with it.
    get paused() {
      return this._paused;
    }
    set paused(v) {
      v = !!v;
      if (v === this._paused) return;
      this._paused = v;
      this.cancel();
      if (this.engine.setSuspended) this.engine.setSuspended(v);
      this.last = 0;
      this.schedule();
    }
    // Slowed down (music paused): a few frames per second, paced by a timer
    // rather than waking requestAnimationFrame on every screen frame.
    get slow() {
      return this._slow;
    }
    set slow(v) {
      v = !!v;
      if (v === this._slow) return;
      this._slow = v;
      this.cancel();
      this.schedule();
    }
    setMaxDpr(v) {
      if (v === this.maxDpr) return;
      this.maxDpr = v;
      this.resize();
    }
    resize() {
      const r = this.canvas.getBoundingClientRect();
      let dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
      const area = r.width * r.height;
      if (area > 0) dpr = Math.min(dpr, Math.max(1, Math.sqrt(MAX_PIXELS / area)));
      this.dpr = dpr;
      this.w = r.width;
      this.h = r.height;
      this.canvas.width = Math.max(1, Math.round(r.width * dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.blank = false;
    }
    cancel() {
      if (this.raf) cancelAnimationFrame(this.raf);
      if (this.timer) clearTimeout(this.timer);
      this.raf = this.timer = 0;
    }
    // Arms the next frame (one at a time). Nothing while paused.
    schedule() {
      if (this._paused || this.raf || this.timer) return;
      if (this._slow) {
        this.timer = setTimeout(() => this.loop(performance.now()), 1000 / Math.min(this.fps, 15));
      } else this.raf = requestAnimationFrame(this.loop);
    }
    loop(now) {
      this.raf = this.timer = 0;
      if (this._paused) return;
      const fps = this._slow ? Math.min(this.fps, 15) : this.fps;
      try {
        if (now - this.last >= 1000 / fps - 2) {
          this.last = now;
          this.render(now);
        }
      } catch (e) {
        // A failing frame must not stop the loop for good.
        console.error('Render frame failed:', e);
      } finally {
        this.schedule();
      }
    }
    render(now) {
      const none = this.style === 'none';
      if (none && !this.hooks.length) {
        // Nothing to draw: clear once, then leave the canvas alone.
        if (!this.blank) {
          this.ctx.clearRect(0, 0, this.w, this.h);
          this.blank = true;
        }
        return;
      }
      this.blank = false;
      this.engine.tick();
      const a = this.engine.frame(now);
      this.ctx.clearRect(0, 0, this.w, this.h);
      const o = this.frameOpts;
      if (this.optsSrc !== this.opts) {
        for (const k in o) delete o[k];
        this.optsSrc = this.opts;
      }
      Object.assign(o, this.opts);
      o.t = now;
      o.sensitivity = this.engine.sensitivity;
      o.reduceMotion = this.reduceMotion;
      o.dpr = this.dpr;
      const draw = VISUALIZERS[this.style] || VISUALIZERS.bars;
      draw(this.ctx, this.w, this.h, a, this._palette, o);
      // A decoration that throws does not stop the following ones (reported once).
      for (const fn of this.hooks) {
        this.ctx.save();
        try {
          fn(a, now);
        } catch (e) {
          if (!fn.failed) {
            fn.failed = true;
            console.error('Render decoration failed:', e);
          }
        }
        this.ctx.restore();
      }
    }
  }

  // ================= Current track helpers =================

  function currentPosition(m) {
    if (!m || !m.active) return 0;
    let p = m.position || 0;
    if (m.anchorAt) {
      // Anchor computed on the main side (see media.js): withstands stale readings.
      p = m.anchorPos + (m.status === 'Playing' ? (Date.now() - m.anchorAt) / 1000 : 0);
    } else if (m.status === 'Playing') {
      const ref = m.updated && m.updated > 0 ? m.updated : m.receivedAt;
      if (ref) p += (Date.now() - ref) / 1000;
    }
    // Unknown duration (some players do not give it): no cap.
    return Math.max(0, m.duration > 0 ? Math.min(m.duration, p) : p);
  }
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  window.SV = {
    AudioEngine,
    Renderer,
    VISUALIZERS,
    THEMES,
    STYLE_ORDER,
    THEME_ORDER,
    STYLE_NAMES,
    THEME_NAMES,
    paletteFromImage,
    paletteFromColor,
    paletteFromCustom,
    themePalette,
    currentPosition,
    fmt,
    drawEdgeGlow,
    drawCoverRings,
    FakeAudio,
  };
})();
