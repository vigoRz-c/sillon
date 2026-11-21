const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  style: 'bars',          // bars | mirror | ring | wave | aurora
  theme: 'album',         // album | neon | sunset | ocean | spotify | mono
  mode: 'wallpaper',      // wallpaper | top | normal
  bounds: null,           // { x, y, width, height } en DIP, null = placement par défaut
  showNowPlaying: true,
  opacity: 1,
  sensitivity: 1,
  fps: 60,
  preferApp: 'spotify',   // session média préférée ('' = celle que Windows met en avant)
  launchAtLogin: false,
};

class Settings {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'settings.json');
    this.data = { ...DEFAULTS };
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch { /* premier lancement */ }
  }
  get(key) { return key ? this.data[key] : { ...this.data }; }
  set(patch) {
    Object.assign(this.data, patch);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (e) { console.error('Sauvegarde des réglages impossible :', e); }
    return this.get();
  }
}

module.exports = { Settings, DEFAULTS };
