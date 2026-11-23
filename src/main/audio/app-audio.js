// Son analysé : seulement le lecteur suivi, ou tout le PC.
//
// Par défaut, Sillon n'écoute que l'application qui joue la musique (Spotify,
// le navigateur pour YouTube…) grâce à la capture d'un seul processus de
// Windows (assistant natif, voir helper.js et native/sillon-helper). Le chat vocal (Discord, TeamSpeak), les
// notifications et les jeux ne font donc plus bouger le visualiseur.
// Si Windows ne le permet pas, ou si l'application est inconnue, on revient à
// la capture de tout le son du PC (getDisplayMedia + loopback).
//
// Économie au repos : l'assistant ne tourne que si une fenêtre a besoin du son
// (visible, éveillée, sans jeu en plein écran) ET que le lecteur ciblé est
// annoncé actif par Windows. Le son part vers les pages par paquets d'environ
// 30 ms (canal « audio-pcm »), et chaque page est prévenue du mode par
// « audio:start » ('system' ou 'app').

const { spawn } = require('child_process');
const S = require('../app/state');
const diagnostic = require('../app/diagnostic');
const { helperExe } = require('./helper');
const { exeForApp } = require('./app-ids');
const { retryDelay, createPcmAssembler, appendCapped } = require('./audio-utils');

const FLUSH_MS = 30; // regroupement des envois de son (le worklet tolère 80 ms)
const MAX_STDERR = 4096; // on ne garde que la fin des messages d'erreur de l'assistant
const MAX_FAILURES = 5; // échecs de suite avant de se rabattre sur tout le son du PC

// État exposé au diagnostic.
const state = { mode: 'system', exe: null, reason: '', unsupported: false, failures: 0 };
let proc = null;
let restartTimer = null;
let fallback = false; // trop d'échecs : tout le son du PC jusqu'au prochain changement de lecteur
const listeners = new Set(); // fenêtres qui reçoivent le son

// ---------- Fenêtres concernées ----------

function wanted() {
  return S.settings.get('audioSource') !== 'system';
}

// Une fenêtre a-t-elle besoin du son ? La scène : visible, éveillée, sans jeu.
function windowActive(win) {
  if (!S.alive(win)) return false;
  if (win === S.widget) return S.sceneActive();
  return !win.isMinimized();
}

function activeListeners() {
  return [...listeners].filter(windowActive);
}

// ---------- Envoi du son, par paquets alignés ----------

const assembler = createPcmAssembler();
let pending = [];
let flushTimer = null;

function flushPcm() {
  flushTimer = null;
  if (!pending.length) return;
  const chunk = Buffer.concat(pending);
  pending = [];
  S.send(activeListeners(), 'audio-pcm', chunk);
}

function onPcm(data) {
  if (state.failures) state.failures = 0; // l'assistant fonctionne
  const aligned = assembler.push(data); // jamais d'échantillon 16 bits coupé en deux
  if (!aligned.length) return;
  pending.push(aligned);
  if (!flushTimer) flushTimer = setTimeout(flushPcm, FLUSH_MS);
}

function resetPcm() {
  clearTimeout(flushTimer);
  flushTimer = null;
  pending = [];
  assembler.reset();
}

// ---------- Assistant de capture ----------

function stopHelper() {
  clearTimeout(restartTimer);
  restartTimer = null;
  if (proc) {
    proc.removeAllListeners('exit');
    proc.kill();
    proc = null;
  }
  resetPcm();
}

// Le lecteur ciblé est-il annoncé actif par Windows ?
function targetActive(exe) {
  const m = S.lastMedia;
  return !!(m && m.active && exeForApp(m.app) === exe);
}

function startHelper(exe) {
  const changed = state.exe !== exe;
  stopHelper();
  if (changed) state.failures = 0;
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
  p.stdout.on('data', onPcm);
  p.stderr.on('data', (d) => {
    err = appendCapped(err, d.toString(), MAX_STDERR);
  });
  p.on('exit', (code) => {
    if (proc !== p) return;
    proc = null;
    resetPcm();
    const msg = (/ERR \d+ (.*)/.exec(err) || [])[1] || `arrêt (code ${code})`;
    if (code === 2) {
      // Windows ne sait pas faire : on écoute tout le PC.
      state.unsupported = true;
      diagnostic.note('son', `capture par application impossible (${msg}) : tout le son du PC`);
      useSystem(`capture par application impossible : ${msg}`);
      return;
    }
    state.reason = msg;
    if (code === 7) {
      // Périphérique audio perdu (sortie changée) : on relance vite, sans
      // compter un échec ni abandonner la capture par application.
      diagnostic.note('son', `capture interrompue (${msg}) : nouvel essai`);
      if (targetActive(exe) && activeListeners().length) {
        restartTimer = setTimeout(() => {
          restartTimer = null;
          refresh();
        }, 1000);
      }
      return;
    }
    // 3 : application fermée, 4 : pas encore lancée : cas normaux, qui ne
    // comptent pas comme des échecs. Le reste est noté et compté.
    const normal = code === 3 || code === 4;
    if (!normal) {
      diagnostic.note('son', `assistant de capture arrêté (code ${code}) : ${msg}`);
      state.failures += 1;
    }
    if (state.failures >= MAX_FAILURES) {
      fallback = true;
      diagnostic.note('son', `${state.failures} échecs de suite (${msg}) : tout le son du PC`);
      useSystem(`capture par application en échec : ${msg}`);
      return;
    }
    // On ne relance que si le lecteur est toujours annoncé actif, avec un
    // délai croissant. Sinon on attend qu'il réapparaisse (voir onMedia).
    if (targetActive(exe) && activeListeners().length) {
      restartTimer = setTimeout(() => {
        restartTimer = null;
        refresh();
      }, retryDelay(state.failures));
    }
  });
}

