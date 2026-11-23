// Réglages de l'app : fichier settings.json dans le dossier de données.
// Les valeurs par défaut et la validation sont dans settings-schema.js, la
// lecture et l'écriture dans settings-store.js (sans Electron, testés à part).

const { app } = require('electron');
const path = require('path');
const { SettingsStore } = require('./settings-store');

class Settings extends SettingsStore {
  constructor() {
    super(path.join(app.getPath('userData'), 'settings.json'), {
      onCorrupt: (msg) => require('./diagnostic').note('réglages', msg),
    });
  }
}

module.exports = { Settings };
