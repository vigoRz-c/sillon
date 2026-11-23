/* Lecteur de son brut pour l'analyse (AudioWorklet).
 *
 * Reçoit du processus principal des morceaux de son mono 16 bits (capture du
 * seul lecteur suivi, voir src/main/audio/app-audio.js) et les rejoue dans le graphe
 * audio, où l'analyseur du visualiseur les lit. Rien n'est envoyé aux
 * haut-parleurs. On garde un tampon court pour coller au son entendu.
 */
/* global AudioWorkletProcessor, registerProcessor */
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(48000); // 1 s au plus
    this.read = 0;
    this.write = 0;
    this.size = 0;
    this.port.onmessage = (e) => this.push(new Int16Array(e.data));
  }

  // Réglage automatique du niveau : le son capturé d'une seule appli est
  // souvent bien plus faible que celui de tout le PC (environ 10 dB de moins,
  // selon le volume de l'appli). On le ramène vers un niveau moyen fixe, pour
  // que le visualiseur réagisse pareil quel que soit le volume. Le silence
  // n'est pas amplifié.
  push(samples) {
    const buf = this.buf, cap = buf.length;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) { const v = samples[i] / 32768; sum += v * v; }
    const rms = Math.sqrt(sum / Math.max(1, samples.length));
    if (rms > 0.001) this.env = this.env ? this.env * 0.99 + rms * 0.01 : rms; // ~1 s de mémoire
    const target = this.env ? Math.min(12, Math.max(1, 0.08 / this.env)) : 1;
    this.gain = (this.gain || 1) + (target - (this.gain || 1)) * 0.05;
    const g = this.gain;
    for (let i = 0; i < samples.length; i++) {
      const v = (samples[i] / 32768) * g;
      buf[this.write] = v > 1 ? 1 : v < -1 ? -1 : v;
      this.write = (this.write + 1) % cap;
    }
    this.size = Math.min(cap, this.size + samples.length);
    // Retard limité à ~80 ms : on saute ce qui dépasse.
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
    const buf = this.buf, cap = buf.length;
    for (let i = 0; i < out.length; i++) {
      if (this.size > 0) {
        out[i] = buf[this.read];
        this.read = (this.read + 1) % cap;
        this.size--;
      } else out[i] = 0;
    }
    return true;
  }
}

registerProcessor('sillon-pcm', PcmPlayer);
