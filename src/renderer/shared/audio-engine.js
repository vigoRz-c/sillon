/* Sillon — audio analysis: capture, FFT in bands, beat (AudioEngine) and
   simulated audio for the settings previews (FakeAudio).
   Classic script: exposes window.SillonAudio. Loaded before engine.js. */
(function () {
  'use strict';

  // ================= Audio =================

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.analyser = null;
      this.sensitivity = 1;
      this.bandsCache = new Map(); // n -> smoothed Float32Array
      this.bassAvg = 0;
      this.lastBeat = 0;
      this.status = 'idle'; // idle | running | no-audio | error
      this.wave = new Float32Array(2048); // silence until the audio is plugged in
      this.gen = 0; // generation token: a late start of a stale source gives up
      this.suspended = false; // rendering paused: audio context suspended
      this.reduceMotion = false; // reduced motion: slower smoothing, no beat
      this.pcmRest = null; // byte left over from a PCM chunk of odd length
      this.pulse = 0; // smoothed bass (for the glows: never more than a few flashes per second)
      this.glowLevel = 0; // smoothed level, same
      this.lastFrameT = 0;
      // Object returned every frame, reused (no allocation per frame).
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

    // System sound via getDisplayMedia (loopback handled on the main side). Never the microphone.
    async startSystem() {
      this.stop();
      const gen = this.gen;
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        if (gen !== this.gen) {
          // Another start (or a stop) happened in the meantime: give the stream back.
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
        console.error('Audio capture failed:', e);
        if (gen === this.gen) {
          if (stream) stream.getTracks().forEach((t) => t.stop());
          this.status = 'error';
        }
        return false;
      }
    }

    // Sound of the followed player only (Spotify, browser…), sent raw by the
    // main process: voice chat and the other apps are ignored.
    async startApp(bridge) {
      this.stop();
      const gen = this.gen;
      let ctx = null;
      try {
        ctx = new AudioContext({ sampleRate: 48000 });
        this.ctx = ctx; // set early: stop() closes it if we are cut off on the way
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
        // The graph must reach the output to run: zero gain, nothing audible.
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
        console.error('Player capture failed:', e);
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

    // Receives a chunk of 16-bit PCM. The worklet expects whole samples: a
    // possible lone byte is kept for the next chunk.
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

    // Stops the current source (before starting another one).
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

    // Rendering paused (scene hidden, asleep, full-screen game): the audio
    // context, which has nothing left to analyze, is suspended too.
    setSuspended(on) {
      this.suspended = !!on;
      if (on) this.pcmRest = null; // the leftover byte would be glued to a stale chunk on resume
      if (!this.ctx) return;
      (on ? this.ctx.suspend() : this.ctx.resume()).catch(() => {});
    }

    // Connect any audio node (also used by the tests / the demo).
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

    // One analysis frame. The visualizers ask for the number of bands they want.
    frame(now) {
      const out = this.out;
      out.wave = this.wave;
      out.bass = 0;
      out.level = 0;
      out.beat = false;
      if (!this.analyser) {
        // No audio: everything slowly falls back.
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
      // Glows: smoothed bass and level (time constant ~200 ms), so the
      // brightness does not flicker to the bass (WCAG 2.3.1).
      const dt = Math.max(0, Math.min(250, now - this.lastFrameT));
      this.lastFrameT = now;
      const k = 1 - Math.exp(-dt / 200);
      this.pulse += (out.bass - this.pulse) * k;
      this.glowLevel += (out.level - this.glowLevel) * k;
      out.pulse = this.pulse;
      out.glowLevel = this.glowLevel;
      // Beat: the bass clearly exceeds its recent average. At most ~3 per
      // second (350 ms minimum), and none in reduced motion mode.
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

    // n bands spread on a logarithmic scale from 35 Hz to 16 kHz,
    // fast rise / slow fall for smooth rendering.
    bands(n) {
      let arr = this.bandsCache.get(n);
      if (!arr) {
        // The requested sizes change with the window: drop those no longer used.
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
        // Treble carries less energy: lift it a little.
        let v = (m / 255) * (0.85 + 0.5 * (i / n)) * this.sensitivity;
        v = Math.min(1, Math.pow(v, 1.6));
        // Reduced motion: slower rise and fall (smoothed bars).
        arr[i] = v > arr[i] ? arr[i] + (v - arr[i]) * up : arr[i] * down + v * (1 - down);
      }
      return arr;
    }

    tick() {
      this.frameStamp = (this.frameStamp || 0) + 1;
    }
  }

  // ================= Simulated audio (settings previews) =================
  // The settings window does not capture sound: its previews move to a
  // made-up rhythm, to show what each style looks like.
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
      // Softened glow values: the preview does not flicker either.
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
