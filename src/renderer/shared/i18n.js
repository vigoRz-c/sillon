/* global module, require -- UMD: shared with the main process and the node tests */
/* Translations: language choice, key lookup and translation of a page's markup.
 *
 * Shared by the pages (classic script, exposes window.SillonI18n; load
 * locales/en.js and locales/fr.js first) and by the main process (require).
 * English is the source language: a key missing from another language falls
 * back to English, then to the key itself.
 *
 * Markup: data-i18n="key" sets the text of an element;
 * data-i18n-attr="title:key1;aria-label:key2" sets attributes.
 */
(function (root) {
  'use strict';

  const isNode = typeof module === 'object' && module.exports;
  const LOCALES = isNode
    ? { en: require('./locales/en'), fr: require('./locales/fr') }
    : root.SillonLocales || { en: {} };

  const LANGUAGES = ['en', 'fr'];
  const DEFAULT = 'en';
  // Language setting: 'auto' follows Windows.
  const PREFERENCES = ['auto', ...LANGUAGES];

  // Supported language for a setting and the system's preferred languages
  // (e.g. ['fr-FR', 'en-US']): first supported one, English otherwise.
  function resolve(pref, systemLanguages) {
    if (LANGUAGES.includes(pref)) return pref;
    for (const tag of systemLanguages || []) {
      const base = String(tag).toLowerCase().split(/[-_]/)[0];
      if (LANGUAGES.includes(base)) return base;
    }
    return DEFAULT;
  }

  // Text for `key`, with {name} placeholders replaced from `params`.
  function translate(lang, key, params) {
    const dict = LOCALES[lang] || LOCALES[DEFAULT];
    const base = LOCALES[DEFAULT];
    let s = Object.hasOwn(dict, key) ? dict[key] : Object.hasOwn(base, key) ? base[key] : key;
    if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(params, k) ? String(params[k]) : m));
    return s;
  }

  const create = (lang) => (key, params) => translate(lang, key, params);

  // Translated name whose English text lives elsewhere (catalog.js, scene-layout.js):
  // `fallback` when no language has the key.
  const label = (t, key, fallback) => {
    const s = t(key);
    return s === key ? fallback : s;
  };

  const api = { LANGUAGES, DEFAULT, PREFERENCES, LOCALES, resolve, translate, create, label };

  if (isNode) {
    module.exports = api;
    return;
  }

  // ----- Pages -----
  let current = DEFAULT;
  const listeners = [];

  api.t = (key, params) => translate(current, key, params);
  api.language = () => current;

  // Translates the marked elements under `node` (the whole page by default).
  api.apply = (node = document) => {
    for (const el of node.querySelectorAll('[data-i18n]')) el.textContent = api.t(el.dataset.i18n);
    for (const el of node.querySelectorAll('[data-i18n-attr]')) {
      for (const pair of el.dataset.i18nAttr.split(';')) {
        const [attr, key] = pair.split(':').map((x) => x.trim());
        if (attr && key) el.setAttribute(attr, api.t(key));
      }
    }
  };

  api.set = (lang) => {
    const next = LANGUAGES.includes(lang) ? lang : DEFAULT;
    if (next === current && document.documentElement.lang === next) return;
    current = next;
    document.documentElement.lang = next;
    api.apply();
    for (const cb of listeners) {
      try {
        cb(next);
      } catch (e) {
        console.error('Language change:', e);
      }
    }
  };

  // Called again (by the page) after each language change.
  api.onChange = (cb) => listeners.push(cb);

  // Translates the page, asks the main process for the language, then follows its changes.
  api.start = (bridge) => {
    document.documentElement.lang = current;
    api.apply();
    if (!bridge || !bridge.getLanguage) return Promise.resolve(current);
    if (bridge.onLanguage) bridge.onLanguage((lang) => api.set(lang));
    return Promise.resolve(bridge.getLanguage())
      .then((lang) => api.set(lang))
      .catch(() => {})
      .then(() => current);
  };

  root.SillonI18n = api;
})(typeof window !== 'undefined' ? window : globalThis);
