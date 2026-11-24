// @ts-check
// Global keyboard shortcuts (Ctrl+Alt+<key>), active even when Sillon
// does not have the focus. The list and the labels are in
// src/renderer/shared/shortcuts.js; here, only the registration.
//
// No direct dependency on Electron: globalShortcut and the actions are
// passed to createShortcuts (tested separately, see test/shortcuts.test.js).

const { SHORTCUTS, BY_ID, TEXT } = require('../../renderer/shared/shortcuts');

/**
 * @param {{
 *   globalShortcut: { register: (acc: string, fn: () => void) => boolean, unregister: (acc: string) => void },
 *   actions: Record<string, () => void>,
 *   note?: (msg: string) => void,
 * }} deps
 */
function createShortcuts({ globalShortcut, actions, note = () => {} }) {
  let enabled = false;
  const registered = new Set(); // ids registered successfully
  const taken = new Set(); // ids refused (combination taken elsewhere)

  // An error in an action must not reach Electron.
  const run = (id) => () => {
    try {
      actions[id]();
    } catch (e) {
      const msg = TEXT.failedLog(BY_ID[id].label, (e && e.message) || e);
      console.error(msg);
      note(msg);
    }
  };

  function registerMissing() {
    for (const s of SHORTCUTS) {
      if (registered.has(s.id) || typeof actions[s.id] !== 'function') continue;
      let ok = false;
      try {
        ok = globalShortcut.register(s.accelerator, run(s.id));
      } catch (e) {
        console.error(`Raccourci ${s.display} :`, e);
      }
      if (ok) {
        registered.add(s.id);
        taken.delete(s.id);
      } else if (!taken.has(s.id)) {
        // Noted only once per combination, not on every new attempt.
        taken.add(s.id);
        console.error(TEXT.takenLog(s.display));
        note(TEXT.takenLog(s.display));
      }
    }
  }

  function unregisterAll() {
    for (const s of SHORTCUTS) {
      if (!registered.has(s.id)) continue;
      try {
        globalShortcut.unregister(s.accelerator);
      } catch (e) {
        console.error(`Raccourci ${s.display} :`, e);
      }
    }
    registered.clear();
    taken.clear();
  }

  // Turns all the shortcuts on or off (globalShortcuts setting).
  function apply(on) {
    enabled = !!on;
    if (enabled) registerMissing();
    else unregisterAll();
  }

  // State of each shortcut: ok | taken | off. retry: tries again those that
  // were taken (the other application may have freed them since).
  function status({ retry = false } = {}) {
    if (enabled && retry) registerMissing();
    return {
      enabled,
      items: SHORTCUTS.map((s) => ({
        id: s.id,
        state: !enabled ? 'off' : registered.has(s.id) ? 'ok' : 'taken',
      })),
    };
  }

  // Combination of an active shortcut (shown in the icon menu), otherwise undefined.
  const acceleratorOf = (id) => (registered.has(id) ? BY_ID[id].accelerator : undefined);

  return { apply, status, unregisterAll, acceleratorOf };
}

module.exports = { createShortcuts };
