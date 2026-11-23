// File d'attente « À suivre » (API Spotify, facultative).
//
// Windows ne donne que le morceau en cours : les suivants viennent de l'API
// Spotify, une fois le compte connecté dans les paramètres. Interrogée au
// changement de morceau et toutes les 20 s pendant la lecture.

const S = require('../app/state');
const { SpotifyApi } = require('./spotify-api');
const diagnostic = require('../app/diagnostic');

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
  } catch {
    return null;
  }
}

// État aléatoire / répétition lu dans l'API (celui de Windows n'est pas fiable).
async function refreshPlayer() {
  const spotify = S.spotify;
  if (!spotify || !spotify.canControl()) {
    S.playerState = null;
    S.actions.rebroadcast();
    return;
  }
  try {
    S.playerState = await spotify.player();
  } catch {
    S.playerState = null;
  }
  S.actions.rebroadcast();
}

// Toutes les commandes de lecture passent par ici (boutons, plein écran, icône).
// Lecture, précédent, suivant : Windows. Aléatoire, répétition : API Spotify,
// car l'app Spotify ignore ces deux commandes venant de Windows.
async function mediaCommand(cmd) {
  const spotify = S.spotify;
  if (cmd !== 'shuffle' && cmd !== 'repeat') {
    if (S.media) S.media.command(cmd);
    return;
  }
  if (!spotify || !spotify.canControl()) {
    diagnostic.note('spotify', `${cmd} ignoré : compte Spotify non connecté`);
    return;
  }
  try {
    const cur = S.playerState || (await spotify.player()) || { shuffle: false, repeat: 'None' };
    if (cmd === 'shuffle' ? cur.shuffleAllowed === false : cur.repeatAllowed === false) {
      diagnostic.note('spotify', `${cmd} → interdit par Spotify pour le moment`);
      refreshPlayer();
      return;
    }
    if (cmd === 'shuffle') {
      await spotify.setShuffle(!cur.shuffle);
      S.playerState = { ...cur, shuffle: !cur.shuffle };
    } else {
      const next = { None: 'List', List: 'Track', Track: 'None' }[cur.repeat] || 'List';
      await spotify.setRepeat(next);
      S.playerState = { ...cur, repeat: next };
    }
    diagnostic.note(
      'spotify',
      `${cmd} → accepté (aléatoire ${S.playerState.shuffle ? 'oui' : 'non'}, répétition ${S.playerState.repeat})`,
    );
    S.actions.rebroadcast();
    setTimeout(refreshPlayer, 1500);
  } catch (e) {
    diagnostic.note('spotify', `${cmd} → ${e.message}`);
    if (e.retryAfter) pauseUntil = Date.now() + e.retryAfter * 1000;
    refreshPlayer();
  }
}

function sendQueue(q) {
  S.lastQueue = q;
  S.send([S.widget, S.editorWin], 'queue', q);
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
  refreshPlayer();
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
    S.actions.rebroadcast(); // boutons aléatoire / répétition affichés ou non
  };
  spotify.on('status', pushStatus);
  spotify.on('connected', () => {
    pushStatus(spotify.status());
    refreshQueue();
  });
  setInterval(() => {
    if (S.lastMedia.active && S.lastMedia.status === 'Playing') refreshQueue();
  }, 20000);
  spotify.ready.then(() => {
    pushStatus(spotify.status());
    refreshQueue();
  });
}

module.exports = { refreshQueue, refreshPlayer, startSpotify, mediaCommand };
