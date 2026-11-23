// Morceau en cours : source Windows, pochette officielle (Deezer), paroles
// (LRCLIB) et décalage des paroles par morceau.

const S = require('../app/state');
const { WindowsMediaSource } = require('./media');
const { lookupCover } = require('./cover-lookup');
const { lookupLyrics } = require('./lyrics');
const diagnostic = require('../app/diagnostic');
const { exeForApp } = require('../audio/app-audio');

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
  if (v) all[key] = v; else delete all[key];
  S.actions.updateSettings({ lyricsOffsets: all });
  if (S.lastLyrics) {
    S.lastLyrics = { ...S.lastLyrics, offset: v };
    S.send([S.widget, S.fullscreen, S.editorWin], 'lyrics', S.lastLyrics);
  }
}

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
      ...m, canShuffle, volume: S.appVolume,
      ...(canShuffle && ps ? {
        shuffle: ps.shuffle, repeat: ps.repeat,
        shuffleAllowed: ps.shuffleAllowed, repeatAllowed: ps.repeatAllowed,
      } : { shuffleAllowed: true, repeatAllowed: true }),
    };
    S.send([S.widget, S.fullscreen, S.controlsWin, S.editorWin], 'media', S.lastMedia);
    S.actions.audioOnMedia(S.lastMedia);
  };
  S.actions.rebroadcast = () => { broadcast(S.lastMedia); S.actions.buildTray(); };
  const sendLyrics = (l) => {
    S.lastLyrics = { ...l, offset: lyricsOffsetFor(l) };
    S.send([S.widget, S.fullscreen, S.editorWin], 'lyrics', S.lastLyrics);
  };
  // L'image donnée par Windows est remplacée par la pochette officielle (Deezer)
  // dès qu'elle est trouvée ; sinon on garde celle de Windows.
  let trackKey = '';
  let officialCover = null;
  let lastStatus = '';
  media.on('media', (m) => {
    // Lecture / pause : ce que Spotify autorise (aléatoire, répétition) peut changer.
    if (m.status !== lastStatus) { lastStatus = m.status; setTimeout(S.actions.refreshPlayer, 1000); }
    const key = m.active ? `${m.app}|${m.title}|${m.artist}|${m.album}` : '';
    if (key !== trackKey) {
      trackKey = key;
      officialCover = null;
      // File d'attente : Spotify met un instant à la décaler après un changement.
      if (key) setTimeout(S.actions.refreshQueue, 1500);
      // Paroles : vides tant qu'on cherche, puis celles de LRCLIB si elles existent.
      sendLyrics({ title: m.title || '', artist: m.artist || '', lines: [], pending: !!key });
      if (key) {
        lookupLyrics(m).then((l) => {
          if (trackKey !== key) return;
          sendLyrics({ title: m.title, artist: m.artist, lines: l ? l.lines : [], instrumental: !!(l && l.instrumental) });
        });
        lookupCover(m).then((cover) => {
          if (!cover || trackKey !== key) return;
          officialCover = cover;
          broadcast({ ...S.lastMedia, cover });
        });
      }
    }
    const exe = m.active ? exeForApp(m.app) : null;
    if (exe !== media.volumeExe) { S.appVolume = null; media.setVolumeTarget(exe); }
    broadcast(officialCover ? { ...m, cover: officialCover } : m);
    S.actions.buildTray();
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
  media.on('error', (e) => { console.error('Média :', e.message); diagnostic.note('média', e.message); });
  media.on('log', (t) => diagnostic.note('assistant', t));
  media.on('command-result', (r) => diagnostic.note('windows',
    `${r.cmd} → ${r.ok ? 'accepté' : 'refusé'}${r.app ? ` par ${r.app}` : ''}${r.reason ? ` (${r.reason})` : ''}`));
  media.start();
}

module.exports = { startMedia, lyricsOffsetFor, nudgeLyrics };
