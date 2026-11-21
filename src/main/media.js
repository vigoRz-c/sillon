// Sources "morceau en cours".
//
// Aujourd'hui : WindowsMediaSource, qui lit les contrôles média de Windows (SMTC)
// via un petit script PowerShell. Aucun compte, marche avec Spotify et le reste.
//
// Plus tard : une SpotifyApiSource pourra implémenter la même interface
// (start / stop / command / on('media')) et ajouter like, playlists, etc.
// Le reste de l'app ne parle qu'à cette interface.

const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

function helperPath() {
  // En build, le script est copié dans resources/ (voir extraResources).
  const packaged = process.resourcesPath && path.join(process.resourcesPath, 'media-helper.ps1');
  if (packaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, 'media-helper.ps1');
}

class WindowsMediaSource extends EventEmitter {
  constructor({ prefer = 'spotify' } = {}) {
    super();
    this.prefer = prefer;
    this.proc = null;
    this.state = { active: false };
    this.stopped = false;
    this.restarts = 0;
  }

  start() {
    if (process.platform !== 'win32') {
      this.emit('error', new Error('Les contrôles média Windows ne sont disponibles que sous Windows.'));
      return;
    }
    this.stopped = false;
    this.proc = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath()
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    readline.createInterface({ input: this.proc.stdout }).on('line', (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.type === 'ready') {
        this.restarts = 0;
        this.command(`prefer:${this.prefer || ''}`);
      } else if (msg.type === 'media') {
        // La pochette n'est envoyée qu'au changement de morceau : on la garde.
        // (ou quand elle arrive en retard, coverUpdate).
        const cover = msg.newTrack || msg.coverUpdate ? msg.cover : this.state.cover;
        this.state = { ...msg, cover, receivedAt: Date.now() };
        this.emit('media', this.state);
      } else if (msg.type === 'error') {
        this.emit('error', new Error(msg.message));
      }
    });

    this.proc.stderr.on('data', (d) => this.emit('log', d.toString()));
    this.proc.on('exit', () => {
      this.proc = null;
      if (this.stopped) return;
      // Redémarrage avec un délai croissant si PowerShell plante.
      const delay = Math.min(30000, 1000 * 2 ** this.restarts++);
      setTimeout(() => !this.stopped && this.start(), delay);
    });
  }

  command(cmd) {
    if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(cmd + '\n');
  }

  setPreferredApp(name) {
    this.prefer = name;
    this.command(`prefer:${name || ''}`);
  }

  stop() {
    this.stopped = true;
    if (this.proc) {
      this.proc.stdin.end();
      this.proc.kill();
    }
  }
}

module.exports = { WindowsMediaSource };
