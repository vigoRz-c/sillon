// Synced lyrics from LRCLIB (lrclib.net: free, no account).
//
// Only the artist, title, album and duration are sent. Result:
//   { lines: [{ t, end, text, words: [{ t, text }] | null }], instrumental }
// in seconds, null if no synced lyrics exist for this title, or
// { error: true } if the search failed (network: nothing is cached).
// When LRCLIB has word-by-word timing (field "lyricsfile"), it is used.

const API = 'https://lrclib.net/api';
const disk = require('./disk-cache');
const { cleanTitle, norm, firstArtist, note, readCapped } = require('./text-norm');
const HEADERS = { 'User-Agent': 'Sillon/0.1' };
const cache = new Map();

const MAX_BODY = 512 * 1024; // a larger LRCLIB reply is suspicious

async function getJson(path) {
  const res = await fetch(API + path, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB ${res.status}`);
  const buf = await readCapped(res, MAX_BODY, 'LRCLIB: reply too large');
  return JSON.parse(buf.toString('utf8'));
}

// "[01:02.44] text" (several timestamps possible per line)
function parseLrc(lrc) {
  const lines = [];
  for (const raw of String(lrc || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of stamps) lines.push({ t: Number(m[1]) * 60 + Number(m[2]), text, words: null });
  }
  lines.sort((a, b) => a.t - b.t);
  lines.forEach((l, i) => {
    // A line followed by a long instrumental must not stay shown
    // until the next one: plausible duration from the number of words (4 to 8 s).
    const words = l.text ? l.text.split(/\s+/).length : 0;
    const reasonable = Math.min(8, Math.max(4, 2 + words * 0.6));
    const next = lines[i + 1] ? lines[i + 1].t : Infinity;
    if (!l.text)
      l.end = next === Infinity ? l.t + 5 : next; // empty line: until the next one
    else if (next === Infinity) l.end = l.t + 5;
    else l.end = Math.min(next, l.t + reasonable);
  });
  return lines;
}

// The "lyricsfile" is a small YAML with a fixed structure: it is read line by line
// rather than adding a library.
function yamlValue(v) {
  v = v.trim();
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  if (v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.slice(1, -1);
    }
  }
  return v;
}

function parseLyricsFile(text) {
  const lines = [];
  let line = null,
    word = null,
    inLines = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (/^lines:\s*$/.test(raw)) {
      inLines = true;
      continue;
    }
    if (!inLines) continue;
    if (/^[A-Za-z_]/.test(raw)) break; // top-level key: end of the "lines" block
    let m;
    if ((m = raw.match(/^- text:\s*(.*)$/))) {
      line = { text: yamlValue(m[1]), t: null, end: 0, words: [] };
      word = null;
      lines.push(line);
    } else if (line && (m = raw.match(/^ {2}- text:\s*(.*)$/))) {
      word = { text: yamlValue(m[1]), t: null };
      line.words.push(word);
    } else if (line && (m = raw.match(/^ {4}start_ms:\s*(\d+)/)) && word) {
      word.t = Number(m[1]) / 1000;
    } else if (line && (m = raw.match(/^ {2}start_ms:\s*(\d+)/))) {
      line.t = Number(m[1]) / 1000;
    } else if (line && (m = raw.match(/^ {2}end_ms:\s*(\d+)/))) {
      line.end = Number(m[1]) / 1000;
    }
  }
  // A line without start_ms makes the file unusable: back to the LRC.
  const ok = lines.length && lines.every((l) => l.t !== null && l.t >= 0 && l.words.every((w) => w.text));
  if (!ok) return null;
  lines.sort((a, b) => a.t - b.t);
  for (const l of lines) {
    // Word without a time: the line's.
    l.words = l.words.map((w) => ({ text: w.text.trim(), t: w.t === null ? l.t : w.t })).filter((w) => w.text);
    if (!l.words.length) l.words = null;
    if (!l.end) l.end = l.t + 5;
  }
  return lines;
}

function toResult(rec) {
  if (!rec) return null;
  if (rec.instrumental) return { lines: [], instrumental: true };
  const lines = (rec.lyricsfile && parseLyricsFile(rec.lyricsfile)) || parseLrc(rec.syncedLyrics);
  return lines.length ? { lines, instrumental: false } : null;
}

async function findLyrics({ title, artist, album, duration }) {
  const t = cleanTitle(title),
    a = firstArtist(artist);
  if (!t || !a) return null;
  const p = new URLSearchParams({ track_name: t, artist_name: a });
  if (album) p.set('album_name', cleanTitle(album));
  if (duration) p.set('duration', String(Math.round(duration)));
  const exact = await getJson(`/get?${p}`);
  if (exact && (exact.syncedLyrics || exact.instrumental)) return toResult(exact);

  // No exact match (different album or duration): search, keeping
  // a result with the same artist, same title and a close duration.
  const list = (await getJson(`/search?${new URLSearchParams({ track_name: t, artist_name: a })}`)) || [];
  const close = (r) => !duration || !r.duration || Math.abs(r.duration - duration) <= 8;
  const hit = list.find(
    (r) => r.syncedLyrics && norm(r.trackName) === norm(t) && norm(firstArtist(r.artistName)) === norm(a) && close(r),
  );
  return toResult(hit);
}

// options.volatile: the track duration may be stale (that of the previous
// track, the timeline arrives after the title): an empty result is then
// not remembered, it would be wrong for this track.
async function lookupLyrics(media, { volatile = false } = {}) {
  const key = `${norm(firstArtist(media.artist))}|${norm(media.title)}|${Math.round((media.duration || 0) / 5)}`;
  if (cache.has(key)) return cache.get(key);
  const stored = await disk.get('lyrics', key);
  if (stored !== undefined) {
    cache.set(key, stored);
    return stored;
  }
  let result;
  try {
    result = await findLyrics(media);
  } catch (e) {
    console.error('Paroles :', e.message);
    note('lyrics', e.message);
    return { error: true }; // network error: not cached, distinct from "no lyrics"
  }
  if (volatile && !result) return result;
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  await disk.set('lyrics', key, result); // errors handled (and noted) by the cache
  return result;
}

module.exports = { lookupLyrics, findLyrics, parseLrc, parseLyricsFile };
