// Current track: Windows source, official cover (Deezer), lyrics
// (LRCLIB) and lyrics offset per track.

const S = require('../app/state');
const { WindowsMediaSource } = require('./media');
const { lookupCover } = require('./cover-lookup');
const { lookupLyrics } = require('./lyrics');
const diagnostic = require('../app/diagnostic');
const { exeForApp } = require('../audio/app-ids');

// ---------- Lyrics offset (per track) ----------
// For the titles where LRCLIB has the lyrics of another version. Positive: the
// lyrics come earlier.

const offsetKey = (m) => `${(m.artist || '').toLowerCase()}|${(m.title || '').toLowerCase()}`;

function lyricsOffsetFor(m) {
  return (m && m.title && (S.settings.get('lyricsOffsets') || {})[offsetKey(m)]) || 0;
}

function nudgeLyrics(delta) {
  const m = S.lastMedia;
  if (!m.active || !m.title) return;
  const all = { ...(S.settings.get('lyricsOffsets') || {}) };
  const key = offsetKey(m);
  const v = delta === null ? 0 : Math.round(((all[key] || 0) + delta) * 100) / 100;
  if (v) all[key] = v;
  else delete all[key];
  S.actions.updateSettings({ lyricsOffsets: all });
  if (S.lastLyrics) {
    S.lastLyrics = { ...S.lastLyrics, offset: v };
    S.send([S.widget, S.fullscreen, S.editorWin], 'lyrics', S.lastLyrics);
  }
}

// Lyrics: new attempts after a network error (10 s, then 20 s), and track
// duration considered different beyond 2 s (the duration is used to choose the right version).
const LYRICS_RETRY_MS = [10000, 20000];
const DURATION_GAP_S = 2;

// ---------- Source ----------

