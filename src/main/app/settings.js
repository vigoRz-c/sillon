// App settings: settings.json file in the data folder.
// The default values and the validation are in settings-schema.js, the
// reading and writing in settings-store.js (without Electron, tested separately).

const { app } = require('electron');
const path = require('path');
const { SettingsStore } = require('./settings-store');

class Settings extends SettingsStore {
  constructor() {
    super(path.join(app.getPath('userData'), 'settings.json'), {
      onCorrupt: (msg) => require('./diagnostic').note('settings', msg),
    });
  }
}

module.exports = { Settings };
