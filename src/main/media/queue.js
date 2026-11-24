// File d'attente « À suivre » (API Spotify, facultative).
//
// Windows ne donne que le morceau en cours : les suivants viennent de l'API
// Spotify, une fois le compte connecté dans les paramètres. Interrogée au
// changement de morceau et toutes les 20 s pendant la lecture.

const S = require('../app/state');
const { SpotifyApi } = require('./spotify-api');
const diagnostic = require('../app/diagnostic');
const { exeForApp } = require('../audio/app-ids');
const { fetchImageDataUrl } = require('./text-norm');

// Pochettes de Spotify : i.scdn.co et autres hôtes du CDN, rien d'autre.
const IMAGE_HOSTS = /^([a-z0-9-]+\.)*(scdn\.co|spotifycdn\.com)$/i;

const imageCache = new Map(); // URL Spotify -> data URL (la page n'accepte que data:)
async function imageData(url) {
  if (!url) return null;
  if (imageCache.has(url)) return imageCache.get(url);
  try {
    const data = await fetchImageDataUrl(url, IMAGE_HOSTS, 6000);
    if (imageCache.size > 100) imageCache.delete(imageCache.keys().next().value);
    imageCache.set(url, data);
    return data;
  } catch (e) {
    diagnostic.note('spotify', `image de la file : ${e.message}`);
    return null;
  }
}

// Pause commune aux deux requêtes (player, queue) après un 429 de Spotify.
let pauseUntil = 0;
const notePause = (e) => {
  if (e && e.retryAfter) pauseUntil = Date.now() + e.retryAfter * 1000;
};

// Après des erreurs répétées, on espace les relectures de l'état du lecteur
// (2 s, 4 s, 8 s... jusqu'à 60 s) au lieu de marteler l'API.
let playerFailures = 0;
let playerRetryAt = 0;
let playerInflight = null;

// État aléatoire / répétition lu dans l'API (celui de Windows n'est pas fiable).
function refreshPlayer() {
  const spotify = S.spotify;
  if (!spotify || !spotify.canControl()) {
    S.playerState = null;
    S.actions.rebroadcast();
    return Promise.resolve();
  }
  if (Date.now() < pauseUntil || Date.now() < playerRetryAt) return Promise.resolve();
  if (playerInflight) return playerInflight;
  playerInflight = (async () => {
    try {
      S.playerState = await spotify.player();
      playerFailures = 0;
      playerRetryAt = 0;
    } catch (e) {
      notePause(e);
      playerFailures++;
      playerRetryAt = Date.now() + Math.min(60000, 2000 * 2 ** (playerFailures - 1));
      diagnostic.note('spotify', `état du lecteur : ${e.message}`);
      S.playerState = null;
    } finally {
      playerInflight = null;
    }
    S.actions.rebroadcast();
  })();
  return playerInflight;
}

const NEXT_REPEAT = { None: 'List', List: 'Track', Track: 'None' };
const nextRepeat = (mode) => NEXT_REPEAT[mode] || 'List';

// Les commandes aléatoire / répétition sont traitées l'une après l'autre : deux
// clics rapides = deux bascules, chacune calculée sur l'état à jour.
let commandChain = Promise.resolve();

async function spotifyCommand(cmd) {
  const spotify = S.spotify;
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
      const next = nextRepeat(cur.repeat);
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
    notePause(e);
    refreshPlayer();
  }
}

// Spotify ignore parfois la bascule SMTC (« accepté » mais reste en pause) :
// on envoie « play » ou « pause » explicitement, selon l'état connu.
function explicitPlayPause(cmd) {
  if (cmd !== 'playpause') return cmd;
  return S.lastMedia && S.lastMedia.status === 'Playing' ? 'pause' : 'play';
}

