/* Sillon's global keyboard shortcuts: id, key and English label.
 *
 * Single source shared by the main process (registration with globalShortcut,
 * tray menu) and the settings page (readable list). Other languages translate
 * the labels with the shortcut.<id> keys of shared/locales (see label()).
 *
 * Key choice: always Ctrl+Alt+<letter>. No digits, punctuation, E, Q or M:
 * on an AZERTY or QWERTZ keyboard, Ctrl+Alt equals AltGr, which types
 * € @ # { } [ ] | µ… A global shortcut on those keys would prevent typing
 * these characters in every app. No arrows either: Ctrl+Alt+arrow rotates the
 * screen on many PCs (Intel drivers). Ctrl+Alt+Del and Ctrl+Alt+Tab belong to
 * Windows, and Ctrl+Alt+Space is often taken by a desktop app's quick input.
 * U, J, K follow each other on the keyboard: show, delay, advance the lyrics.
 */
(function (root) {
  'use strict';

  // [id, key (Electron accelerator), label], in the order of the settings list
  const LIST = [
    ['playpause', 'P', 'Play / pause'],
    ['next', 'N', 'Next track'],
    ['previous', 'B', 'Previous track'],
    ['shuffle', 'A', 'Shuffle (with Spotify)'],
    ['repeat', 'R', 'Repeat (with Spotify)'],
    ['fullscreen', 'F', 'Open / close the full screen'],
    ['toggleScene', 'H', 'Show / hide Sillon on the desktop'],
    ['toggleLayout', 'T', 'Switch from the scene to the strip, and back'],
    ['nextStyle', 'V', 'Next visualizer'],
    ['nextTheme', 'C', 'Next colors'],
    ['veille', 'L', 'Start the screen saver'],
    ['toggleLyrics', 'U', 'Show / hide the lyrics'],
    ['lyricsLater', 'J', 'Lyrics later (−0.25 s)'],
    ['lyricsEarlier', 'K', 'Lyrics earlier (+0.25 s)'],
    ['settings', 'O', 'Open the settings'],
    ['sceneEditor', 'G', 'Customize the scene'],
    ['placeStrip', 'D', 'Move / resize the strip'],
  ];

  const SHORTCUTS = LIST.map(([id, key, label]) => ({
    id,
    accelerator: `CommandOrControl+Alt+${key}`,
    display: `Ctrl+Alt+${key}`,
    label,
  }));
  const BY_ID = Object.fromEntries(SHORTCUTS.map((s) => [s.id, s]));

  const api = {
    SHORTCUTS,
    BY_ID,
    // Label of a shortcut in the language of `t` (a SillonI18n translate function); English without `t`.
    label(id, t) {
      const english = BY_ID[id] ? BY_ID[id].label : id;
      if (!t) return english;
      const key = `shortcut.${id}`;
      const s = t(key);
      return s === key ? english : s;
    },
    // Log and diagnostics texts of the main process (in English, like the rest of the logs).
    TEXT: {
      takenLog: (keys) => `${keys} already taken by another application`,
      failedLog: (label, error) => `"${label}" failed: ${error}`,
      fromShortcut: 'from a keyboard shortcut',
    },
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SillonShortcuts = api;
})(typeof window !== 'undefined' ? window : globalThis);
