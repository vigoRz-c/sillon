// Sources "morceau en cours".
//
// Today: WindowsMediaSource, which reads the Windows media controls (SMTC)
// through the native helper (sillon-helper.exe, see helper.js). No account,
// works with Spotify and everything else.
//
// Later: a SpotifyApiSource could implement the same interface
// (start / stop / command / on('media')) and add likes, playlists, etc.
// The rest of the app only talks to this interface.

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const readline = require('readline');
const { helperExe } = require('../audio/helper');
const { note: diagNote } = require('./text-norm');

const protocol = require('../audio/helper-protocol');

// Protocol version of the helper (message "ready"). A helper that is
// older (or newer) is reported, without blocking.
const HELPER_PROTOCOL = protocol.PROTOCOL;
// Commands accepted by the helper: anything else is never written to its stdin.
const SIMPLE_COMMANDS = new Set(protocol.MEDIA_COMMANDS);
const { PREFIXED_COMMANDS } = protocol;
const STABLE_MS = 10000; // stable operation: the restart counter starts again from zero
const REPLAY_MS = 5000; // a playback command lost during the restart is replayed if it is less than 5 s old
const PLAYBACK_COMMANDS = new Set(protocol.PLAYBACK_COMMANDS);
const MAX_BAD_LINES = 3; // non-JSON lines logged per launch

// Reliable playback position to sync the lyrics.
//
// Spotify only publishes its position about every 4.5 s, rounded, with
// the time of that measure (updated). Extrapolating from "updated" is right...
// except when the time is stale: when resuming after a pause, Spotify
// announces "playing" with the time from before the pause, and the extrapolation
// adds the whole pause duration (the lyrics run ahead).
// So we compute an anchor point (anchorPos at the instant anchorAt):
//  - fresh measure: extrapolate from "updated";
//  - stale measure or resume without a new measure: raw position, now;
//  - gap < 0.35 s with the current estimate: keep the anchor (no
//    jitter due to Spotify's rounding).
const CADENCE_S = 6; // beyond this, a "playing" measure is considered stale

function anchor(prev, msg, now) {
  const pos = Number(msg.position) || 0;
  if (!msg.active || msg.status !== 'Playing') return { anchorPos: pos, anchorAt: now };

  const sameTrack = !msg.newTrack && prev && prev.active && prev.title === msg.title && prev.artist === msg.artist;
  const age = msg.updated > 0 ? (now - msg.updated) / 1000 : Infinity;
  // Same measure as the previous one while playback goes on: Spotify
  // repeats it as is, it is stale. Keep the current anchor.
  if (sameTrack && prev.status === 'Playing' && msg.updated > 0 && msg.updated === prev.updated && prev.anchorAt) {
    return { anchorPos: prev.anchorPos, anchorAt: prev.anchorAt };
  }
  const resumedStale = sameTrack && prev.status !== 'Playing' && msg.updated <= (prev.updated || 0);
  const fresh = age >= -1 && age < CADENCE_S && !resumedStale;
  const est = fresh ? pos + Math.max(0, age) : pos;

  if (sameTrack && prev.status === 'Playing' && prev.anchorAt) {
    const running = prev.anchorPos + (now - prev.anchorAt) / 1000;
    if (Math.abs(running - est) < 0.35) return { anchorPos: prev.anchorPos, anchorAt: prev.anchorAt };
  }
  return { anchorPos: est, anchorAt: now };
}

class WindowsMediaSource extends EventEmitter {
  // spawnFn and note can be injected (tests).
  constructor({ prefer = 'spotify', spawnFn = spawn, note = diagNote } = {}) {
    super();
    this.prefer = prefer;
    this.spawnFn = spawnFn;
    this.note = note;
    this.proc = null;
    this.state = { active: false };
    this.stopped = false;
    this.restarts = 0;
    this.timer = null;
    this.lost = null; // last lost playback command: { cmd, at }
  }

  start() {
    if (process.platform !== 'win32') {
      this.emit('error', new Error('The Windows media controls are only available on Windows.'));
      return;
    }
    this.stopped = false;
    let proc;
    try {
      proc = this.spawnFn(helperExe(), ['media'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      this.onDeath(null, Date.now(), null, null, e);
      return;
    }
    this.proc = proc;
    const startedAt = Date.now();
    let dead = false;
    const died = (code, signal, err) => {
      if (dead) return;
      dead = true;
      this.onDeath(proc, startedAt, code, signal, err);
    };
    // Writing to a closed pipe (EPIPE) must never become an unhandled exception.
    proc.stdin.on('error', (e) => this.note('helper', `could not write: ${e.message}`));
    proc.on('error', (e) => died(null, null, e));
    proc.on('exit', (code, signal) => died(code, signal, null));

    let badLines = 0;
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        if (++badLines <= MAX_BAD_LINES) this.note('helper', `ligne illisible : ${String(line).slice(0, 80)}`);
        return;
      }
      this.handleMessage(msg);
    });

