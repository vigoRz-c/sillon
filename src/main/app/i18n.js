// @ts-check
// Language of the main process (tray menu, notifications, dialogs) and of the
// pages, which ask for it over IPC ('i18n:language') and receive 'language'
// when it changes. The texts live in src/renderer/shared/locales.

const I18n = require('../../renderer/shared/i18n');
const S = require('./state');

// Windows' preferred languages, most preferred first (e.g. ['fr-FR', 'en-US']).
function systemLanguages() {
  try {
    const { app } = require('electron');
    if (app.getPreferredSystemLanguages) return app.getPreferredSystemLanguages();
    return [app.getLocale()];
  } catch {
    return []; // outside Electron (tests)
  }
}

// 'en' or 'fr': the language setting, or Windows' language when it is 'auto'.
const language = () => I18n.resolve(S.settings ? S.settings.get('language') : 'auto', systemLanguages());

/** @type {(key: string, params?: Record<string, unknown>) => string} */
const t = (key, params) => I18n.translate(language(), key, params);

module.exports = { language, t, systemLanguages };
