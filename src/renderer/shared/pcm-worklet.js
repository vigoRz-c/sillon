/* Raw sound player for the analysis (AudioWorklet).
 *
 * Receives from the main process chunks of 16-bit mono sound (capture of
 * the followed player only, see src/main/audio/app-audio.js) and plays them into the
 * audio graph, where the visualizer's analyser reads them. Nothing is sent
 * to the speakers. A short buffer is kept to stay close to the heard sound.
 */
/* global AudioWorkletProcessor, registerProcessor */
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(48000); // 1 s at most
    this.read = 0;
    this.write = 0;
    this.size = 0;
    this.env = 0;
    this.gain = 1;
    this.port.onmessage = (e) => this.push(new Int16Array(e.data));
  }

  // Automatic level control: the captured sound of a single app is often
  // much quieter than the whole PC's (about 10 dB less, depending on the
  // app's volume). It is brought toward a fixed average level, so the
  // visualizer reacts the same whatever the volume. Silence is not
  // amplified.
  push(samples) {
    const buf = this.buf,
      cap = buf.length;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] / 32768;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / Math.max(1, samples.length));
    if (rms > 0.001) this.env = this.env ? this.env * 0.99 + rms * 0.01 : rms; // ~1 s of memory
    const target = this.env ? Math.min(12, Math.max(1, 0.08 / this.env)) : 1;
    this.gain += (target - this.gain) * 0.05;
    const g = this.gain / 32768;
    let w = this.write;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i] * g;
      buf[w] = v > 1 ? 1 : v < -1 ? -1 : v;
      if (++w === cap) w = 0; // wrap-around without modulo
    }
    this.write = w;
    this.size = Math.min(cap, this.size + samples.length);
    // Delay capped at ~80 ms: skip what goes beyond.
    const max = 3840;
    if (this.size > max) {
      this.read = (this.write - max + cap) % cap;
      this.size = max;
    } else if (this.size === cap) {
      this.read = this.write;
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0][0];
    const buf = this.buf,
      cap = buf.length;
    let r = this.read,
      size = this.size;
    for (let i = 0; i < out.length; i++) {
      if (size > 0) {
        out[i] = buf[r];
        if (++r === cap) r = 0;
        size--;
      } else out[i] = 0;
    }
    this.read = r;
    this.size = size;
    return true;
  }
}

registerProcessor('sillon-pcm', PcmPlayer);