    proc.stderr.on('data', (d) => this.emit('log', d.toString()));
  }

  handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ready') {
      if (msg.protocol !== HELPER_PROTOCOL) this.note('helper', 'outdated helper: run npm run build:helper again');
      this.command(`prefer:${this.prefer || ''}`);
      if (this.volumeExe) this.command(`volume-target:${this.volumeExe}`);
      // A click during the helper's restart is not lost for all that.
      const lost = this.lost;
      this.lost = null;
      if (lost && Date.now() - lost.at < REPLAY_MS) {
        this.note('helper', `command replayed after the restart: ${lost.cmd}`);
        this.command(lost.cmd);
      }
    } else if (msg.type === 'volume') {
      this.emit('volume', { exe: msg.exe, volume: msg.volume });
    } else if (msg.type === 'media') {
      // The cover is only sent when the track changes: keep it.
      // (or when it arrives late, coverUpdate).
      const cover = msg.newTrack || msg.coverUpdate ? msg.cover : this.state.cover;
      const now = Date.now();
      this.state = { ...msg, cover, receivedAt: now, ...anchor(this.state, msg, now) };
      this.emit('media', this.state);
    } else if (msg.type === 'cmd') {
      this.emit('command-result', msg);
    } else if (msg.type === 'error') {
      this.emit('error', new Error(msg.message));
    }
  }

  // Death of the helper (exit or failed launch): say so, the interface
  // goes back to "nothing playing", then restart with a growing delay.
  onDeath(proc, startedAt, code, signal, err) {
    if (proc && this.proc === proc) this.proc = null;
    if (!proc) this.proc = null;
    if (this.stopped) return;
    const why = err ? err.message : `code ${code}, signal ${signal}`;
    this.note('helper', `stopped (${why})`);
    this.emit('error', new Error(err ? `helper unavailable: ${err.message}` : `helper stopped (${why})`));
    if (this.state.active) this.handleMessage({ type: 'media', active: false });
    // The counter only starts again from zero after stable operation: a
    // helper that crashes right after starting must see the delay grow.
    if (Date.now() - startedAt >= STABLE_MS) this.restarts = 0;
    const delay = Math.min(30000, 1000 * 2 ** this.restarts++);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) this.start();
    }, delay);
  }

  // Writes a command to the helper's stdin. Only known commands
  // go through, with no line break in the values. Returns true if it was sent.
  command(cmd) {
    const c = String(cmd == null ? '' : cmd).replace(/[\r\n]/g, '');
    const known = SIMPLE_COMMANDS.has(c) || PREFIXED_COMMANDS.some((p) => c.startsWith(p));
    if (!known) {
      this.note('helper', `command refused: ${c.slice(0, 40)}`);
      return false;
    }
    const proc = this.proc;
    if (!proc || !proc.stdin || !proc.stdin.writable) {
      this.note('helper', `commande perdue (assistant absent) : ${c.slice(0, 40)}`);
      if (PLAYBACK_COMMANDS.has(c)) this.lost = { cmd: c, at: Date.now() }; // replayed on the next "ready"
      return false;
    }
    try {
      proc.stdin.write(c + '\n');
      return true;
    } catch (e) {
      this.note('helper', `could not write: ${e.message}`);
      return false;
    }
  }

  // Volume of the player alone (Windows mixer), 0-100.
  setVolumeTarget(exe) {
    if (exe === this.volumeExe) return;
    this.volumeExe = exe;
    this.command(`volume-target:${exe || ''}`);
  }

  setVolume(percent) {
    if (this.volumeExe) this.command(`volume:${Math.round(Math.max(0, Math.min(100, percent)))}`);
  }

  setPreferredApp(name) {
    this.prefer = name;
    this.command(`prefer:${name || ''}`);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    const proc = this.proc;
    this.proc = null;
    if (proc) {
      try {
        proc.stdin.end();
      } catch {
        /* already closed */
      }
      proc.kill();
    }
  }
}

module.exports = { WindowsMediaSource, anchor, HELPER_PROTOCOL };
