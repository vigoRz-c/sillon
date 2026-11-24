/* Sillon — moteur partagé : boucle de rendu (Renderer), position du morceau et
   assemblage de window.SV. Les parties sont dans audio-engine.js, colors.js,
   visualizers.js (et catalog.js), tous chargés avant ce fichier.
   Chargé en script classique (pas de module) par widget.html, fullscreen.html
   et settings.html. */
(function () {
  'use strict';

  const CAT = window.SillonCatalog;
  const AUD = window.SillonAudio;
  const COL = window.SillonColors;
  const VIS = window.SillonVisuals;
  if (!CAT) throw new Error('catalog.js doit être chargé avant engine.js');
  if (!AUD || !COL || !VIS)
    throw new Error('audio-engine.js, colors.js et visualizers.js doivent être chargés avant engine.js');

  const { AudioEngine, FakeAudio } = AUD;
  const { paletteFromImage, paletteFromColor, paletteFromCustom, prepareColor } = COL;
  const { VISUALIZERS, drawEdgeGlow, drawCoverRings } = VIS;

  // Couleurs des jeux fixes : catalog.js (source unique).
  const THEMES = CAT.PALETTES;

  // Palette d'un jeu qui ne dépend d'aucune image : un jeu fixe, ou « custom »
  // (couleur de la roue, réglage customColor). null pour wallpaper / album.
  function themePalette(id, customColor) {
    if (id === 'custom') return paletteFromCustom(customColor);
    return Object.hasOwn(THEMES, id) ? THEMES[id] : null;
  }

  // Catalogue partagé (catalog.js, chargé avant ce fichier par toutes les pages).
  const { STYLE_ORDER, THEME_ORDER, STYLE_NAMES, THEME_NAMES } = CAT;

  // ================= Boucle de rendu =================

  // Au-delà, le ratio de pixels est réduit (sans descendre sous 1) : une scène
  // plein bureau en 4K coûte cher à remplir pour un gain de netteté invisible.
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
      this.maxDpr = Infinity; // plafond du ratio de pixels (la scène plein bureau le met à 1)
      this.dpr = 1;
      this.reduceMotion = false;
      this._paused = false;
      this._slow = false;
      this.raf = 0;
      this.timer = 0;
      this.blank = false;
      this.frameOpts = {}; // options passées au visualiseur, réutilisées d'une image à l'autre
      this.optsSrc = null;
      this.loop = this.loop.bind(this);
      new ResizeObserver(() => this.resize()).observe(canvas);
      this.resize();
      this.schedule();
    }
    get palette() {
      return this._palette;
    }
    // Les chaînes de couleur à opacité variable sont préparées au changement de palette.
    set palette(pal) {
      this._palette = pal;
      for (const c of pal) prepareColor(c);
    }
    // Suspendu (jeu en plein écran, scène masquée ou endormie) : plus aucune image,
    // et le contexte audio est suspendu avec elle.
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
    // Au ralenti (musique en pause) : quelques images par seconde, cadencées par
    // un minuteur plutôt qu'en réveillant requestAnimationFrame à chaque image de l'écran.
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
    // Arme la prochaine image (une seule à la fois). Rien tant que c'est en pause.
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
        // Une image en échec ne doit pas arrêter la boucle pour de bon.
        console.error('Image de rendu en échec :', e);
      } finally {
        this.schedule();
      }
    }
    render(now) {
      const none = this.style === 'none';
      if (none && !this.hooks.length) {
        // Rien à dessiner : on efface une fois, puis on ne touche plus au canvas.
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
      // Un décor qui lève une exception n'empêche pas les suivants (signalée une fois).
      for (const fn of this.hooks) {
        this.ctx.save();
        try {
          fn(a, now);
        } catch (e) {
          if (!fn.failed) {
            fn.failed = true;
            console.error('Décor de rendu en échec :', e);
          }
        }
        this.ctx.restore();
      }
    }
  }

  // ================= Utilitaires morceau en cours =================

  function currentPosition(m) {
    if (!m || !m.active) return 0;
    let p = m.position || 0;
    if (m.anchorAt) {
      // Ancrage calculé côté principal (voir media.js) : résiste aux mesures périmées.
      p = m.anchorPos + (m.status === 'Playing' ? (Date.now() - m.anchorAt) / 1000 : 0);
    } else if (m.status === 'Playing') {
      const ref = m.updated && m.updated > 0 ? m.updated : m.receivedAt;
      if (ref) p += (Date.now() - ref) / 1000;
    }
    // Durée inconnue (certains lecteurs ne la donnent pas) : pas de plafond.
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