// Après un « play » accepté, si Spotify est toujours en pause, on passe par
// son API (sur l'ordinateur si aucun appareil n'est actif).
const PLAY_CHECK_MS = 1500;
function checkPlayResumed() {
  const spotify = S.spotify;
  const m = S.lastMedia;
  if (!spotify || !spotify.canControl() || !m || !m.active || m.status === 'Playing') return;
  if (exeForApp(m.app) !== 'Spotify.exe') return;
  commandChain = commandChain
    .then(async () => {
      try {
        const device = await spotify.playbackDevice();
        await spotify.play(device && !device.active ? device.id : undefined);
        diagnostic.note('spotify', `play → toujours en pause après Windows, repris par l'API Spotify`);
      } catch (e) {
        diagnostic.note('spotify', `play (API) → ${e.message}`);
        notePause(e);
      }
    })
    .catch(() => {});
}

// Toutes les commandes de lecture passent par ici (boutons, plein écran, icône).
// Lecture, précédent, suivant : Windows. Aléatoire, répétition : API Spotify,
// car l'app Spotify ignore ces deux commandes venant de Windows.
function mediaCommand(cmd) {
  if (cmd !== 'shuffle' && cmd !== 'repeat') {
    const sent = explicitPlayPause(cmd);
    if (S.media) S.media.command(sent);
    if (sent === 'play') setTimeout(checkPlayResumed, PLAY_CHECK_MS);
    return Promise.resolve();
  }
  commandChain = commandChain.then(() => spotifyCommand(cmd)).catch(() => {});
  return commandChain;
}

function sendQueue(q) {
  // Rien à renvoyer si la file n'a pas changé (les images sont lourdes).
  if (JSON.stringify(q) === JSON.stringify(S.lastQueue)) return;
  S.lastQueue = q;
  S.send([S.widget, S.editorWin], 'queue', q);
}

// Identifie le morceau en cours : un résultat obtenu pour un autre est périmé.
const currentTrack = () => {
  const m = S.lastMedia || {};
  return m.active ? `${m.app}|${m.title}|${m.artist}|${m.album}` : '';
};

let busy = false;
let dirty = false;
async function refreshQueue() {
  const spotify = S.spotify;
  if (!spotify || Date.now() < pauseUntil) return;
  if (busy) {
    dirty = true; // une demande est arrivée pendant la requête : on relance à la fin
    return;
  }
  if (!spotify.status().connected) {
    if (S.lastQueue.connected || S.lastQueue.items.length) sendQueue({ items: [], connected: false });
    return;
  }
  busy = true;
  dirty = false;
  const track = currentTrack();
  refreshPlayer();
  try {
    const items = await spotify.queue(4);
    // null : jeton absent ou rafraîchissement en échec, pas une file vide. On
    // garde la file affichée et l'erreur (l'effacer cacherait le problème).
    if (!items) return;
    const withImages = await Promise.all(items.map(async (it) => ({ ...it, image: await imageData(it.image) })));
    // Le morceau a changé, ou la session est fermée, pendant la requête : résultat périmé.
    if (S.spotify === spotify && spotify.status().connected && currentTrack() === track) {
      sendQueue({ items: withImages, connected: true });
      if (spotify.status().error) spotify.clearError();
    } else {
      dirty = true;
    }
  } catch (e) {
    notePause(e);
    diagnostic.note('spotify', `file d'attente : ${e.message}`);
    spotify.setError(e.message);
  } finally {
    busy = false;
  }
  if (dirty) {
    dirty = false;
    await refreshQueue();
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
  // Seulement si une page affiche la file (scène éveillée ou éditeur) : scène
  // masquée, endormie ou cachée par un jeu, rien à lire. Au réveil, main.js
  // (applyRest) relit la file tout de suite.
  setInterval(() => {
    const shown = S.sceneActive() || S.alive(S.editorWin);
    if (shown && S.lastMedia.active && S.lastMedia.status === 'Playing') refreshQueue();
  }, 20000);
  spotify.ready.then(() => {
    pushStatus(spotify.status());
    refreshQueue();
  });
}

// Remise à zéro de l'état interne (tests).
function resetForTests() {
  pauseUntil = 0;
  playerFailures = 0;
  playerRetryAt = 0;
  playerInflight = null;
  busy = false;
  dirty = false;
  commandChain = Promise.resolve();
  imageCache.clear();
}

module.exports = { refreshQueue, refreshPlayer, startSpotify, mediaCommand, nextRepeat, resetForTests };