function startMedia() {
  const media = new WindowsMediaSource({ prefer: S.settings.get('preferApp') });
  S.media = media;
  // canShuffle: shuffle / repeat buttons shown (Spotify account
  // connected and authorized); their state then comes from the Spotify API.
  const broadcast = (m) => {
    const ps = S.playerState;
    const canShuffle = !!(S.spotify && S.spotify.canControl());
    // volume: that of the player in the Windows mixer (null = unknown).
    S.lastMedia = {
      ...m,
      canShuffle,
      volume: S.appVolume,
      ...(canShuffle && ps
        ? {
            shuffle: ps.shuffle,
            repeat: ps.repeat,
            shuffleAllowed: ps.shuffleAllowed,
            repeatAllowed: ps.repeatAllowed,
          }
        : { shuffleAllowed: true, repeatAllowed: true }),
    };
    S.sendMedia([S.widget, S.fullscreen, S.editorWin], S.lastMedia);
    // The buttons window does not use the cover (100 to 250 KB per message).
    if (S.alive(S.controlsWin)) {
      const light = { ...S.lastMedia };
      delete light.cover;
      S.send([S.controlsWin], 'media', light);
    }
    S.actions.audioOnMedia(S.lastMedia);
  };
  S.actions.rebroadcast = () => {
    broadcast(S.lastMedia);
    S.actions.buildTray();
  };
  const sendLyrics = (l) => {
    S.lastLyrics = { ...l, offset: lyricsOffsetFor(l) };
    S.send([S.widget, S.fullscreen, S.editorWin], 'lyrics', S.lastLyrics);
  };
  // The picture given by Windows is replaced with the official cover (Deezer)
  // as soon as it is found; otherwise the Windows one is kept.
  let trackKey = '';
  let officialCover = null;
  let lastStatus = '';
  let lastTrayKey = null;
  let lyricsSeq = 0; // only the last lyrics search counts
  let lyricsDuration = 0; // duration used by the current or finished search
  let lastSeenDuration = 0; // duration of the last message (that of the previous track on a change)
  let lyricsRetry = null;

  // Looks for the lyrics of m (key = track they are meant for).
  // The title often arrives before the timeline: the received duration may be that
  // of the previous track. It is then suspicious (0 or identical to the
  // previous one): an empty result is not cached, and the search is
  // started again if the duration changes later (see below).
  const loadLyrics = (m, key, previousDuration, attempt = 0) => {
    const seq = ++lyricsSeq;
    clearTimeout(lyricsRetry);
    lyricsRetry = null;
    lyricsDuration = m.duration || 0;
    const volatile = !m.duration || m.duration === previousDuration;
    const current = () => seq === lyricsSeq && trackKey === key;
    const failed = () => {
      sendLyrics({ title: m.title, artist: m.artist, lines: [], error: true });
      if (attempt >= LYRICS_RETRY_MS.length) return;
      lyricsRetry = setTimeout(() => {
        lyricsRetry = null;
        if (current()) loadLyrics({ ...m, duration: S.lastMedia.duration }, key, previousDuration, attempt + 1);
      }, LYRICS_RETRY_MS[attempt]);
    };
    lookupLyrics(m, { volatile })
      .then((l) => {
        if (!current()) return;
        // error: the search failed (network), it is not "no lyrics".
        if (l && l.error) return failed();
        sendLyrics({
          title: m.title,
          artist: m.artist,
          lines: l ? l.lines : [],
          instrumental: !!(l && l.instrumental),
        });
      })
      .catch((e) => {
        diagnostic.note('lyrics', e.message);
        if (current()) failed();
      });
  };
  media.on('media', (m) => {
    // Play / pause: what Spotify allows (shuffle, repeat) may change.
    if (m.status !== lastStatus) {
      lastStatus = m.status;
      setTimeout(S.actions.refreshPlayer, 1000);
    }
    const key = m.active ? `${m.app}|${m.title}|${m.artist}|${m.album}` : '';
    if (key !== trackKey) {
      trackKey = key;
      officialCover = null;
      // Queue: Spotify takes a moment to shift it after a change.
      if (key) setTimeout(S.actions.refreshQueue, 1500);
      // Lyrics: empty while searching, then those of LRCLIB if they exist.
      sendLyrics({ title: m.title || '', artist: m.artist || '', lines: [], pending: !!key });
      if (key) {
        loadLyrics(m, key, lastSeenDuration);
        lookupCover(m)
          .then((cover) => {
            if (!cover || trackKey !== key) return;
            officialCover = cover;
            broadcast({ ...S.lastMedia, cover });
          })
          .catch((e) => diagnostic.note('cover', e.message));
      }
    }
    // Same track, but the duration has just changed (the timeline arrives after the title).
    else if (key && m.duration > 0 && Math.abs(m.duration - lyricsDuration) > DURATION_GAP_S) {
      loadLyrics(m, key, lastSeenDuration);
    }
    lastSeenDuration = m.duration || 0;
    const exe = m.active ? exeForApp(m.app) : null;
    if (exe !== media.volumeExe) {
      S.appVolume = null;
      media.setVolumeTarget(exe);
    }
    broadcast(officialCover ? { ...m, cover: officialCover } : m);
    // The icon menu only shows the title, the artist and the playback state.
    const trayKey = `${m.active ? m.title : ''}|${m.active ? m.artist : ''}|${m.status}|${m.active}`;
    if (trayKey !== lastTrayKey) {
      lastTrayKey = trayKey;
      S.actions.buildTray();
    }
  });
  // Player volume: follow the application that is playing.
  media.on('volume', (v) => {
    const vol = v.volume >= 0 ? v.volume : null;
    if (vol === S.appVolume) return;
    S.appVolume = vol;
    broadcast(S.lastMedia);
  });
  S.actions.setVolume = (percent) => {
    media.setVolume(percent);
    S.appVolume = Math.round(percent);
  };
  media.on('error', (e) => {
    console.error('Media:', e.message);
    diagnostic.note('media', e.message);
  });
  media.on('log', (t) => diagnostic.note('helper', t));
  media.on('command-result', (r) =>
    diagnostic.note(
      'windows',
      `${r.cmd} → ${r.ok ? 'accepted' : 'refused'}${r.app ? ` by ${r.app}` : ''}${r.reason ? ` (${r.reason})` : ''}`,
    ),
  );
  media.start();
}

module.exports = { startMedia, lyricsOffsetFor, nudgeLyrics };
