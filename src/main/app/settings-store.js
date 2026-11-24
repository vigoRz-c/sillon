// @ts-check
// Stockage des réglages : lecture tolérante, écriture atomique et différée.
// Sans dépendance à Electron (le dossier est donné par settings.js), pour
// pouvoir le tester dans un dossier temporaire.

const fs = require('fs');
const path = require('path');
const { DEFAULTS, sanitize } = require('./settings-schema');

const SAVE_DELAY = 300; // ms : un curseur déplacé n'écrit qu'une fois

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

class SettingsStore {
  // opts.onCorrupt(message) : appelé quand le fichier est illisible.
  // opts.delay : délai d'écriture (ms).
  constructor(file, opts = {}) {
    this.file = file;
    this.delay = opts.delay ?? SAVE_DELAY;
    this.onCorrupt = opts.onCorrupt || (() => {});
    this.timer = null;
    this.dirty = false;
    /** @type {Record<string, any>} réglages connus (DEFAULTS) et clés internes (fps30…) */
    this.data = { ...DEFAULTS };
    // Fichier présent mais illisible (EBUSY, EACCES...) : les valeurs en mémoire
    // sont celles par défaut, pas celles de l'utilisateur. Tant que c'est le cas,
    // on n'écrit rien (écrire effacerait ses vrais réglages) ; ses changements
    // de la session sont gardés dans `touched` et appliqués par-dessus le
    // fichier dès qu'il redevient lisible (voir flush).
    this.loadFailed = false;
    this.touched = {};
    this.load();
    this.migrate();
  }

  // 0.1.5 : 30 images par seconde par défaut (60 était enregistré pour tout
  // le monde, choisi ou non). Une seule fois : qui remet 60 le garde.
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
      // Pas de fichier : premier lancement. Autre erreur : on le dit.
      if (e.code !== 'ENOENT') {
        console.error('Lecture des réglages impossible :', e.message);
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

  // Met de côté un fichier illisible (sans écraser une sauvegarde existante).
  keepCorrupt(reason) {
    let bak = `${this.file}.bak`;
    if (fs.existsSync(bak)) bak = `${this.file}.${Date.now()}.bak`;
    try {
      fs.renameSync(this.file, bak);
    } catch (e) {
      console.error('Sauvegarde du fichier de réglages illisible impossible :', e.message);
    }
    const msg = `réglages illisibles (${reason}) : valeurs par défaut, ancien fichier conservé dans ${path.basename(bak)}`;
    console.error(msg);
    this.onCorrupt(msg);
  }

  get(key) {
    return key ? this.data[key] : { ...this.data };
  }

  // Applique un patch validé. Renvoie tous les réglages et les clés modifiées.
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

  // Écrit tout de suite ce qui est en attente (fermeture de l'app).
  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty && !this.loadFailed) return;
    if (this.loadFailed) {
      // Nouvelle lecture : si le fichier est enfin lisible, on y remet les
      // changements de l'utilisateur ; sinon on n'écrit rien (écriture reportée
      // à la fermeture ou au prochain changement).
      this.loadFailed = false;
      this.load();
      if (this.loadFailed) return;
      if (Object.keys(this.touched).length) this.dirty = true;
      Object.assign(this.data, this.touched);
      this.touched = {};
      this.migrate();
      if (!this.dirty) return; // rien à écrire
    }
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch (e) {
      console.error('Sauvegarde des réglages impossible :', e);
    }
  }
}

module.exports = { SettingsStore, SAVE_DELAY };
