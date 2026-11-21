// Morceau en cours : source Windows, pochette officielle (Deezer), paroles
// (LRCLIB) et décalage des paroles par morceau.

const S = require('./state');
const { WindowsMediaSource } = require('./media');
const { lookupCover } = require('./cover-lookup');
const { lookupLyrics } = require('./lyrics');
const diagnostic = require('./diagnostic');

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
    S.send([S.widget, S.fullscreen], 'lyrics', S.lastLyrics);
  }
}

// ---------- Source ----------

function startMedia() {
  const media = new WindowsMediaSource({ prefer: S.settings.get('preferApp') });
  S.media = media;
  const broadcast = (m) => {
    S.lastMedia = m;
    S.send([S.widget, S.fullscreen, S.controlsWin], 'media', m);
  };
  const sendLyrics = (l) => {
    S.lastLyrics = { ...l, offset: lyricsOffsetFor(l) };
    S.send([S.widget, S.fullscreen], 'lyrics', S.lastLyrics);
  };
  // L'image donnée par Windows est remplacée par la pochette officielle (Deezer)
  // dès qu'elle est trouvée ; sinon on garde celle de Windows.
  let trackKey = '';
  let officialCover = null;
  media.on('media', (m) => {
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
    broadcast(officialCover ? { ...m, cover: officialCover } : m);
    S.actions.buildTray();
  });
  media.on('error', (e) => { console.error('Média :', e.message); diagnostic.note('média', e.message); });
  media.on('log', (t) => diagnostic.note('powershell', t));
  media.on('command-result', (r) => diagnostic.note('windows',
    `${r.cmd} → ${r.ok ? 'accepté' : 'refusé'}${r.app ? ` par ${r.app}` : ''}${r.reason ? ` (${r.reason})` : ''}`));
  media.start();
}

module.exports = { startMedia, lyricsOffsetFor, nudgeLyrics };
