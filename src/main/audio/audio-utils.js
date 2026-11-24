// @ts-check
// Petites fonctions pures de la chaîne audio (sans Electron), testées à part.

// Délais avant de relancer l'assistant de capture après un échec :
// 3 s, puis 30 s, puis 60 s.
const RETRY_DELAYS = [3000, 30000, 60000];

// `failures` : nombre d'échecs consécutifs (1 = le premier).
function retryDelay(failures) {
  const i = Math.max(1, Math.floor(Number(failures)) || 1) - 1;
  return RETRY_DELAYS[Math.min(i, RETRY_DELAYS.length - 1)];
}

// Le flux est du PCM 16 bits : un morceau de longueur impaire laisse un octet
// qui appartient à l'échantillon suivant. L'assembleur garde cet octet et le
// place devant le morceau suivant, pour que chaque envoi soit aligné.
function createPcmAssembler() {
  let rest = null;
  return {
    // Renvoie un Buffer de longueur paire (éventuellement vide).
    push(chunk) {
      let buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || []);
      if (rest) {
        buf = Buffer.concat([rest, buf]);
        rest = null;
      }
      if (buf.length % 2) {
        rest = Buffer.from(buf.subarray(buf.length - 1));
        buf = buf.subarray(0, buf.length - 1);
      }
      return buf;
    },
    reset() {
      rest = null;
    },
  };
}

// Ajoute `text` à `current` sans dépasser `max` caractères (on garde la fin).
function appendCapped(current, text, max) {
  const s = current + text;
  return s.length > max ? s.slice(s.length - max) : s;
}

module.exports = { RETRY_DELAYS, retryDelay, createPcmAssembler, appendCapped };
