// Son analysé : seulement le lecteur suivi, ou tout le PC.
//
// Par défaut, Sillon n'écoute que l'application qui joue la musique (Spotify,
// le navigateur pour YouTube…) grâce à la capture d'un seul processus de
// Windows (assistant natif, voir helper.js et native/sillon-helper). Le chat vocal (Discord, TeamSpeak), les
// notifications et les jeux ne font donc plus bouger le visualiseur.
// Si Windows ne le permet pas, ou si l'application est inconnue, on revient à
// la capture de tout le son du PC (getDisplayMedia + loopback).

const { spawn } = require('child_process');
const S = require('../app/state');
const diagnostic = require('../app/diagnostic');
const { helperExe } = require('./helper');

// Session média de Windows (AppUserModelId) -> programme à écouter.
const KNOWN = [
  [/spotify/i, 'Spotify.exe'],
  [/msedge/i, 'msedge.exe'],
  [/chrome/i, 'chrome.exe'],
  [/firefox|308046B0AF4A39CB/i, 'firefox.exe'],
  [/brave/i, 'brave.exe'],
  [/opera/i, 'opera.exe'],
  [/vivaldi/i, 'vivaldi.exe'],
  [/vlc/i, 'vlc.exe'],
  [/deezer/i, 'Deezer.exe'],
  [/foobar/i, 'foobar2000.exe'],
  [/aimp/i, 'AIMP.exe'],
];
function exeForApp(appId) {
  if (!appId) return null;
  for (const [re, exe] of KNOWN) if (re.test(appId)) return exe;
  const m = /([\w.\- ]+\.exe)$/i.exec(appId); // certaines applis donnent leur .exe
  return m ? m[1] : null;
}

// État exposé au diagnostic.
const state = { mode: 'system', exe: null, reason: '', unsupported: false };
let proc = null;
let restartTimer = null;
const listeners = new Set(); // fenêtres qui reçoivent le son

function wanted() { return S.settings.get('audioSource') !== 'system'; }

function send(chunk) {
  for (const w of listeners) {
    if (w.isDestroyed()) { listeners.delete(w); continue; }
    w.webContents.send('audio-pcm', chunk);
  }
}

function stopHelper() {
  clearTimeout(restartTimer);
  if (proc) { proc.removeAllListeners('exit'); proc.kill(); proc = null; }
}

function startHelper(exe) {
  stopHelper();
  state.exe = exe;
  const p = spawn(helperExe(), ['capture', exe], { windowsHide: true });
  proc = p;
  let err = '';
  // Assistant absent ou bloqué (antivirus…) : on écoute tout le PC.
  p.on('error', (e) => {
    if (proc !== p) return;
    proc = null;
    state.unsupported = true;
    diagnostic.note('son', `assistant introuvable (${e.message}) : tout le son du PC`);
    useSystem(`assistant introuvable : ${e.message}`);
  });
  p.stdout.on('data', send);
  p.stderr.on('data', (d) => { err += d.toString(); });
  p.on('exit', (code) => {
    if (proc !== p) return;
    proc = null;
    const msg = (/ERR \d+ (.*)/.exec(err) || [])[1] || `arrêt (code ${code})`;
    if (code === 2) {
      // Windows ne sait pas faire : on écoute tout le PC.
      state.unsupported = true;
      diagnostic.note('son', `capture par application impossible (${msg}) : tout le son du PC`);
      useSystem(`capture par application impossible : ${msg}`);
    } else {
      // Application fermée ou pas encore lancée : on réessaie plus tard.
      state.reason = msg;
      restartTimer = setTimeout(refresh, 3000);
    }
  });
}

// Bascule toutes les fenêtres sur le son de tout le PC.
function useSystem(reason) {
  stopHelper();
  state.mode = 'system';
  state.reason = reason;
  for (const w of listeners) if (!w.isDestroyed()) startIn(w);
}

// Choisit la source selon le réglage et la session média en cours.
function refresh() {
  const exe = exeForApp(S.lastMedia && S.lastMedia.app) || (S.settings.get('preferApp') === 'spotify' ? 'Spotify.exe' : null);
  if (!wanted() || state.unsupported) {
    if (state.mode !== 'system') useSystem(wanted() ? state.reason : 'réglage « tout le son du PC »');
    return;
  }
  if (!exe) {
    if (state.mode !== 'system') useSystem('lecteur inconnu');
    else state.reason = 'lecteur inconnu';
    return;
  }
  const switching = state.mode !== 'app';
  state.mode = 'app';
  state.reason = '';
  if (switching) for (const w of listeners) if (!w.isDestroyed()) startIn(w);
  if (!proc || state.exe !== exe) startHelper(exe);
}

// Démarre l'analyse du son dans une fenêtre (simule un geste utilisateur).
function startIn(win) {
  const js = state.mode === 'app' ? 'window.sillon && window.sillon.startAppAudio()' : 'window.sillon && window.sillon.startAudio()';
  win.webContents.executeJavaScript(js, true).catch((e) => console.error('Audio :', e.message));
}

const watched = new WeakSet();
function startAudio(win) {
  listeners.add(win);
  if (!watched.has(win)) {
    watched.add(win);
    win.once('closed', () => {
      listeners.delete(win);
      if (!listeners.size) stopHelper();
    });
  }
  // Choisir la source ; si elle change, refresh() démarre déjà toutes les
  // fenêtres, celle-ci comprise.
  const before = state.mode;
  refresh();
  if (state.mode === before) startIn(win);
}

// Le lecteur a changé (Spotify -> navigateur…) ou le réglage a changé.
let lastApp = null;
function onMedia(m) {
  if (!listeners.size || !m || m.app === lastApp || !m.app) return;
  lastApp = m.app;
  refresh();
}
function onSettingChanged() {
  state.unsupported = false;
  if (listeners.size) refresh();
}

function status() {
  return { ...state, running: !!proc, listeners: listeners.size };
}

module.exports = { startAudio, onMedia, onSettingChanged, status, exeForApp };
