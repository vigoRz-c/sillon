// @ts-check
// Settings storage: tolerant reading, atomic and delayed writing.
// No dependency on Electron (the folder is given by settings.js), so that
// it can be tested in a temporary folder.

const fs = require('fs');
const path = require('path');
const { DEFAULTS, sanitize } = require('./settings-schema');

const SAVE_DELAY = 300; // ms: a moved slider writes only once

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

class SettingsStore {
  // opts.onCorrupt(message): called when the file is unreadable.
  // opts.delay: write delay (ms).
  constructor(file, opts = {}) {
    this.file = file;
    this.delay = opts.delay ?? SAVE_DELAY;
    this.onCorrupt = opts.onCorrupt || (() => {});
    this.timer = null;
    this.dirty = false;
    /** @type {Record<string, any>} known settings (DEFAULTS) and internal keys (fps30…) */
    this.data = { ...DEFAULTS };
    // File present but unreadable (EBUSY, EACCES...): the values in memory
    // are the defaults, not the user's. As long as this is the case,
    // nothing is written (writing would erase their real settings); their changes
    // during the session are kept in `touched` and applied on top of the
    // file as soon as it is readable again (see flush).
    this.loadFailed = false;
    this.touched = {};
    this.load();
    this.migrate();
  }

  // 0.1.5: 30 frames per second by default (60 was saved for
  // everyone, chosen or not). Only once: whoever sets 60 again keeps it.
  migrate() {
    if (this.loadFailed || this.data.fps30) return;
    if (this.data.fps === 60) this.data.fps = 30;
    this.data.fps30 = true;
    this.markDirty();
  }

  load() {
    let text;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (e) {
      // No file: first launch. Another error: say so.
      if (e.code !== 'ENOENT') {
        console.error('Could not read the settings:', e.message);
        this.onCorrupt(`lecture impossible (${e.code || e.message})`);
        this.loadFailed = true;
      }
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('objet attendu');
    } catch (e) {
      this.keepCorrupt(e.message);
      return;
    }
    try {
      Object.assign(this.data, sanitize(parsed));
    } catch (e) {
      this.keepCorrupt(e.message);
    }
  }

  // Sets an unreadable file aside (without overwriting an existing backup).
  keepCorrupt(reason) {
    let bak = `${this.file}.bak`;
    if (fs.existsSync(bak)) bak = `${this.file}.${Date.now()}.bak`;
    try {
      fs.renameSync(this.file, bak);
    } catch (e) {
      console.error('Could not back up the unreadable settings file:', e.message);
    }
    const msg = `unreadable settings (${reason}): default values, old file kept as ${path.basename(bak)}`;
    console.error(msg);
    this.onCorrupt(msg);
  }

  get(key) {
    return key ? this.data[key] : { ...this.data };
  }

  // Applies a validated patch. Returns all the settings and the changed keys.
  change(patch) {
    const clean = sanitize(patch);
    const changed = {};
    for (const [k, v] of Object.entries(clean)) {
      if (same(this.data[k], v)) continue;
      this.data[k] = v;
      changed[k] = v;
      if (this.loadFailed) this.touched[k] = v;
    }
    if (Object.keys(changed).length) this.markDirty();
    return { all: this.get(), changed };
  }

  set(patch) {
    return this.change(patch).all;
  }

  markDirty() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.delay);
    if (this.timer.unref) this.timer.unref();
  }

  // Writes right away what is pending (app closing).
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty && !this.loadFailed) return;
    if (this.loadFailed) {
      // Read again: if the file is finally readable, the user's changes
      // are put back into it; otherwise nothing is written (write postponed
      // until closing or the next change).
      this.loadFailed = false;
      this.load();
      if (this.loadFailed) return;
      if (Object.keys(this.touched).length) this.dirty = true;
      Object.assign(this.data, this.touched);
      this.touched = {};
      this.migrate();
      if (!this.dirty) return; // nothing to write
    }
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch (e) {
      console.error('Could not save the settings:', e);
    }
  }
}

module.exports = { SettingsStore, SAVE_DELAY };
