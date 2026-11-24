// Album cover from Deezer's public search (no account).
//
// Spotify sometimes gives Windows a picture of the video rather than the cover
// (tracks that have a video version). So we look for the cover of the studio
// album the track is on (or else the EP, then the single), from
// the artist, album and title given by Windows.
// Only these three texts are sent to Deezer. Nothing reliable found: null,
// and the app keeps the Windows picture.

const API = 'https://api.deezer.com';
const disk = require('./disk-cache');
const { norm, strict, artistKey, note, fetchImageDataUrl, readJsonCapped } = require('./text-norm');
const cache = new Map(); // key -> data URL | null

// Deezer's covers are served by its CDN (cdn-images.dzcdn.net,
// e-cdns-images.dzcdn.net...). Nothing else is downloaded.
const COVER_HOSTS = /^([a-z0-9-]+\.)*dzcdn\.net$/i;
const MAX_JSON = 1024 * 1024; // Deezer JSON reply: 1 MB at most

async function getJson(path) {
  const res = await fetch(API + path, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Deezer ${res.status}`);
  const json = await readJsonCapped(res, MAX_JSON, 'Deezer: reply too large');
  if (json.error) throw new Error(`Deezer : ${json.error.message || 'erreur'}`);
  return json.data || [];
}

async function getAlbum(id) {
  const res = await fetch(`${API}/album/${id}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Deezer ${res.status}`);
  const json = await readJsonCapped(res, MAX_JSON, 'Deezer: reply too large');
  if (json.error) throw new Error('album introuvable');
  return json;
}

const toDataUrl = (url) => fetchImageDataUrl(url, COVER_HOSTS, 8000);

async function findCoverUrl({ title, artist, album }) {
  const a = artistKey(artist);
  if (!a) return null;
  const sameArtist = (name) => artistKey(name) === a;
  const al = norm(album),
    ti = norm(title);
  // Queries with the cleaned names: "(2011 Remaster)" makes Deezer fail.
  const q = (...parts) => encodeURIComponent(parts.filter(Boolean).join(' '));

  // Every album of the artist that has this title (singles, studio album,
  // compilations...), plus the one Windows announces.
  const tracks = [];
  if (ti) tracks.push(...(await getJson(`/search?limit=25&q=${q(a, ti)}`)));
  if (al && al !== ti) tracks.push(...(await getJson(`/search?limit=25&q=${q(a, al)}`)));
  const byArtist = tracks.filter((t) => sameArtist(t.artist && t.artist.name));
  const ids = [];
  const add = (id) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  // Order of preference: the exact title (not a remix or an alternative
  // version), then the same title in a different version, then the album
  // announced by Windows (often a single or a compilation).
  byArtist.filter((t) => strict(t.title) === strict(title)).forEach((t) => add(t.album.id));
  byArtist.filter((t) => norm(t.title) === ti).forEach((t) => add(t.album.id));
  if (al) add((byArtist.find((t) => norm(t.album.title) === al) || {}).album?.id);
  if (!ids.length && al) {
    const albums = await getJson(`/search/album?limit=25&q=${q(a, al)}`);
    add((albums.find((x) => sameArtist(x.artist && x.artist.name) && norm(x.title) === al) || {}).id);
  }
  if (!ids.length) return null;

  // We want the cover of the (studio) album rather than that of the single:
  // Deezer gives the type of each release.
  // If every call fails (network, 429), the error is thrown again: otherwise a
  // "nothing found" would wrongly be cached.
  const settled = await Promise.allSettled(ids.slice(0, 6).map((id) => getAlbum(id)));
  const details = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!details.length) throw settled[0].reason;
  const isLive = (x) => /\blive\b/.test(norm(x.title));
  const pick =
    details.find((x) => x.record_type === 'album' && !isLive(x)) ||
    details.find((x) => x.record_type === 'ep') ||
    details[0];
  return pick ? pick.cover_big || pick.cover_medium : null;
}

async function lookupCover(media) {
  const key = `${norm(media.artist)}|${norm(media.album)}|${norm(media.title)}`;
  if (cache.has(key)) return cache.get(key);
  const stored = await disk.get('covers', key);
  if (stored !== undefined) {
    cache.set(key, stored);
    return stored;
  }
  let result = null;
  try {
    const url = await findCoverUrl(media);
    if (url) result = await toDataUrl(url);
  } catch (e) {
    console.error('Pochette Deezer :', e.message);
    note('cover', e.message);
    return null; // network error: not cached, we will try again on the next track
  }
  // Each entry is an image (100 to 250 KB): 30 are enough, the disk cache does the rest.
  if (cache.size > 30) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  await disk.set('covers', key, result); // errors handled (and noted) by the cache
  return result;
}

module.exports = { lookupCover, norm, findCoverUrl, toDataUrl };
