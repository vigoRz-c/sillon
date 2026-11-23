// Sources "morceau en cours".
//
// Aujourd'hui : WindowsMediaSource, qui lit les contrôles média de Windows (SMTC)
// via l'assistant natif (sillon-helper.exe, voir helper.js). Aucun compte,
// marche avec Spotify et le reste.
//
// Plus tard : une SpotifyApiSource pourra implémenter la même interface
// (start / stop / command / on('media')) et ajouter like, playlists, etc.
// Le reste de l'app ne parle qu'à cette interface.

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const readline = require('readline');
const { helperExe } = require('../audio/helper');
const { note: diagNote } = require('./text-norm');

// Version du protocole de l'assistant (message "ready"). Un assistant plus
// ancien (ou plus récent) est signalé, sans bloquer.
const HELPER_PROTOCOL = 1;
// Commandes acceptées par l'assistant : le reste n'est jamais écrit sur son stdin.
const SIMPLE_COMMANDS = new Set(['playpause', 'play', 'pause', 'next', 'previous', 'shuffle', 'repeat']);
const PREFIXED_COMMANDS = ['volume:', 'prefer:', 'volume-target:'];
const STABLE_MS = 10000; // fonctionnement stable : le compteur de redémarrages repart de zéro
const MAX_BAD_LINES = 3; // lignes non JSON journalisées par lancement

// Position de lecture fiable pour synchroniser les paroles.
//
// Spotify ne publie sa position qu'environ toutes les 4,5 s, arrondie, avec
// l'heure de cette mesure (updated). Extrapoler depuis "updated" est juste...
// sauf quand l'heure est périmée : à la reprise après une pause, Spotify
// annonce « en lecture » avec l'heure d'avant la pause, et l'extrapolation
// ajoute toute la durée de la pause (les paroles partent en avance).
// On calcule donc un point d'ancrage (anchorPos à l'instant anchorAt) :
//  - mesure fraîche : on extrapole depuis "updated" ;
//  - mesure périmée ou reprise sans nouvelle mesure : position brute, maintenant ;
//  - écart < 0,35 s avec l'estimation en cours : on garde l'ancrage (pas de
//    sautillement dû à l'arrondi de Spotify).
const CADENCE_S = 6; // au-delà, une mesure "en lecture" est considérée périmée

function anchor(prev, msg, now) {
  const pos = Number(msg.position) || 0;
  if (!msg.active || msg.status !== 'Playing') return { anchorPos: pos, anchorAt: now };

  const sameTrack = !msg.newTrack && prev && prev.active && prev.title === msg.title && prev.artist === msg.artist;
  const age = msg.updated > 0 ? (now - msg.updated) / 1000 : Infinity;
  // Même mesure que la précédente alors que la lecture continue : Spotify la
  // répète telle quelle, elle est périmée. On garde l'ancrage en cours.
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
  // spawnFn et note sont injectables (tests).
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
  }

  start() {
    if (process.platform !== 'win32') {
      this.emit('error', new Error('Les contrôles média Windows ne sont disponibles que sous Windows.'));
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
    // Écrire dans un tube fermé (EPIPE) ne doit jamais devenir une exception non gérée.
    proc.stdin.on('error', (e) => this.note('assistant', `écriture impossible : ${e.message}`));
    proc.on('error', (e) => died(null, null, e));
    proc.on('exit', (code, signal) => died(code, signal, null));

    let badLines = 0;
    readline.createInterface({ input: proc.stdout }).on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        if (++badLines <= MAX_BAD_LINES) this.note('assistant', `ligne illisible : ${String(line).slice(0, 80)}`);
        return;
      }
      this.handleMessage(msg);
    });

    proc.stderr.on('data', (d) => this.emit('log', d.toString()));
  }

  handleMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ready') {
      if (msg.protocol !== HELPER_PROTOCOL) this.note('assistant', 'assistant périmé : relancer npm run build:helper');
      this.command(`prefer:${this.prefer || ''}`);
      if (this.volumeExe) this.command(`volume-target:${this.volumeExe}`);
    } else if (msg.type === 'volume') {
      this.emit('volume', { exe: msg.exe, volume: msg.volume });
    } else if (msg.type === 'media') {
      // La pochette n'est envoyée qu'au changement de morceau : on la garde.
      // (ou quand elle arrive en retard, coverUpdate).
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

  // Mort de l'assistant (sortie ou échec de lancement) : on le dit, l'interface
  // repasse à « rien en cours », puis on relance avec un délai croissant.
  onDeath(proc, startedAt, code, signal, err) {
    if (proc && this.proc === proc) this.proc = null;
    if (!proc) this.proc = null;
    if (this.stopped) return;
    const why = err ? err.message : `code ${code}, signal ${signal}`;
    this.note('assistant', `arrêté (${why})`);
    this.emit('error', new Error(err ? `assistant indisponible : ${err.message}` : `assistant arrêté (${why})`));
    if (this.state.active) this.handleMessage({ type: 'media', active: false });
    // Le compteur ne repart de zéro qu'après un fonctionnement stable : un
    // assistant qui plante juste après son démarrage doit voir le délai croître.
    if (Date.now() - startedAt >= STABLE_MS) this.restarts = 0;
    const delay = Math.min(30000, 1000 * 2 ** this.restarts++);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) this.start();
    }, delay);
  }

  // Écrit une commande sur le stdin de l'assistant. Seules les commandes connues
  // passent, sans saut de ligne dans les valeurs. Renvoie true si elle est partie.
  command(cmd) {
    const c = String(cmd == null ? '' : cmd).replace(/[\r\n]/g, '');
    const known = SIMPLE_COMMANDS.has(c) || PREFIXED_COMMANDS.some((p) => c.startsWith(p));
    if (!known) {
      this.note('assistant', `commande refusée : ${c.slice(0, 40)}`);
      return false;
    }
    const proc = this.proc;
    if (!proc || !proc.stdin || !proc.stdin.writable) {
      this.note('assistant', `commande perdue (assistant absent) : ${c.slice(0, 40)}`);
      return false;
    }
    try {
      proc.stdin.write(c + '\n');
      return true;
    } catch (e) {
      this.note('assistant', `écriture impossible : ${e.message}`);
      return false;
    }
  }

  // Volume du lecteur seul (mélangeur de Windows), 0-100.
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
        /* déjà fermé */
      }
      proc.kill();
    }
  }
}

module.exports = { WindowsMediaSource, anchor, HELPER_PROTOCOL };
