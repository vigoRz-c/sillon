// File d'attente « À suivre » (API Spotify, facultative).
//
// Windows ne donne que le morceau en cours : les suivants viennent de l'API
// Spotify, une fois le compte connecté dans les paramètres. Interrogée au
// changement de morceau et toutes les 20 s pendant la lecture.

const S = require('./state');
const { SpotifyApi } = require('./spotify-api');
const diagnostic = require('./diagnostic');

const imageCache = new Map(); // URL Spotify -> data URL (la page n'accepte que data:)
async function imageData(url) {
  if (!url) return null;
  if (imageCache.has(url)) return imageCache.get(url);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = `data:${res.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
    if (imageCache.size > 100) imageCache.delete(imageCache.keys().next().value);
    imageCache.set(url, data);
    return data;
  } catch { return null; }
}

function sendQueue(q) {
  S.lastQueue = q;
  S.send([S.widget], 'queue', q);
}

let busy = false;
let pauseUntil = 0;
async function refreshQueue() {
  const spotify = S.spotify;
  if (!spotify || busy || Date.now() < pauseUntil) return;
  if (!spotify.status().connected) {
    if (S.lastQueue.connected || S.lastQueue.items.length) sendQueue({ items: [], connected: false });
    return;
  }
  busy = true;
  try {
    const items = await spotify.queue(4);
    const withImages = await Promise.all(items.map(async (it) => ({ ...it, image: await imageData(it.image) })));
    sendQueue({ items: withImages, connected: true });
    if (spotify.status().error) spotify.setError('');
  } catch (e) {
    if (e.retryAfter) pauseUntil = Date.now() + e.retryAfter * 1000;
    spotify.setError(e.message);
  } finally {
    busy = false;
  }
}

function startSpotify() {
  const spotify = new SpotifyApi(() => ({
    custom: !!S.settings.get('spotifyCustomClientId'),
    clientId: S.settings.get('spotifyClientId'),
  }));
  S.spotify = spotify;
  let lastError = '';
  const pushStatus = (st) => {
    if (st.error && st.error !== lastError) diagnostic.note('spotify', st.error);
    lastError = st.error || '';
    S.send([S.settingsWin], 'spotify-status', st);
  };
  spotify.on('status', pushStatus);
  spotify.on('connected', () => { pushStatus(spotify.status()); refreshQueue(); });
  setInterval(() => { if (S.lastMedia.active && S.lastMedia.status === 'Playing') refreshQueue(); }, 20000);
  spotify.ready.then(() => { pushStatus(spotify.status()); refreshQueue(); });
}

module.exports = { refreshQueue, startSpotify };