// Bascule toutes les fenêtres sur le son de tout le PC.
function useSystem(reason) {
  stopHelper();
  state.mode = 'system';
  state.reason = reason;
  for (const w of listeners) startIn(w);
}

// Lance ou arrête l'assistant selon le besoin (mode « application »).
function ensureHelper(exe) {
  if (!activeListeners().length) {
    stopHelper(); // personne n'écoute : on ne capture rien
    return;
  }
  if (!targetActive(exe)) {
    stopHelper(); // lecteur pas (encore) annoncé : on attend le prochain message média
    state.reason = 'lecteur pas encore actif';
    return;
  }
  if (restartTimer && state.exe === exe) return; // délai avant nouvel essai en cours
  if (!proc || state.exe !== exe) startHelper(exe);
}

// Choisit la source selon le réglage et la session média en cours.
function refresh() {
  const exe =
    exeForApp(S.lastMedia && S.lastMedia.app) || (S.settings.get('preferApp') === 'spotify' ? 'Spotify.exe' : null);
  if (!wanted() || state.unsupported || fallback) {
    if (state.mode !== 'system') {
      useSystem(wanted() ? state.reason : 'réglage « tout le son du PC »');
    } else if (proc) {
      stopHelper();
    }
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
  if (switching) for (const w of listeners) startIn(w);
  ensureHelper(exe);
}

// Prévient une page du mode à démarrer (canal « audio:start »).
function startIn(win) {
  if (!S.alive(win)) return;
  const mode = state.mode === 'app' ? 'app' : 'system';
  // La capture « tout le son du PC » (getDisplayMedia) exige un geste de
  // l'utilisateur : un script marqué comme tel l'autorise quelques secondes.
  win.webContents
    .executeJavaScript('0', true)
    .catch(() => {})
    .finally(() => S.send([win], 'audio:start', mode));
}

// ---------- Fenêtres ----------

const watched = new WeakSet();
function startAudio(win) {
  listeners.add(win);
  if (!watched.has(win)) {
    watched.add(win);
    win.once('closed', () => {
      listeners.delete(win);
      if (!listeners.size) stopHelper();
      else onActivityChanged();
    });
    // Réduite / restaurée : elle cesse ou recommence d'avoir besoin du son.
    for (const ev of ['minimize', 'restore', 'show', 'hide']) win.on(ev, onActivityChanged);
  }
  // Choisir la source ; si elle change, refresh() démarre déjà toutes les
  // fenêtres, celle-ci comprise.
  const before = state.mode;
  refresh();
  if (state.mode === before) startIn(win);
}

// Une fenêtre est devenue active ou inactive (scène masquée, endormie, jeu…).
function onActivityChanged() {
  if (!listeners.size || !S.settings) return;
  refresh();
}

// Le lecteur a changé (Spotify -> navigateur…), ou démarre / s'arrête.
let lastKey = null;
function onMedia(m) {
  if (!listeners.size || !m) return;
  const key = `${!!m.active}|${m.app || ''}`;
  if (key === lastKey) return;
  lastKey = key;
  // Nouveau lecteur ou lecteur revenu : on repart sans attendre les délais.
  state.failures = 0;
  fallback = false;
  clearTimeout(restartTimer);
  restartTimer = null;
  refresh();
}
function onSettingChanged() {
  state.unsupported = false;
  fallback = false;
  state.failures = 0;
  if (listeners.size) refresh();
}

// Arrêt de l'application : on ne laisse pas l'assistant derrière nous.
function stop() {
  stopHelper();
}

function status() {
  return { ...state, running: !!proc, listeners: listeners.size, active: activeListeners().length };
}

module.exports = { startAudio, onMedia, onSettingChanged, onActivityChanged, status, stop, exeForApp };
