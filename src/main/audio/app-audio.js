// Analyzed sound: only the followed player, or the whole PC.
//
// By default, Sillon only listens to the application that plays the music (Spotify,
// the browser for YouTube…) thanks to Windows' capture of a single
// process (native helper, see helper.js and native/sillon-helper). Voice chat (Discord, TeamSpeak),
// notifications and games therefore no longer move the visualizer.
// If Windows does not allow it, or if the application is unknown, we fall back to
// capturing all the PC's sound (getDisplayMedia + loopback).
//
// Saving at rest: the helper only runs if a window needs the sound
// (visible, awake, no full-screen game) AND the targeted player is
// announced active by Windows. The sound goes to the pages in packets of about
// 30 ms ("audio-pcm" channel), and each page is told the mode with
// "audio:start" ('system' or 'app').

const { spawn } = require('child_process');
const S = require('../app/state');
const diagnostic = require('../app/diagnostic');
const { helperExe } = require('./helper');
const { exeForApp } = require('./app-ids');
const { retryDelay, createPcmAssembler, appendCapped } = require('./audio-utils');
const { EXIT } = require('./helper-protocol');

const FLUSH_MS = 30; // grouping of the sound sends (the worklet tolerates 80 ms)
const MAX_STDERR = 4096; // only the end of the helper's error messages is kept
const MAX_FAILURES = 5; // failures in a row before falling back to all the PC's sound
const MAX_UNSUPPORTED = 3; // code 2 (capture impossible) in a row before concluding that Windows cannot
const MAX_ABSENT = 5; // codes 3/4 in a row while the player is announced active (announced exe ≠ real process)

// State exposed to the diagnostic.
const state = {
  mode: 'system',
  exe: null,
  reason: '',
  unsupported: false,
  failures: 0,
  unsupportedCodes: 0,
  absent: 0,
};
let proc = null;
let restartTimer = null;
let fallback = false; // too many failures: all the PC's sound until the next player change
const listeners = new Set(); // windows that receive the sound

// Restarts the capture after `delay` ms, only if the player is still
// announced active and a window is listening (otherwise wait for a media message).
function scheduleRetry(exe, delay) {
  if (!targetActive(exe) || !activeListeners().length) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    refresh();
  }, delay);
}

// Every failure counter starts again from zero.
function resetCounters() {
  state.failures = 0;
  state.unsupportedCodes = 0;
  state.absent = 0;
}

// ---------- Windows concerned ----------

function wanted() {
  return S.settings.get('audioSource') !== 'system';
}

// Does a window need the sound? The scene: visible, awake, no game.
function windowActive(win) {
  if (!S.alive(win)) return false;
  if (win === S.widget) return S.sceneActive();
  return !win.isMinimized();
}

function activeListeners() {
  return [...listeners].filter(windowActive);
}

// ---------- Sending the sound, in aligned packets ----------

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
  // The helper works: every failure counter starts again from zero.
  if (state.failures || state.unsupportedCodes || state.absent) resetCounters();
  const aligned = assembler.push(data); // never a 16-bit sample cut in two
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

// ---------- Capture helper ----------

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

// Is the targeted player announced active by Windows?
function targetActive(exe) {
  const m = S.lastMedia;
  return !!(m && m.active && exeForApp(m.app) === exe);
}

function startHelper(exe) {
  const changed = state.exe !== exe;
  stopHelper();
  if (changed) resetCounters();
  state.exe = exe;
  const p = spawn(helperExe(), ['capture', exe], { windowsHide: true });
  proc = p;
  let err = '';
  // Helper missing or blocked (antivirus…): listen to the whole PC.
  p.on('error', (e) => {
    if (proc !== p) return;
    proc = null;
    state.unsupported = true;
    diagnostic.note('sound', `helper not found (${e.message}): all the PC's sound`);
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
    const msg = (/ERR \d+ (.*)/.exec(err) || [])[1] || `stopped (code ${code})`;
    if (code === EXIT.UNSUPPORTED) {
      // A single code 2 may be passing (player starting up): per-application
      // capture is only given up at the 3rd in a row.
      state.unsupportedCodes += 1;
      if (state.unsupportedCodes >= MAX_UNSUPPORTED) {
        // Windows cannot do it: listen to the whole PC.
        state.unsupported = true;
        diagnostic.note('sound', `per-application capture impossible (${msg}): all the PC's sound`);
        useSystem(`capture par application impossible : ${msg}`);
        return;
      }
      state.reason = msg;
      diagnostic.note(
        'son',
        `capture par application impossible (${msg}) : essai ${state.unsupportedCodes}/${MAX_UNSUPPORTED}`,
      );
      scheduleRetry(exe, retryDelay(state.unsupportedCodes));
      return;
    }
    state.reason = msg;
    if (code === EXIT.DEVICE_LOST) {
      // Audio device lost (output changed): restart quickly, without
      // counting a failure or giving up per-application capture.
      diagnostic.note('sound', `capture interrompue (${msg}) : nouvel essai`);
      scheduleRetry(exe, 1000);
      return;
    }
    // Application closed or not started yet: normal cases, which do not
    // count as failures. The rest is noted and counted.
    const normal = code === EXIT.CLOSED || code === EXIT.NOT_FOUND;
    if (!normal) {
      diagnostic.note('sound', `capture helper stopped (code ${code}): ${msg}`);
      state.failures += 1;
    } else if (targetActive(exe)) {
      // Windows announces the player as active but its process cannot be found
      // (the announced executable is not the real one): the loop would never stop.
      state.absent += 1;
      if (state.absent >= MAX_ABSENT) {
        fallback = true;
        diagnostic.note('sound', `player announced active but not found (${msg}): all the PC's sound`);
        useSystem(`player not found for the capture (${exe}): ${msg}`);
        return;
      }
    }
    if (state.failures >= MAX_FAILURES) {
      fallback = true;
      diagnostic.note('sound', `${state.failures} failures in a row (${msg}): all the PC's sound`);
      useSystem(`per-application capture failing: ${msg}`);
      return;
    }
    // Restart only if the player is still announced active, with a
    // growing delay. Otherwise wait for it to come back (see onMedia).
    scheduleRetry(exe, retryDelay(state.failures));
  });
}

