/* Spoti-View — moteur partagé : audio, couleurs, visualiseurs.
   Chargé en script classique (pas de module) par widget.html et fullscreen.html. */
(function () {
  'use strict';

  // ================= Audio =================

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.analyser = null;
      this.sensitivity = 1;
      this.bandsCache = new Map(); // n -> Float32Array lissé
      this.bassAvg = 0;
      this.lastBeat = 0;
      this.status = 'idle'; // idle | running | no-audio | error
      this.wave = new Float32Array(2048); // silence tant que l'audio n'est pas branché
    }

    // Son du système via getDisplayMedia (loopback géré côté main). Jamais le micro.
    async startSystem() {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        stream.getVideoTracks().forEach((t) => t.stop());
        const tracks = stream.getAudioTracks();
        if (!tracks.length) { this.status = 'no-audio'; return false; }
        this.ctx = new AudioContext();
        this.useNode(this.ctx.createMediaStreamSource(new MediaStream(tracks)));
        tracks[0].addEventListener('ended', () => { this.status = 'no-audio'; });
        return true;
      } catch (e) {
        console.error('Capture audio impossible :', e);
        this.status = 'error';
        return false;
      }
    }

    // Brancher n'importe quel nœud audio (sert aussi aux tests / à la démo).
    useNode(node) {
      this.ctx = node.context;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.6;
      this.analyser.minDecibels = -85;
      this.analyser.maxDecibels = -18;
      node.connect(this.analyser);
      this.freq = new Uint8Array(this.analyser.frequencyBinCount);
      this.wave = new Float32Array(this.analyser.fftSize);
      this.status = 'running';
    }

    // Une image d'analyse. Les visualiseurs demandent le nombre de bandes voulu.
    frame(now) {
      const out = { bands: (n) => this.bands(n), wave: this.wave, bass: 0, level: 0, beat: false };
      if (!this.analyser) {
        // Pas d'audio : tout redescend doucement.
        for (const arr of this.bandsCache.values()) for (let i = 0; i < arr.length; i++) arr[i] *= 0.9;
        return out;
      }
      this.analyser.getByteFrequencyData(this.freq);
      this.analyser.getFloatTimeDomainData(this.wave);
      this.bandsDirty = true;

      const bass = this.range(30, 150);
      let rms = 0;
      for (let i = 0; i < this.wave.length; i += 4) rms += this.wave[i] * this.wave[i];
      out.level = Math.min(1, Math.sqrt(rms / (this.wave.length / 4)) * 3 * this.sensitivity);
      out.bass = Math.min(1, bass * this.sensitivity);
      // Battement : la basse dépasse nettement sa moyenne récente.
      this.bassAvg = this.bassAvg * 0.94 + bass * 0.06;
      if (bass > 0.35 && bass > this.bassAvg * 1.3 && now - this.lastBeat > 180) {
        out.beat = true;
        this.lastBeat = now;
      }
      return out;
    }

    range(fLo, fHi) {
      const hz = this.ctx.sampleRate / 2 / this.freq.length;
      const a = Math.max(1, Math.floor(fLo / hz));
      const b = Math.min(this.freq.length - 1, Math.ceil(fHi / hz));
      let s = 0;
      for (let i = a; i <= b; i++) s += this.freq[i];
      return s / ((b - a + 1) * 255);
    }

    // n bandes réparties en échelle logarithmique de 35 Hz à 16 kHz,
    // montée rapide / descente lente pour un rendu fluide.
    bands(n) {
      let arr = this.bandsCache.get(n);
      if (!arr) { arr = new Float32Array(n); this.bandsCache.set(n, arr); arr.stamp = -1; }
      if (!this.analyser || !this.bandsDirty || arr.stamp === this.frameStamp) return arr;
      arr.stamp = this.frameStamp;
      const hz = this.ctx.sampleRate / 2 / this.freq.length;
      const lo = Math.log(35), hi = Math.log(16000);
      for (let i = 0; i < n; i++) {
        const f0 = Math.exp(lo + (hi - lo) * (i / n));
        const f1 = Math.exp(lo + (hi - lo) * ((i + 1) / n));
        const a = Math.max(1, Math.floor(f0 / hz));
        const b = Math.max(a, Math.min(this.freq.length - 1, Math.floor(f1 / hz)));
        let m = 0;
        for (let k = a; k <= b; k++) if (this.freq[k] > m) m = this.freq[k];
        // Les aigus portent moins d'énergie : on les relève un peu.
        let v = (m / 255) * (0.85 + 0.5 * (i / n)) * this.sensitivity;
        v = Math.min(1, Math.pow(v, 1.6));
        arr[i] = v > arr[i] ? arr[i] + (v - arr[i]) * 0.6 : arr[i] * 0.88 + v * 0.12;
      }
      return arr;
    }

    tick() { this.frameStamp = (this.frameStamp || 0) + 1; }
  }

  // ================= Couleurs =================

  const THEMES = {
    spotify: ['#1db954', '#1ed760', '#b8f5cf'],
    neon: ['#7c3aed', '#ec4899', '#22d3ee'],
    sunset: ['#f97316', '#ef4444', '#facc15'],
    ocean: ['#0ea5e9', '#6366f1', '#5eead4'],
    mono: ['#e5e7eb', '#ffffff', '#cbd5e1'],
  };

  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [h * 360, s, l];
  }
  const hsl = (h, s, l) => `hsl(${((h % 360) + 360) % 360} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;

  // 3 couleurs tirées de la pochette. Une pochette grise donne des blancs teintés
  // plutôt qu'une couleur inventée.
  function paletteFromImage(img, { soft = false } = {}) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, 32, 32);
    const px = x.getImageData(0, 0, 32, 32).data;
    const buckets = new Map();
    for (let i = 0; i < px.length; i += 4) {
      const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
      if (l < 0.08 || l > 0.95) continue;
      const key = Math.round(h / 24);
      const w = s * (1 - Math.abs(l - 0.5));
      const b = buckets.get(key) || { w: 0, h: 0, s: 0, l: 0, n: 0 };
      b.w += w; b.h += h * w; b.s += s * w; b.l += l * w; b.n++;
      buckets.set(key, b);
    }
    const ranked = [...buckets.values()].filter((b) => b.w > 0)
      .map((b) => ({ h: b.h / b.w, s: b.s / b.w, l: b.l / b.w, w: b.w }))
      .sort((a, b) => b.w - a.w);
    const totalW = ranked.reduce((a, b) => a + b.w, 0);
    if (!ranked.length || totalW / 1024 < 0.05) {
      const tint = ranked[0] ? ranked[0].h : 220;
      return [hsl(tint, 0.25, 0.85), hsl(tint, 0.1, 0.97), hsl(tint + 30, 0.3, 0.75)];
    }
    const main = ranked[0];
    const second = ranked.find((b) => Math.abs(((b.h - main.h + 540) % 360) - 180) < 150) || { h: main.h + 40 };
    if (soft) {
      // Tons doux et clairs, pris dans le fond d'écran : ils s'y fondent au lieu de trancher.
      const ss = Math.min(0.75, Math.max(0.35, main.s));
      return [hsl(main.h, ss, 0.72), hsl(second.h, Math.min(0.75, Math.max(0.35, second.s || ss)), 0.78), hsl(main.h + 15, ss * 0.8, 0.9)];
    }
    const s = Math.max(0.6, main.s);
    return [hsl(main.h, s, 0.55), hsl(second.h, Math.max(0.6, second.s || s), 0.6), hsl(main.h + 20, s, 0.75)];
  }

  // Une couleur choisie -> palette de 3 en balayant la teinte dans les deux sens.
  function paletteFromColor(hex) {
    const [h, s] = rgbToHsl(...hexToRgb(hex));
    return [hsl(h - 28, Math.max(0.6, s), 0.55), hsl(h, Math.max(0.65, s), 0.6), hsl(h + 28, Math.max(0.6, s), 0.72)];
  }

  // ================= Visualiseurs =================

  function hGradient(ctx, w, pal) {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, pal[0]); g.addColorStop(0.5, pal[1]); g.addColorStop(1, pal[2]);
    return g;
  }

  function roundedBar(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
  }

  const VISUALIZERS = {
    bars(ctx, w, h, a, pal, opts) {
      const n = Math.max(16, Math.min(96, Math.floor(w / 14)));
      const bands = a.bands(n);
      const slot = w / n, bw = slot * 0.62;
      const base = opts.reflection === false ? h : h * 0.8;
      const fill = hGradient(ctx, w, pal);
      ctx.fillStyle = fill;
      ctx.shadowColor = pal[1];
      ctx.shadowBlur = opts.glow ? 18 : 0;
      for (let i = 0; i < n; i++) {
        const bh = Math.max(3, bands[i] * base * 0.95);
        roundedBar(ctx, i * slot + (slot - bw) / 2, base - bh, bw, bh, bw / 2);
      }
      ctx.shadowBlur = 0;
      if (opts.reflection !== false) {
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.translate(0, base * 2 + 4);
        ctx.scale(1, -1);
        for (let i = 0; i < n; i++) {
          const bh = Math.max(3, bands[i] * base * 0.95) * 0.45;
          ctx.fillRect(i * slot + (slot - bw) / 2, base - bh, bw, bh);
        }
        ctx.restore();
      }
    },

    mirror(ctx, w, h, a, pal, opts) {
      const n = Math.max(24, Math.min(128, Math.floor(w / 20) * 2));
      const bands = a.bands(n / 2);
      const slot = w / n, bw = slot * 0.55, mid = h / 2;
      ctx.fillStyle = hGradient(ctx, w, [pal[2], pal[0], pal[2]]);
      ctx.shadowColor = pal[0];
      ctx.shadowBlur = opts.glow ? 14 : 0;
      for (let i = 0; i < n; i++) {
        const k = i < n / 2 ? n / 2 - 1 - i : i - n / 2; // basses au centre
        const bh = Math.max(2, bands[k] * h * 0.46);
        const x = i * slot + (slot - bw) / 2;
        ctx.beginPath();
        ctx.roundRect(x, mid - bh, bw, bh * 2, bw / 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    },

    ring(ctx, w, h, a, pal, opts) {
      const n = 120;
      const bands = a.bands(60);
      const cx = opts.cx ?? w / 2, cy = opts.cy ?? h / 2;
      const m = Math.min(w, h);
      const r0 = opts.radius ?? m * 0.2 * (1 + a.bass * 0.08);
      const len = opts.radius ? m * 0.16 : m * 0.2;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, (2 * Math.PI * r0) / n * 0.45);
      ctx.shadowBlur = opts.glow ? 16 : 0;
      const rot = (opts.t || 0) * 0.00005;
      for (let i = 0; i < n; i++) {
        const k = i < n / 2 ? i : n - 1 - i; // symétrique
        const v = bands[k];
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2 + rot;
        const c = pal[i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2];
        ctx.strokeStyle = c; ctx.shadowColor = c;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        ctx.lineTo(cx + Math.cos(ang) * (r0 + 3 + v * len), cy + Math.sin(ang) * (r0 + 3 + v * len));
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      if (!opts.radius) {
        ctx.strokeStyle = pal[2];
        ctx.globalAlpha = 0.35 + a.bass * 0.4;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, r0 - 6, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    },

    wave(ctx, w, h, a, pal, opts) {
      const data = a.wave;
      const mid = h / 2;
      const layers = [[pal[0], 1, 3], [pal[1], 0.7, 2], [pal[2], 0.45, 1.5]];
      ctx.shadowBlur = opts.glow ? 14 : 0;
      layers.forEach(([color, amp, lw], li) => {
        ctx.strokeStyle = color; ctx.shadowColor = color; ctx.lineWidth = lw;
        ctx.beginPath();
        const step = Math.max(1, Math.floor(data.length / w / 1.5));
        const offset = li * 37;
        for (let x = 0, i = 0; x <= w; x += 2, i += step * 2) {
          const s = data[(i + offset) % data.length] || 0;
          const edge = Math.sin((x / w) * Math.PI); // fondu aux bords
          const y = mid + s * h * 1.6 * amp * edge * (opts.sensitivity || 1);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
      ctx.shadowBlur = 0;
    },

    aurora(ctx, w, h, a, pal, opts) {
      const bands = a.bands(24);
      const t = (opts.t || 0) / 1000;
      ctx.globalCompositeOperation = 'lighter';
      for (let layer = 0; layer < 3; layer++) {
        const color = pal[layer];
        const g = ctx.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, 'transparent');
        g.addColorStop(0.55, color);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(0, h);
        const pts = 48;
        for (let i = 0; i <= pts; i++) {
          const x = (i / pts) * w;
          const e = bands[Math.floor((i / pts) * 23)];
          const wobble = Math.sin(i * 0.35 + t * (0.6 + layer * 0.25) + layer * 2) * 0.12
            + Math.sin(i * 0.11 - t * 0.4 + layer) * 0.1;
          const y = h * (0.75 - layer * 0.08 - e * 0.55 - wobble);
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },

    // Pochette ronde qui tourne, couronne de points et rayons en soleil qui
    // jaillissent avec le son, sur un halo aux couleurs de la pochette.
    // opts : cx, cy, radius, image, spin (lecture en cours), halo (couleur).
    disc(ctx, w, h, a, basePal, opts) {
      // Comme sur une pochette de vinyle : rayons et points aux couleurs de la pochette.
      const pal = opts.palette || basePal;
      const cx = opts.cx ?? w / 2, cy = opts.cy ?? h / 2;
      const pulse = 1 + a.bass * 0.06;
      const r = (opts.radius ?? Math.min(w, h) * 0.12) * pulse;
      const t = opts.t || 0;
      const dt = Math.min(100, t - (discState.last || t));
      discState.last = t;
      if (opts.spin) discState.rot += dt * 0.00012; // ~1 tour en 50 s

      // Halo : respire avec le niveau sonore.
      const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * (2.6 + a.level * 0.8));
      halo.addColorStop(0, withAlpha(opts.halo || pal[0], 0.55 + a.bass * 0.25));
      halo.addColorStop(0.45, withAlpha(opts.halo || pal[0], 0.18));
      halo.addColorStop(1, withAlpha(opts.halo || pal[0], 0));
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(cx, cy, r * 3.6, 0, Math.PI * 2); ctx.fill();

      // Rayons : 180 traits fins, symétriques, basses en haut et en bas.
      const n = 180;
      const bands = a.bands(64);
      const inner = r + 12, len = r * 1.05;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1.2, r * 0.016);
      ctx.shadowBlur = opts.glow === false ? 0 : 10;
      for (let i = 0; i < n; i++) {
        const half = i < n / 2 ? i : n - 1 - i;
        const v = bands[Math.min(63, Math.floor((half / (n / 2)) * 64))];
        const wob = 0.5 + 0.5 * Math.sin(i * 1.7 + t * 0.004); // un peu de vie au repos
        const l = 3 + v * len + wob * 3;
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
        const c = pal[i % 2 ? 2 : 1];
        ctx.strokeStyle = c; ctx.shadowColor = c;
        ctx.globalAlpha = 0.55 + v * 0.45;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * inner, cy + Math.sin(ang) * inner);
        ctx.lineTo(cx + Math.cos(ang) * (inner + l), cy + Math.sin(ang) * (inner + l));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;

      // Couronne de points.
      ctx.fillStyle = pal[2];
      const dots = 96;
      for (let i = 0; i < dots; i++) {
        const ang = (i / dots) * Math.PI * 2 + discState.rot * 0.5;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ang) * (r + 5), cy + Math.sin(ang) * (r + 5), Math.max(1, r * 0.012), 0, Math.PI * 2);
        ctx.fill();
      }

      // Pochette ronde qui tourne.
      ctx.save();
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
      if (opts.image && opts.image.complete && opts.image.naturalWidth) {
        ctx.translate(cx, cy); ctx.rotate(discState.rot);
        ctx.drawImage(opts.image, -r, -r, r * 2, r * 2);
      } else {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, pal[1]); g.addColorStop(1, pal[0]);
        ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      ctx.restore();
      // Liseré sombre pour détacher la pochette des rayons.
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    },
  };

  const discState = { rot: 0, last: 0 };

  // "hsl(10 80% 50%)" ou "#rrggbb" -> même couleur avec une opacité.
  function withAlpha(color, alpha) {
    if (color.startsWith('#')) {
      const [r, g, b] = hexToRgb(color);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (color.startsWith('hsl(')) return color.replace(')', ` / ${alpha})`);
    return color;
  }

  const STYLE_ORDER = ['bars', 'mirror', 'ring', 'wave', 'aurora'];
  const THEME_ORDER = ['wallpaper', 'album', 'spotify', 'neon', 'sunset', 'ocean', 'mono'];

  // ================= Boucle de rendu =================

  class Renderer {
    constructor(canvas, engine) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.engine = engine;
      this.style = 'bars';
      this.palette = THEMES.neon;
      this.fps = 60;
      this.opts = { glow: true };
      this.hooks = [];
      this.last = 0;
      this.loop = this.loop.bind(this);
      new ResizeObserver(() => this.resize()).observe(canvas);
      this.resize();
      requestAnimationFrame(this.loop);
    }
    resize() {
      const dpr = window.devicePixelRatio || 1;
      const r = this.canvas.getBoundingClientRect();
      this.w = r.width; this.h = r.height;
      this.canvas.width = Math.max(1, Math.round(r.width * dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * dpr));
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    loop(now) {
      requestAnimationFrame(this.loop);
      if (now - this.last < 1000 / this.fps - 2) return;
      this.last = now;
      this.engine.tick();
      const a = this.engine.frame(now);
      this.ctx.clearRect(0, 0, this.w, this.h);
      const draw = VISUALIZERS[this.style] || VISUALIZERS.bars;
      draw(this.ctx, this.w, this.h, a, this.palette, { ...this.opts, t: now, sensitivity: this.engine.sensitivity });
      for (const fn of this.hooks) fn(a, now);
    }
  }

  // ================= Utilitaires morceau en cours =================

  function currentPosition(m) {
    if (!m || !m.active || !m.duration) return 0;
    let p = m.position || 0;
    if (m.anchorAt) {
      // Ancrage calculé côté principal (voir media.js) : résiste aux mesures périmées.
      p = m.anchorPos + (m.status === 'Playing' ? (Date.now() - m.anchorAt) / 1000 : 0);
    } else if (m.status === 'Playing') {
      const ref = m.updated && m.updated > 0 ? m.updated : m.receivedAt;
      if (ref) p += (Date.now() - ref) / 1000;
    }
    return Math.max(0, Math.min(m.duration, p));
  }
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  window.SV = {
    AudioEngine, Renderer, VISUALIZERS, THEMES, STYLE_ORDER, THEME_ORDER,
    paletteFromImage, paletteFromColor, currentPosition, fmt, withAlpha,
  };
})();
