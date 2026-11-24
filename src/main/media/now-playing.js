// Morceau en cours : source Windows, pochette officielle (Deezer), paroles
// (LRCLIB) et décalage des paroles par morceau.

const S = require('../app/state');
const { WindowsMediaSource } = require('./media');
const { lookupCover } = require('./cover-lookup');
const { lookupLyrics } = require('./lyrics');
const diagnostic = require('../app/diagnostic');
const { exeForApp } = require('../audio/app-ids');

// ---------- Décalage des paroles (par morceau) ----------
// Pour les titres où LRCLIB a les paroles d'une autre version. Positif : les
// paroles arrivent plus tôt.

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

// Paroles : nouveaux essais après une erreur réseau (10 s, puis 20 s), et durée
// du morceau jugée différente au-delà de 2 s (la durée sert à choisir la bonne version).
const LYRICS_RETRY_MS = [10000, 20000];
const DURATION_GAP_S = 2;

// ---------- Source ----------

function startMedia() {
  const media = new WindowsMediaSource({ prefer: S.settings.get('preferApp') });
  S.media = media;
  // canShuffle : boutons aléatoire / répétition affichés (compte Spotify
  // connecté et autorisé) ; leur état vient alors de l'API Spotify.
  const broadcast = (m) => {
    const ps = S.playerState;
    const canShuffle = !!(S.spotify && S.spotify.canControl());
    // volume : celui du lecteur dans le mélangeur de Windows (null = inconnu).
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
    // La fenêtre des boutons n'utilise pas la pochette (100 à 250 Ko par message).
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
  // L'image donnée par Windows est remplacée par la pochette officielle (Deezer)
  // dès qu'elle est trouvée ; sinon on garde celle de Windows.
  let trackKey = '';
  let officialCover = null;
  let lastStatus = '';
  let lastTrayKey = null;
  let lyricsSeq = 0; // seule la dernière recherche de paroles est prise en compte
  let lyricsDuration = 0; // durée utilisée par la recherche en cours ou terminée
  let lastSeenDuration = 0; // durée du dernier message (celle du morceau précédent à un changement)
  let lyricsRetry = null;

  // Cherche les paroles de m (key = morceau auquel elles sont destinées).
  // Le titre arrive souvent avant la timeline : la durée reçue peut être celle
  // du morceau précédent. Elle est alors suspecte (0 ou identique à la
  // précédente) : un résultat vide n'est pas mis en cache, et la recherche est
  // relancée si la durée change ensuite (voir plus bas).
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
        // error : la recherche a échoué (réseau), ce n'est pas « pas de paroles ».
        if (l && l.error) return failed();
        sendLyrics({
          title: m.title,
          artist: m.artist,
          lines: l ? l.lines : [],
          instrumental: !!(l && l.instrumental),
        });
      })
      .catch((e) => {
        diagnostic.note('paroles', e.message);
        if (current()) failed();
      });
  };
  media.on('media', (m) => {
    // Lecture / pause : ce que Spotify autorise (aléatoire, répétition) peut changer.
    if (m.status !== lastStatus) {
      lastStatus = m.status;
      setTimeout(S.actions.refreshPlayer, 1000);
    }
    const key = m.active ? `${m.app}|${m.title}|${m.artist}|${m.album}` : '';
    if (key !== trackKey) {
      trackKey = key;
      officialCover = null;
      // File d'attente : Spotify met un instant à la décaler après un changement.
      if (key) setTimeout(S.actions.refreshQueue, 1500);
      // Paroles : vides tant qu'on cherche, puis celles de LRCLIB si elles existent.
      sendLyrics({ title: m.title || '', artist: m.artist || '', lines: [], pending: !!key });
      if (key) {
        loadLyrics(m, key, lastSeenDuration);
        lookupCover(m)
          .then((cover) => {
            if (!cover || trackKey !== key) return;
            officialCover = cover;
            broadcast({ ...S.lastMedia, cover });
          })
          .catch((e) => diagnostic.note('pochette', e.message));
      }
    }
    // Même morceau, mais la durée vient de changer (la timeline arrive après le titre).
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
    // Le menu de l'icône n'affiche que titre, artiste et état de lecture.
    const trayKey = `${m.active ? m.title : ''}|${m.active ? m.artist : ''}|${m.status}|${m.active}`;
    if (trayKey !== lastTrayKey) {
      lastTrayKey = trayKey;
      S.actions.buildTray();
    }
  });
  // Volume du lecteur : on suit l'application qui joue.
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
    console.error('Média :', e.message);
    diagnostic.note('média', e.message);
  });
  media.on('log', (t) => diagnostic.note('assistant', t));
  media.on('command-result', (r) =>
    diagnostic.note(
      'windows',
      `${r.cmd} → ${r.ok ? 'accepté' : 'refusé'}${r.app ? ` par ${r.app}` : ''}${r.reason ? ` (${r.reason})` : ''}`,
    ),
  );
  media.start();
}

module.exports = { startMedia, lyricsOffsetFor, nudgeLyrics };
