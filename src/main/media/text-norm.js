// @ts-check
// Normalization of titles and artist names, shared by the search
// for covers (Deezer) and lyrics (LRCLIB).

// Without accents, lowercase, letters and digits separated by a space.
function strict(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// "Bohemian Rhapsody - Remastered 2011" -> "Bohemian Rhapsody".
// Only the parentheses that follow some text are removed: "(Don't Fear)
// The Reaper" keeps its start. If everything disappeared, the original text is returned.
function cleanTitle(s) {
  const src = String(s || '').trim();
  const out = src
    .replace(/(?<=\S)\s*[([].*?[)\]]/g, '')
    .replace(/(?<=\S)\s+-\s+.*$/, '')
    .trim();
  return out || src;
}

// "Break Stuff (Remastered 2021) - Live" -> "break stuff"
const norm = (s) => strict(cleanTitle(s));

// Windows sometimes gives "Artist 1, Artist 2": the first one is kept.
const firstArtist = (s) =>
  String(s || '')
    .split(/,|&| feat\.? | ft\.? /i)[0]
    .trim();

// First artist, normalized (for comparing).
const artistKey = (s) => norm(firstArtist(s));

// Note in the diagnostic if available (the module depends on Electron: missing
// in the tests, where the log is not needed).
let diag;
function note(kind, text) {
  try {
    if (diag === undefined) diag = require('../app/diagnostic');
    diag.note(kind, text);
  } catch {
    diag = null;
  }
}

// Downloads a remote image as a data URL (the page only accepts data:).
// Safeguards: HTTPS, allowed host (hosts: RegExp on the host name), type
// image/jpeg|png|webp, 2 MB at most. Throws an error otherwise.
const IMAGE_MAX = 2 * 1024 * 1024;
const IMAGE_TYPE = /^image\/(jpeg|png|webp)\s*(;|$)/i;

function checkImageUrl(url, hosts) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('invalid image address');
  }
  if (u.protocol !== 'https:') throw new Error('image refused: HTTPS required');
  if (!hosts.test(u.hostname)) throw new Error(`image refused: host not allowed (${u.hostname})`);
  return u;
}

// Reads the body of a reply, stopping as soon as `max` bytes are exceeded
// (a missing or lying content-length header is not enough to protect the
// memory).
async function readCapped(res, max, tooBig = 'reply too large') {
  const declared = Number(res.headers && res.headers.get && res.headers.get('content-length'));
  if (declared > max) throw new Error(tooBig);
  if (!res.body || typeof res.body.getReader !== 'function') {
    // Reply without a readable stream (empty body, simulated reply): direct read.
    const buf =
      typeof res.arrayBuffer === 'function'
        ? Buffer.from(await res.arrayBuffer())
        : Buffer.from(await res.text(), 'utf8');
    if (buf.length > max) throw new Error(tooBig);
    return buf;
  }
  const reader = res.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw new Error(tooBig);
    }
    parts.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(parts, size);
}

// Capped JSON. A reply that only exposes json() (simulated reply in
// the tests) is read as is.
async function readJsonCapped(res, max, tooBig) {
  const readable = (res.body && typeof res.body.getReader === 'function') || res.arrayBuffer || res.text;
  if (!readable && typeof res.json === 'function') return res.json();
  return JSON.parse((await readCapped(res, max, tooBig)).toString('utf8'));
}

const MAX_REDIRECTS = 3;

async function fetchImageDataUrl(url, hosts, timeout = 8000) {
  let u = checkImageUrl(url, hosts);
  const signal = AbortSignal.timeout(timeout);
  let res;
  // Redirects followed by hand: each address is checked BEFORE the request.
  for (let hop = 0; ; hop++) {
    res = await fetch(u.href, { signal, redirect: 'manual' });
    if (res.status < 300 || res.status >= 400) break;
    const loc = res.headers && res.headers.get && res.headers.get('location');
    if (!loc || hop >= MAX_REDIRECTS) throw new Error(`image ${res.status}: redirect refused`);
    u = checkImageUrl(new URL(loc, u).href, hosts);
  }
  if (!res.ok) throw new Error(`image ${res.status}`);
  const type = (res.headers && res.headers.get('content-type')) || '';
  if (!IMAGE_TYPE.test(type)) throw new Error(`image refused: type ${type || 'unknown'}`);
  const buf = await readCapped(res, IMAGE_MAX, 'image refused: too big');
  return `data:${type.split(';')[0].trim().toLowerCase()};base64,${buf.toString('base64')}`;
}

module.exports = {
  strict,
  cleanTitle,
  norm,
  firstArtist,
  artistKey,
  note,
  fetchImageDataUrl,
  readCapped,
  readJsonCapped,
  IMAGE_MAX,
};
