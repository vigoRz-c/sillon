/* Sillon — moteur partagé : audio, couleurs, visualiseurs.
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
      this.gen = 0; // jeton de génération : un démarrage tardif d'une source périmée s'abandonne
      this.suspended = false; // rendu en pause : contexte audio suspendu
      this.reduceMotion = false; // animations réduites : lissage plus lent, pas de battement
      this.pcmRest = null; // octet restant d'un morceau PCM de longueur impaire
      this.pulse = 0; // basse lissée (pour les lueurs : jamais plus de quelques éclats par seconde)
      this.glowLevel = 0; // niveau lissé, idem
      this.lastFrameT = 0;
      // Objet rendu à chaque image, réutilisé (aucune allocation par image).
      this.out = {
        bands: (n) => this.bands(n),
        wave: this.wave,
        bass: 0,
        level: 0,
        pulse: 0,
        glowLevel: 0,
        beat: false,
      };
    }

    // Son du système via getDisplayMedia (loopback géré côté main). Jamais le micro.
    async startSystem() {
      this.stop();
      const gen = this.gen;
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        if (gen !== this.gen) {
          // Un autre démarrage (ou un arrêt) est passé entre-temps : on rend le flux.
          stream.getTracks().forEach((t) => t.stop());
          return false;
        }
        this.stream = stream;
        stream.getVideoTracks().forEach((t) => t.stop());
        const tracks = stream.getAudioTracks();
        if (!tracks.length) {
          this.status = 'no-audio';
          return false;
        }
        const ctx = new AudioContext();
        this.ctx = ctx;
        this.useNode(ctx.createMediaStreamSource(new MediaStream(tracks)));
        tracks[0].addEventListener('ended', () => {
          if (gen === this.gen) this.status = 'no-audio';
        });
        if (this.suspended) ctx.suspend().catch(() => {});
        return true;
      } catch (e) {
        console.error('Capture audio impossible :', e);
        if (gen === this.gen) {
          if (stream) stream.getTracks().forEach((t) => t.stop());
          this.status = 'error';
        }
        return false;
      }
    }

    // Son du seul lecteur suivi (Spotify, navigateur…), envoyé brut par le
    // processus principal : le chat vocal et les autres applis sont ignorés.
    async startApp(bridge) {
      this.stop();
      const gen = this.gen;
      let ctx = null;
      try {
        ctx = new AudioContext({ sampleRate: 48000 });
        this.ctx = ctx; // affecté tôt : stop() le ferme si on nous coupe en route
        await ctx.audioWorklet.addModule('../shared/pcm-worklet.js');
        if (gen !== this.gen) {
          ctx.close().catch(() => {});
          return false;
        }
        const node = new AudioWorkletNode(ctx, 'sillon-pcm', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        this.pcmNode = node;
        this.pcmRest = null;
        if (!this.pcmHooked) {
          this.pcmHooked = true;
          bridge.onAudioPcm((chunk) => this.pushPcm(chunk));
        }
        this.useNode(node);
        // Le graphe doit aboutir à la sortie pour tourner : gain nul, rien d'audible.
        const mute = ctx.createGain();
        mute.gain.value = 0;
        this.analyser.connect(mute).connect(ctx.destination);
        if (this.suspended) await ctx.suspend();
        else await ctx.resume();
        if (gen !== this.gen) {
          ctx.close().catch(() => {});
          return false;
        }
        return true;
      } catch (e) {
        console.error('Capture du lecteur impossible :', e);
        if (ctx) ctx.close().catch(() => {});
        if (gen === this.gen) {
          if (this.ctx === ctx) this.ctx = null;
          this.analyser = null;
          this.pcmNode = null;
          this.status = 'error';
        }
        return false;
      }
    }

    // Reçoit un morceau de PCM 16 bits. Le worklet attend des échantillons
    // entiers : un éventuel octet isolé est gardé pour le morceau suivant.
    pushPcm(chunk) {
      if (!this.pcmNode || this.suspended) return;
      const rest = this.pcmRest;
      const total = chunk.byteLength + (rest === null ? 0 : 1);
      const bytes = total & ~1;
      if (!bytes) {
        if (rest === null && chunk.byteLength) this.pcmRest = chunk[0];
        return;
      }
      const ab = new ArrayBuffer(bytes);
      const dst = new Uint8Array(ab);
      let o = 0;
      if (rest !== null) dst[o++] = rest;
      const take = bytes - o;
      dst.set(new Uint8Array(chunk.buffer, chunk.byteOffset, take), o);
      this.pcmRest = take < chunk.byteLength ? chunk[take] : null;
      this.pcmNode.port.postMessage(ab, [ab]);
    }

    // Arrête la source en cours (avant d'en démarrer une autre).
    stop() {
      this.gen++;
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
        this.stream = null;
      }
      if (this.ctx) {
        this.ctx.close().catch(() => {});
        this.ctx = null;
      }
      this.analyser = null;
      this.pcmNode = null;
      this.pcmRest = null;
    }

    // Rendu en pause (scène masquée, endormie, jeu en plein écran) : on suspend
    // aussi le contexte audio, qui n'a plus rien à analyser.
    setSuspended(on) {
      this.suspended = !!on;
      if (!this.ctx) return;
      (on ? this.ctx.suspend() : this.ctx.resume()).catch(() => {});
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
      const out = this.out;
      out.wave = this.wave;
      out.bass = 0;
      out.level = 0;
      out.beat = false;
      if (!this.analyser) {
        // Pas d'audio : tout redescend doucement.
        for (const arr of this.bandsCache.values()) for (let i = 0; i < arr.length; i++) arr[i] *= 0.9;
        this.pulse *= 0.9;
        this.glowLevel *= 0.9;
        out.pulse = this.pulse;
        out.glowLevel = this.glowLevel;
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
      // Lueurs : basse et niveau lissés (constante de temps ~200 ms), pour que
      // la luminosité ne clignote pas au rythme des basses (WCAG 2.3.1).
      const dt = Math.max(0, Math.min(250, now - this.lastFrameT));
      this.lastFrameT = now;
      const k = 1 - Math.exp(-dt / 200);
      this.pulse += (out.bass - this.pulse) * k;
      this.glowLevel += (out.level - this.glowLevel) * k;
      out.pulse = this.pulse;
      out.glowLevel = this.glowLevel;
      // Battement : la basse dépasse nettement sa moyenne récente. Au plus ~3 par
      // seconde (350 ms mini), et aucun en mode animations réduites.
      this.bassAvg = this.bassAvg * 0.94 + bass * 0.06;
      if (bass > 0.35 && bass > this.bassAvg * 1.3 && now - this.lastBeat > 350) {
        this.lastBeat = now;
        out.beat = !this.reduceMotion;
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
      if (!arr) {
        arr = new Float32Array(n);
        this.bandsCache.set(n, arr);
        arr.stamp = -1;
      }
      if (!this.analyser || !this.bandsDirty || arr.stamp === this.frameStamp) return arr;
      arr.stamp = this.frameStamp;
      const hz = this.ctx.sampleRate / 2 / this.freq.length;
      const lo = Math.log(35),
        hi = Math.log(16000);
      const up = this.reduceMotion ? 0.25 : 0.6,
        down = this.reduceMotion ? 0.95 : 0.88;
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
        // Animations réduites : montée et descente plus lentes (barres lissées).
        arr[i] = v > arr[i] ? arr[i] + (v - arr[i]) * up : arr[i] * down + v * (1 - down);
      }
      return arr;
    }

    tick() {
      this.frameStamp = (this.frameStamp || 0) + 1;
    }
  }

  // ================= Couleurs =================

  const THEMES = {
    spotify: ['#1db954', '#1ed760', '#b8f5cf'],
    neon: ['#7c3aed', '#ec4899', '#22d3ee'],
    sunset: ['#f97316', '#ef4444', '#facc15'],
    ocean: ['#0ea5e9', '#6366f1', '#5eead4'],
    mono: ['#e5e7eb', '#ffffff', '#cbd5e1'],
    violet: ['#a855f7', '#ec4899', '#f0abfc'],
  };

  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    let h = 0,
      s = 0;
    const l = (max + min) / 2;
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
      b.w += w;
      b.h += h * w;
      b.s += s * w;
      b.l += l * w;
      b.n++;
      buckets.set(key, b);
    }
    const ranked = [...buckets.values()]
      .filter((b) => b.w > 0)
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
      return [
        hsl(main.h, ss, 0.72),
        hsl(second.h, Math.min(0.75, Math.max(0.35, second.s || ss)), 0.78),
        hsl(main.h + 15, ss * 0.8, 0.9),
      ];
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
    g.addColorStop(0, pal[0]);
    g.addColorStop(0.5, pal[1]);
    g.addColorStop(1, pal[2]);
    return g;
  }

  // Ajoute une barre arrondie en haut au tracé en cours (remplie par l'appelant).
  function roundedBar(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
  }

  // Traits regroupés par couleur et opacité : un seul tracé (et un seul flou de
  // lueur) par groupe au lieu d'un par trait. La lueur (shadowBlur) coûte cher :
  // elle est recalculée à chaque appel de stroke()/fill().
  const ALPHA_STEPS = 4;
  class StrokeBatch {
    constructor() {
      this.paths = new Map();
    }
    // alpha arrondi à ALPHA_STEPS paliers entre lo et 1.
    add(color, alpha, lo, x0, y0, x1, y1) {
      const step = Math.round(((alpha - lo) / (1 - lo)) * (ALPHA_STEPS - 1));
      const key = color + '|' + step;
      let p = this.paths.get(key);
      if (!p) {
        p = { path: new Path2D(), color, alpha: lo + ((1 - lo) * step) / (ALPHA_STEPS - 1), step };
        this.paths.set(key, p);
      }
      p.path.moveTo(x0, y0);
      p.path.lineTo(x1, y1);
    }
    // La lueur n'est appliquée qu'aux deux paliers d'opacité les plus hauts
    // (les traits les plus visibles) : c'est là que le flou coûte le plus.
    stroke(ctx, glow) {
      const blur = ctx.shadowBlur;
      for (const { path, color, alpha, step } of this.paths.values()) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = alpha;
        if (glow) {
          const on = step >= ALPHA_STEPS - 2;
          ctx.shadowBlur = on ? blur : 0;
          if (on) ctx.shadowColor = color;
        }
        ctx.stroke(path);
      }
      this.paths.clear();
      ctx.shadowBlur = blur;
      ctx.globalAlpha = 1;
    }
  }
  const batch = new StrokeBatch();

  const VISUALIZERS = {
    // Disque masqué : on ne dessine rien (le moteur n'efface même pas le canvas sans décor).
    none() {},

    bars(ctx, w, h, a, pal, opts) {
      const n = Math.max(16, Math.min(96, Math.floor(w / 14)));
      const bands = a.bands(n);
      const slot = w / n,
        bw = slot * 0.62;
      const base = opts.reflection === false ? h : h * 0.8;
      const fill = hGradient(ctx, w, pal);
      ctx.fillStyle = fill;
      ctx.shadowColor = pal[1];
      ctx.shadowBlur = opts.glow ? 18 : 0;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const bh = Math.max(3, bands[i] * base * 0.95);
        roundedBar(ctx, i * slot + (slot - bw) / 2, base - bh, bw, bh, bw / 2);
      }
      ctx.fill(); // un seul remplissage (et une seule lueur) pour toutes les barres
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
      const slot = w / n,
        bw = slot * 0.55,
        mid = h / 2;
      ctx.fillStyle = hGradient(ctx, w, [pal[2], pal[0], pal[2]]);
      ctx.shadowColor = pal[0];
      ctx.shadowBlur = opts.glow ? 14 : 0;
      for (let i = 0; i < n; i++) {
        const k = i < n / 2 ? n / 2 - 1 - i : i - n / 2; // basses au centre
        const bh = Math.max(2, bands[k] * h * 0.46);
        const x = i * slot + (slot - bw) / 2;
        if (i === 0) ctx.beginPath();
        ctx.roundRect(x, mid - bh, bw, bh * 2, bw / 2);
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    },

    ring(ctx, w, h, a, pal, opts) {
      const n = 120;
      const bands = a.bands(60);
      const cx = opts.cx ?? w / 2,
        cy = opts.cy ?? h / 2;
      const m = Math.min(w, h);
      const rm = opts.reduceMotion;
      const r0 = opts.radius ?? m * 0.2 * (1 + (rm ? 0 : a.bass * 0.08));
      const len = opts.radius ? m * 0.16 : m * 0.2;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(2, ((2 * Math.PI * r0) / n) * 0.45);
      ctx.shadowBlur = opts.glow ? 16 : 0;
      const rot = rm ? 0 : (opts.t || 0) * 0.00005;
      for (let i = 0; i < n; i++) {
        const k = i < n / 2 ? i : n - 1 - i; // symétrique
        const v = bands[k];
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2 + rot;
        const c = pal[i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2];
        batch.add(
          c,
          1,
          0,
          cx + Math.cos(ang) * r0,
          cy + Math.sin(ang) * r0,
          cx + Math.cos(ang) * (r0 + 3 + v * len),
          cy + Math.sin(ang) * (r0 + 3 + v * len),
        );
      }
      batch.stroke(ctx, opts.glow);
      ctx.shadowBlur = 0;
      if (!opts.radius) {
        ctx.strokeStyle = pal[2];
        ctx.globalAlpha = 0.35 + (rm ? 0 : a.pulse) * 0.25;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r0 - 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    },

    wave(ctx, w, h, a, pal, opts) {
      const data = a.wave;
      const mid = h / 2;
      const layers = [
        [pal[0], 1, 3],
        [pal[1], 0.7, 2],
        [pal[2], 0.45, 1.5],
      ];
      ctx.shadowBlur = opts.glow ? 14 : 0;
      layers.forEach(([color, amp, lw], li) => {
        ctx.strokeStyle = color;
        ctx.shadowColor = color;
        ctx.lineWidth = lw;
        ctx.beginPath();
        const step = Math.max(1, Math.floor(data.length / w / 1.5));
        const offset = li * 37;
        for (let x = 0, i = 0; x <= w; x += 2, i += step * 2) {
          const s = data[(i + offset) % data.length] || 0;
          const edge = Math.sin((x / w) * Math.PI); // fondu aux bords
          const y = mid + s * h * 1.6 * amp * edge * (opts.sensitivity || 1);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
      ctx.shadowBlur = 0;
    },

    aurora(ctx, w, h, a, pal, opts) {
      const bands = a.bands(24);
      const t = opts.reduceMotion ? 0 : (opts.t || 0) / 1000;
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
          const wobble =
            Math.sin(i * 0.35 + t * (0.6 + layer * 0.25) + layer * 2) * 0.12 +
            Math.sin(i * 0.11 - t * 0.4 + layer) * 0.1;
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

    // Colonnes de blocs empilés, façon VU-mètre : le bloc du haut retombe
    // lentement (crête).
    blocks(ctx, w, h, a, pal) {
      const n = Math.max(12, Math.min(48, Math.floor(w / 26)));
      const rows = Math.max(8, Math.min(24, Math.floor(h / 16)));
      const bands = a.bands(n);
      const slot = w / n,
        bw = slot * 0.72,
        bh = (h / rows) * 0.7,
        gap = h / rows;
      if (!blocksState.peaks || blocksState.peaks.length !== n) blocksState.peaks = new Float32Array(n);
      const peaks = blocksState.peaks;
      // Blocs regroupés par couleur et opacité (3 couleurs x 6 paliers) : un
      // seul tracé et un seul remplissage par groupe, au lieu d'un par bloc.
      const groups = blocksState.groups;
      groups.fill(null);
      const rad = Math.min(3, bh / 3);
      for (let i = 0; i < n; i++) {
        const lit = Math.round(bands[i] * rows);
        peaks[i] = Math.max(lit, peaks[i] - 0.12);
        const x = i * slot + (slot - bw) / 2;
        for (let r = 0; r < rows; r++) {
          const y = h - (r + 1) * gap + (gap - bh) / 2;
          const on = r < lit;
          const top = Math.round(peaks[i]) === r + 1 && r >= lit - 1;
          const f = r / rows;
          const ci = !on && !top ? 0 : f > 0.75 ? 2 : f > 0.4 ? 1 : 0;
          // Paliers : 0-3 blocs allumés (opacité 0,55 -> 1), 4 éteint, 5 crête.
          const step = !on && !top ? 4 : top && !on ? 5 : Math.min(3, Math.floor(f * 4));
          const gi = ci * 6 + step;
          const p = groups[gi] || (groups[gi] = new Path2D());
          p.roundRect(x, y, bw, bh, rad);
        }
      }
      for (let gi = 0; gi < groups.length; gi++) {
        const p = groups[gi];
        if (!p) continue;
        const step = gi % 6;
        ctx.globalAlpha = step === 4 ? 0.07 : step === 5 ? 0.9 : 0.55 + 0.45 * ((step + 0.5) / 4);
        ctx.fillStyle = pal[Math.floor(gi / 6)];
        ctx.fill(p);
      }
      ctx.globalAlpha = 1;
    },

    // Anneau dense de traits fins autour d'un cœur lumineux qui respire.
    halo(ctx, w, h, a, pal, opts) {
      const cx = w / 2,
        cy = h / 2,
        m = Math.min(w, h);
      // Lueurs pilotées par les valeurs lissées (pas de clignotement rapide), et
      // figées en mode animations réduites.
      const rm = opts.reduceMotion;
      const pl = rm ? 0 : a.pulse,
        lv = rm ? 0 : a.glowLevel;
      const r = m * 0.17 * (1 + (rm ? 0 : a.bass * 0.06));
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.6);
      core.addColorStop(0, withAlpha('#ffffff', 0.35 + lv * 0.3));
      core.addColorStop(0.3, withAlpha(pal[0], 0.35 + pl * 0.25));
      core.addColorStop(1, withAlpha(pal[0], 0));
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 2.6, 0, Math.PI * 2);
      ctx.fill();
      const n = 180,
        bands = a.bands(64),
        len = m * 0.22;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, m * 0.004);
      ctx.shadowBlur = opts.glow === false ? 0 : 10;
      const rot = rm ? 0 : (opts.t || 0) * 0.00004;
      for (let i = 0; i < n; i++) {
        const half = i < n / 2 ? i : n - 1 - i;
        const v = bands[Math.min(63, Math.floor((half / (n / 2)) * 64))];
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2 + rot;
        batch.add(
          pal[i % 2 ? 1 : 2],
          0.5 + v * 0.5,
          0.5,
          cx + Math.cos(ang) * r,
          cy + Math.sin(ang) * r,
          cx + Math.cos(ang) * (r + 4 + v * len),
          cy + Math.sin(ang) * (r + 4 + v * len),
        );
      }
      batch.stroke(ctx, opts.glow !== false);
      ctx.shadowBlur = 0;
    },

    // Pochette ronde qui tourne, couronne de points et rayons en soleil qui
    // jaillissent avec le son, sur un halo aux couleurs de la pochette.
    // opts : cx, cy, radius, image, spin (lecture en cours), halo (couleur).
    disc(ctx, w, h, a, basePal, opts) {
      // Comme sur une pochette de vinyle : rayons et points aux couleurs de la pochette.
      const pal = opts.palette || basePal;
      const cx = opts.cx ?? w / 2,
        cy = opts.cy ?? h / 2;
      // Animations réduites : ni pulsation du disque, ni rotation, ni lueur qui bat.
      const rm = opts.reduceMotion;
      const pulse = rm ? 1 : 1 + a.bass * 0.06;
      const baseR = opts.radius ?? Math.min(w, h) * 0.12;
      const r = baseR * pulse;
      const t = opts.t || 0;
      const dt = Math.min(100, t - (discState.last || t));
      discState.last = t;
      if (opts.spin && !rm) discState.rot += dt * 0.00012; // ~1 tour en 50 s
      // Lueurs pilotées par les valeurs lissées de l'analyse (au plus quelques
      // éclats par seconde) et d'amplitude plafonnée : WCAG 2.3.1.
      const pl = rm ? 0 : a.pulse,
        lv = rm ? 0 : a.glowLevel;

      // Intensité (réglage) : taille du halo, longueur et densité des rayons.
      const k = Math.max(0.4, Math.min(2.2, opts.intensity ?? 1.3));

      // Halo : respire avec le niveau sonore.
      const haloR = r * (2.4 + 1.1 * k + lv * 0.9 * k);
      const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, haloR);
      halo.addColorStop(0, withAlpha(opts.halo || pal[0], Math.min(0.8, (0.5 + pl * 0.2) * Math.sqrt(k))));
      halo.addColorStop(0.4, withAlpha(opts.halo || pal[0], Math.min(0.5, 0.16 * k)));
      halo.addColorStop(1, withAlpha(opts.halo || pal[0], 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();

      // Lueur du centre : un cœur presque blanc qui s'illumine avec le son.
      // Animations réduites : lueur fixe, sans pulsation.
      const bloom = Math.max(0, Math.min(1.5, opts.bloom ?? 0.8));
      if (bloom > 0) {
        const bR = r * (1.9 + lv * 0.8);
        const b = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, bR);
        b.addColorStop(0, withAlpha('#ffffff', Math.min(0.55, bloom * (0.3 + pl * 0.2))));
        b.addColorStop(0.35, withAlpha(pal[2], Math.min(0.4, bloom * (0.18 + lv * 0.15))));
        b.addColorStop(1, withAlpha(pal[2], 0));
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.arc(cx, cy, bR, 0, Math.PI * 2);
        ctx.fill();
      }

      // Rayons : traits fins et serrés (« fins ») ou barres épaisses et espacées
      // (« épais »), symétriques, basses en haut et en bas.
      const bold = opts.rays === 'bold';
      const n = bold ? Math.round(56 + 16 * k) : Math.min(320, Math.round(140 + 90 * k));
      const bands = a.bands(64);
      const inner = r + 12,
        len = r * (bold ? 1.35 : 1.15) * k;
      ctx.lineCap = 'round';
      ctx.lineWidth = bold ? Math.max(3, r * 0.055) : Math.max(1.1, r * 0.014);
      ctx.shadowBlur = opts.glow === false ? 0 : 8 + 6 * k;
      for (let i = 0; i < n; i++) {
        const half = i < n / 2 ? i : n - 1 - i;
        const v = bands[Math.min(63, Math.floor((half / (n / 2)) * 64))];
        const wob = rm ? 0.5 : 0.5 + 0.5 * Math.sin(i * 1.7 + t * 0.004); // un peu de vie au repos
        const l = 3 + v * len + wob * 3 * k;
        const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
        batch.add(
          pal[i % 2 ? 0 : 1],
          0.55 + v * 0.45,
          0.55,
          cx + Math.cos(ang) * inner,
          cy + Math.sin(ang) * inner,
          cx + Math.cos(ang) * (inner + l),
          cy + Math.sin(ang) * (inner + l),
        );
      }
      batch.stroke(ctx, opts.glow !== false);
      ctx.shadowBlur = 0;

      // Couronne de points.
      ctx.fillStyle = pal[2];
      const dots = 96;
      const dotR = Math.max(1, r * 0.012);
      ctx.beginPath();
      for (let i = 0; i < dots; i++) {
        const ang = (i / dots) * Math.PI * 2 + discState.rot * 0.5;
        const x = cx + Math.cos(ang) * (r + 5),
          y = cy + Math.sin(ang) * (r + 5);
        ctx.moveTo(x + dotR, y);
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
      }
      ctx.fill();

      // Pochette ronde qui tourne : dessinée depuis un canvas hors écran, déjà
      // découpé en cercle à la bonne taille (au lieu de redimensionner l'image
      // de 500 px à chaque image).
      const sprite = coverSprite(opts.image, baseR, opts.dpr || 1);
      if (sprite) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(discState.rot);
        ctx.drawImage(sprite, -r, -r, r * 2, r * 2);
        ctx.restore();
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, pal[1]);
        g.addColorStop(1, pal[0]);
        ctx.fillStyle = g;
        ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        ctx.restore();
      }
      // Liseré sombre pour détacher la pochette des rayons.
      ctx.strokeStyle = 'rgba(0,0,0,.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    },
  };

  const discState = { rot: 0, last: 0 };

  // Pochette découpée en cercle, à la taille d'affichage (en pixels du canvas).
  // Régénérée seulement quand l'image ou le rayon change.
  const coverCache = { img: null, px: 0, canvas: null };
  function coverSprite(img, radius, dpr) {
    if (!img || !img.complete || !img.naturalWidth) return null;
    const px = Math.max(2, Math.round(radius * 2 * dpr));
    if (coverCache.img !== img || coverCache.px !== px || !coverCache.canvas) {
      const c = coverCache.canvas || document.createElement('canvas');
      c.width = c.height = px;
      const x = c.getContext('2d');
      x.clearRect(0, 0, px, px);
      x.save();
      x.beginPath();
      x.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2);
      x.clip();
      x.drawImage(img, 0, 0, px, px);
      x.restore();
      coverCache.img = img;
      coverCache.px = px;
      coverCache.canvas = c;
    }
    return coverCache.canvas;
  }
  const blocksState = { peaks: null, groups: new Array(18).fill(null) };

  // ================= Décors de la scène =================

  // Bord de l'écran lumineux qui pulse avec les basses.
  // La luminosité suit la basse lissée (a.pulse) avec une amplitude plafonnée :
  // pas de clignotement rapide (WCAG 2.3.1). `reduce` : bord fixe, sans pulsation.
  function drawEdgeGlow(ctx, w, h, a, pal, strength = 1, reduce = false) {
    const s = Math.max(0, Math.min(2, strength));
    if (!s) return;
    const p = reduce ? 0 : (a.pulse ?? a.bass);
    const thick = Math.min(w, h) * (0.035 + p * 0.02);
    const alpha = Math.min(0.6, s * (0.18 + p * 0.25));
    const edges = [
      [0, 0, 0, thick, 0, 0, w, thick, pal[0]],
      [0, h, 0, h - thick, 0, h - thick, w, thick, pal[1]],
      [0, 0, thick, 0, 0, 0, thick, h, pal[1]],
      [w, 0, w - thick, 0, w - thick, 0, thick, h, pal[0]],
    ];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const [x0, y0, x1, y1, rx, ry, rw, rh, c] of edges) {
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, withAlpha(c, alpha));
      g.addColorStop(1, withAlpha(c, 0));
      ctx.fillStyle = g;
      ctx.fillRect(rx, ry, rw, rh);
    }
    ctx.restore();
  }

  // Anneaux qui vibrent autour de la petite pochette du panneau.
  function drawCoverRings(ctx, cx, cy, R, a, pal, reduce = false) {
    const bands = a.bands(16);
    ctx.save();
    ctx.lineWidth = Math.max(1.5, R * 0.025);
    for (let i = 0; i < 3; i++) {
      const v = reduce ? 0.15 : (bands[i * 2] + bands[i * 2 + 1]) / 2;
      const rr = R + 7 + i * (R * 0.11) + v * R * 0.12;
      ctx.strokeStyle = pal[i % 3];
      // Le flou de lueur n'est payé que quand l'anneau est visiblement animé.
      ctx.shadowColor = pal[i % 3];
      ctx.shadowBlur = v > 0.3 ? 10 : 0;
      ctx.globalAlpha = Math.min(0.8, 0.2 + v * 0.7) * (1 - i * 0.22);
      ctx.beginPath();
      ctx.arc(cx, cy, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ================= Audio simulé (aperçus des paramètres) =================
  // La fenêtre des paramètres ne capte pas le son : ses aperçus bougent sur un
  // rythme inventé, pour montrer à quoi ressemble chaque style.
  class FakeAudio {
    constructor() {
      this.cache = new Map();
      this.wave = new Float32Array(1024);
      this.t = 0;
      this.reduceMotion = false;
      this.out = {
        bands: (n) => this.bands(n),
        wave: this.wave,
        bass: 0,
        level: 0,
        pulse: 0,
        glowLevel: 0,
        beat: false,
      };
    }
    setSuspended() {}
    frame(now) {
      this.t = now / 1000;
      const beat = Math.pow(Math.max(0, Math.sin(this.t * Math.PI * 2 * 1.9)), 8);
      for (let i = 0; i < this.wave.length; i++) {
        this.wave[i] = Math.sin(i * 0.05 + this.t * 6) * 0.18 * (0.5 + beat) + Math.sin(i * 0.013 - this.t * 2) * 0.08;
      }
      const o = this.out;
      o.bass = 0.25 + beat * 0.7;
      o.level = 0.3 + beat * 0.4;
      // Valeurs de lueur adoucies : l'aperçu ne clignote pas non plus.
      o.pulse = 0.25 + beat * 0.25;
      o.glowLevel = 0.3 + beat * 0.15;
      o.beat = !this.reduceMotion && beat > 0.9;
      return o;
    }
    bands(n) {
      const t = this.t;
      const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2 * 1.9)), 8);
      let arr = this.cache.get(n);
      if (!arr) {
        arr = new Float32Array(n);
        this.cache.set(n, arr);
      }
      for (let i = 0; i < n; i++) {
        const x = i / n;
        const v =
          (1 - x) * (0.35 + beat * 0.55) +
          0.25 * Math.max(0, Math.sin(x * 14 + t * 3.1)) +
          0.15 * Math.sin(x * 37 - t * 5);
        arr[i] = Math.max(0.03, Math.min(1, v * 0.85));
      }
      return arr;
    }
    tick() {}
  }

  // "hsl(10 80% 50%)" ou "#rrggbb" -> même couleur avec une opacité.
  // Le début de la chaîne ("rgba(r, g, b, " ou "hsl(… / ") est calculé une fois
  // par couleur (voir prepareColor, appelé au changement de palette) : à chaque
  // image il ne reste qu'à y accoler l'opacité.
  const colorPrefix = new Map();
  function prepareColor(color) {
    let p = colorPrefix.get(color);
    if (p === undefined) {
      if (color.startsWith('#')) {
        const [r, g, b] = hexToRgb(color);
        p = `rgba(${r}, ${g}, ${b}, `;
      } else if (color.startsWith('hsl(')) p = color.slice(0, -1) + ' / ';
      else p = null;
      if (colorPrefix.size > 256) colorPrefix.clear();
      colorPrefix.set(color, p);
    }
    return p;
  }
  function withAlpha(color, alpha) {
    const p = prepareColor(color);
    return p === null ? color : p + Math.round(alpha * 1000) / 1000 + ')';
  }

  // Catalogue partagé (catalog.js, chargé avant ce fichier) ; repli si absent (démo).
  const CAT = window.SillonCatalog;
  const STYLE_ORDER = CAT ? CAT.STYLE_ORDER : ['bars', 'mirror', 'blocks', 'ring', 'halo', 'wave', 'aurora'];
  const THEME_ORDER = CAT
    ? CAT.THEME_ORDER
    : ['wallpaper', 'album', 'spotify', 'neon', 'sunset', 'ocean', 'violet', 'mono'];
  const STYLE_NAMES = CAT ? CAT.STYLE_NAMES : Object.fromEntries(STYLE_ORDER.map((id) => [id, id]));
  const THEME_NAMES = CAT ? CAT.THEME_NAMES : Object.fromEntries(THEME_ORDER.map((id) => [id, id]));

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
      if (now - this.last >= 1000 / fps - 2) {
        this.last = now;
        this.render(now);
      }
      this.schedule();
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
    currentPosition,
    fmt,
    withAlpha,
    drawEdgeGlow,
    drawCoverRings,
    FakeAudio,
  };
})();
