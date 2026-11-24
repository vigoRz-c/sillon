// Pochette de l'album via la recherche publique de Deezer (sans compte).
//
// Spotify transmet parfois à Windows une image du clip plutôt que la pochette
// (titres qui ont une version vidéo). On cherche donc la pochette de l'album
// studio où figure le morceau (à défaut l'EP, puis le single), à partir de
// l'artiste, de l'album et du titre fournis par Windows.
// Seuls ces trois textes sont envoyés à Deezer. Rien trouvé de fiable : null,
// et l'app garde l'image de Windows.

const API = 'https://api.deezer.com';
const disk = require('./disk-cache');
const { norm, strict, artistKey, note, fetchImageDataUrl, readJsonCapped } = require('./text-norm');
const cache = new Map(); // clé -> data URL | null

// Les pochettes de Deezer sont servies par son CDN (cdn-images.dzcdn.net,
// e-cdns-images.dzcdn.net...). Rien d'autre n'est téléchargé.
const COVER_HOSTS = /^([a-z0-9-]+\.)*dzcdn\.net$/i;
const MAX_JSON = 1024 * 1024; // réponse JSON de Deezer : 1 Mo au plus

async function getJson(path) {
  const res = await fetch(API + path, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Deezer ${res.status}`);
  const json = await readJsonCapped(res, MAX_JSON, 'Deezer : réponse trop volumineuse');
  if (json.error) throw new Error(`Deezer : ${json.error.message || 'erreur'}`);
  return json.data || [];
}

async function getAlbum(id) {
  const res = await fetch(`${API}/album/${id}`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Deezer ${res.status}`);
  const json = await readJsonCapped(res, MAX_JSON, 'Deezer : réponse trop volumineuse');
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
  // Requêtes avec les noms nettoyés : "(2011 Remaster)" fait échouer Deezer.
  const q = (...parts) => encodeURIComponent(parts.filter(Boolean).join(' '));

  // Tous les albums de l'artiste où figure ce titre (singles, album studio,
  // compilations...), plus celui que Windows annonce.
  const tracks = [];
  if (ti) tracks.push(...(await getJson(`/search?limit=25&q=${q(a, ti)}`)));
  if (al && al !== ti) tracks.push(...(await getJson(`/search?limit=25&q=${q(a, al)}`)));
  const byArtist = tracks.filter((t) => sameArtist(t.artist && t.artist.name));
  const ids = [];
  const add = (id) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  // Ordre de préférence : le titre exact (pas un remix ni une version
  // alternative), puis le même titre en version différente, puis l'album
  // annoncé par Windows (souvent un single ou une compilation).
  byArtist.filter((t) => strict(t.title) === strict(title)).forEach((t) => add(t.album.id));
  byArtist.filter((t) => norm(t.title) === ti).forEach((t) => add(t.album.id));
  if (al) add((byArtist.find((t) => norm(t.album.title) === al) || {}).album?.id);
  if (!ids.length && al) {
    const albums = await getJson(`/search/album?limit=25&q=${q(a, al)}`);
    add((albums.find((x) => sameArtist(x.artist && x.artist.name) && norm(x.title) === al) || {}).id);
  }
  if (!ids.length) return null;

  // On veut la pochette de l'album (studio) plutôt que celle du single :
  // Deezer indique le type de chaque sortie.
  // Si tous les appels échouent (réseau, 429), on relance l'erreur : sinon un
  // « rien trouvé » serait mis en cache à tort.
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
  const stored = disk.get('covers', key);
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
    note('pochette', e.message);
    return null; // erreur réseau : pas mis en cache, on réessaiera au prochain morceau
  }
  // Chaque entrée est une image (100 à 250 Ko) : 30 suffisent, le cache disque fait le reste.
  if (cache.size > 30) cache.delete(cache.keys().next().value);
  cache.set(key, result);
  disk.set('covers', key, result);
  return result;
}

module.exports = { lookupCover, norm, findCoverUrl, toDataUrl };
