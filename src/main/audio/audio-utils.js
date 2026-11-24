// @ts-check
// Small pure functions of the audio chain (without Electron), tested separately.

// Delays before restarting the capture helper after a failure:
// 3 s, then 30 s, then 60 s.
const RETRY_DELAYS = [3000, 30000, 60000];

// `failures`: number of consecutive failures (1 = the first).
function retryDelay(failures) {
  const i = Math.max(1, Math.floor(Number(failures)) || 1) - 1;
  return RETRY_DELAYS[Math.min(i, RETRY_DELAYS.length - 1)];
}

// The stream is 16-bit PCM: a chunk of odd length leaves a byte
// that belongs to the next sample. The assembler keeps this byte and
// puts it in front of the next chunk, so that every send is aligned.
function createPcmAssembler() {
  let rest = null;
  return {
    // Returns a Buffer of even length (possibly empty).
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

// Appends `text` to `current` without exceeding `max` characters (the end is kept).
function appendCapped(current, text, max) {
  const s = current + text;
  return s.length > max ? s.slice(s.length - max) : s;
}

module.exports = { RETRY_DELAYS, retryDelay, createPcmAssembler, appendCapped };
