/* Sillon — analyse audio : capture, FFT en bandes, battement (AudioEngine) et
   audio simulé pour les aperçus des paramètres (FakeAudio).
   Script classique : expose window.SillonAudio. Chargé avant engine.js. */
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
      if (on) this.pcmRest = null; // l'octet restant serait recollé à un morceau périmé à la reprise
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
        // Les tailles demandées changent avec la fenêtre : on purge celles qui ne servent plus.
        if (this.bandsCache.size >= 12) {
          for (const [k, v] of this.bandsCache) if ((this.frameStamp || 0) - v.seen > 300) this.bandsCache.delete(k);
        }
        arr = new Float32Array(n);
        this.bandsCache.set(n, arr);
        arr.stamp = -1;
      }
      arr.seen = this.frameStamp || 0;
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

  window.SillonAudio = { AudioEngine, FakeAudio };
})();