// Switches every window to the whole PC's sound.
function useSystem(reason) {
  stopHelper();
  state.mode = 'system';
  state.reason = reason;
  for (const w of listeners) startIn(w);
}

// Starts or stops the helper as needed ("application" mode).
function ensureHelper(exe) {
  if (!activeListeners().length) {
    stopHelper(); // nobody is listening: capture nothing
    return;
  }
  if (!targetActive(exe)) {
    stopHelper(); // player not announced (yet): wait for the next media message
    state.reason = 'player not active yet';
    return;
  }
  if (restartTimer && state.exe === exe) return; // delay before a new attempt in progress
  if (!proc || state.exe !== exe) startHelper(exe);
}

// Chooses the source from the setting and the current media session.
function refresh() {
  const exe =
    exeForApp(S.lastMedia && S.lastMedia.app) || (S.settings.get('preferApp') === 'spotify' ? 'Spotify.exe' : null);
  if (!wanted() || state.unsupported || fallback) {
    if (state.mode !== 'system') {
      useSystem(wanted() ? state.reason : 'setting "all the PC\'s sound"');
    } else if (proc) {
      stopHelper();
    }
    return;
  }
  if (!exe) {
    if (state.mode !== 'system') useSystem('unknown player');
    else state.reason = 'unknown player';
    return;
  }
  const switching = state.mode !== 'app';
  state.mode = 'app';
  state.reason = '';
  if (switching) for (const w of listeners) startIn(w);
  ensureHelper(exe);
}

// Tells a page which mode to start ("audio:start" channel).
function startIn(win) {
  if (!S.alive(win)) return;
  const mode = state.mode === 'app' ? 'app' : 'system';
  // Capturing "all the PC's sound" (getDisplayMedia) requires a user
  // gesture: a script marked as such allows it for a few seconds.
  win.webContents
    .executeJavaScript('0', true)
    .catch(() => {})
    .finally(() => S.send([win], 'audio:start', mode));
}

// ---------- Windows ----------

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
    // Minimized / restored: it stops or starts again needing the sound.
    for (const ev of ['minimize', 'restore', 'show', 'hide']) win.on(ev, onActivityChanged);
  }
  // Choose the source; if it changes, refresh() already starts every
  // window, this one included.
  const before = state.mode;
  refresh();
  if (state.mode === before) startIn(win);
}

// A window became active or inactive (scene hidden, asleep, game…).
function onActivityChanged() {
  if (!listeners.size || !S.settings) return;
  refresh();
}

// The player changed (Spotify -> browser…), or starts / stops.
let lastKey = null;
let lastApp = '';
function onMedia(m) {
  if (!listeners.size || !m) return;
  const key = `${!!m.active}|${m.app || ''}`;
  if (key === lastKey) return;
  lastKey = key;
  // Different player: Windows may be able to capture this one even if it could not for the other.
  if ((m.app || '') !== lastApp) {
    lastApp = m.app || '';
    state.unsupported = false;
  }
  // New player or player back: start again without waiting for the delays.
  resetCounters();
  fallback = false;
  clearTimeout(restartTimer);
  restartTimer = null;
  refresh();
}
function onSettingChanged() {
  state.unsupported = false;
  fallback = false;
  resetCounters();
  if (listeners.size) refresh();
}

// App exit: do not leave the helper behind.
function stop() {
  stopHelper();
}

function status() {
  return { ...state, running: !!proc, listeners: listeners.size, active: activeListeners().length };
}

module.exports = { startAudio, onMedia, onSettingChanged, onActivityChanged, status, stop, exeForApp };
