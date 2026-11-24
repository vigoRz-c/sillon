// "Up next" queue (Spotify API, optional).
//
// Windows only gives the current track: the next ones come from the Spotify
// API, once the account is connected in the settings. Asked when the
// track changes and every 20 s during playback.

const S = require('../app/state');
const { SpotifyApi } = require('./spotify-api');
const diagnostic = require('../app/diagnostic');
const { exeForApp } = require('../audio/app-ids');
const { fetchImageDataUrl } = require('./text-norm');

// Spotify covers: i.scdn.co and other CDN hosts, nothing else.
const IMAGE_HOSTS = /^([a-z0-9-]+\.)*(scdn\.co|spotifycdn\.com)$/i;

const imageCache = new Map(); // Spotify URL -> data URL (the page only accepts data:)
async function imageData(url) {
  if (!url) return null;
  if (imageCache.has(url)) return imageCache.get(url);
  try {
    const data = await fetchImageDataUrl(url, IMAGE_HOSTS, 6000);
    if (imageCache.size > 100) imageCache.delete(imageCache.keys().next().value);
    imageCache.set(url, data);
    return data;
  } catch (e) {
    diagnostic.note('spotify', `queue image: ${e.message}`);
    return null;
  }
}

// Pause shared by both requests (player, queue) after a Spotify 429.
let pauseUntil = 0;
const notePause = (e) => {
  if (e && e.retryAfter) pauseUntil = Date.now() + e.retryAfter * 1000;
};

// After repeated errors, the player state is read again less often
// (2 s, 4 s, 8 s... up to 60 s) instead of hammering the API.
let playerFailures = 0;
let playerRetryAt = 0;
let playerInflight = null;

// Shuffle / repeat state read from the API (the Windows one is not reliable).
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
      diagnostic.note('spotify', `player state: ${e.message}`);
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

// The shuffle / repeat commands are handled one after the other: two
// quick clicks = two toggles, each computed on the up-to-date state.
let commandChain = Promise.resolve();

async function spotifyCommand(cmd) {
  const spotify = S.spotify;
  if (!spotify || !spotify.canControl()) {
    diagnostic.note('spotify', `${cmd} ignored: Spotify account not connected`);
    return;
  }
  try {
    const cur = S.playerState || (await spotify.player()) || { shuffle: false, repeat: 'None' };
    if (cmd === 'shuffle' ? cur.shuffleAllowed === false : cur.repeatAllowed === false) {
      diagnostic.note('spotify', `${cmd} → forbidden by Spotify for now`);
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
      `${cmd} → accepted (shuffle ${S.playerState.shuffle ? 'yes' : 'no'}, repeat ${S.playerState.repeat})`,
    );
    S.actions.rebroadcast();
    setTimeout(refreshPlayer, 1500);
  } catch (e) {
    diagnostic.note('spotify', `${cmd} → ${e.message}`);
    notePause(e);
    refreshPlayer();
  }
}

// Spotify sometimes ignores the SMTC toggle ("accepted" but stays paused):
// we send "play" or "pause" explicitly, depending on the known state.
function explicitPlayPause(cmd) {
  if (cmd !== 'playpause') return cmd;
  return S.lastMedia && S.lastMedia.status === 'Playing' ? 'pause' : 'play';
}

// After an accepted "play", if Spotify is still paused, we go through
// its API (on the computer if no device is active).
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
        diagnostic.note('spotify', `play → still paused after Windows, resumed by the Spotify API`);
      } catch (e) {
        diagnostic.note('spotify', `play (API) → ${e.message}`);
        notePause(e);
      }
    })
    .catch(() => {});
}

// Every playback command goes through here (buttons, full screen, icon).
// Play, previous, next: Windows. Shuffle, repeat: Spotify API,
// since the Spotify app ignores these two commands coming from Windows.
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
  // Nothing to send if the queue has not changed (the images are heavy).
  if (JSON.stringify(q) === JSON.stringify(S.lastQueue)) return;
  S.lastQueue = q;
  S.send([S.widget, S.editorWin], 'queue', q);
}

// Identifies the current track: a result obtained for another one is stale.
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
    dirty = true; // a request arrived during the query: start again at the end
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
    // null: token missing or refresh failed, not an empty queue. We
    // keep the queue shown and the error (erasing it would hide the problem).
    if (!items) return;
    const withImages = await Promise.all(items.map(async (it) => ({ ...it, image: await imageData(it.image) })));
    // The track changed, or the session closed, during the query: stale result.
    if (S.spotify === spotify && spotify.status().connected && currentTrack() === track) {
      sendQueue({ items: withImages, connected: true });
      if (spotify.status().error) spotify.clearError();
    } else {
      dirty = true;
    }
  } catch (e) {
    notePause(e);
    diagnostic.note('spotify', `queue: ${e.message}`);
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
    S.actions.rebroadcast(); // shuffle / repeat buttons shown or not
  };
  spotify.on('status', pushStatus);
  spotify.on('connected', () => {
    pushStatus(spotify.status());
    refreshQueue();
  });
  // Only if a page shows the queue (scene awake or editor): scene
  // hidden, asleep or covered by a game, nothing to read. On waking up, main.js
  // (applyRest) reads the queue again right away.
  setInterval(() => {
    const shown = S.sceneActive() || S.alive(S.editorWin);
    if (shown && S.lastMedia.active && S.lastMedia.status === 'Playing') refreshQueue();
  }, 20000);
  spotify.ready.then(() => {
    pushStatus(spotify.status());
    refreshQueue();
  });
}

// Reset of the internal state (tests).
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
