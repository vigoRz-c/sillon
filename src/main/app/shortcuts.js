// @ts-check
// Raccourcis clavier globaux (Ctrl+Alt+<touche>), actifs même quand Sillon
// n'a pas le focus. La liste et les libellés sont dans
// src/renderer/shared/shortcuts.js ; ici, seulement l'enregistrement.
//
// Sans dépendance directe à Electron : globalShortcut et les actions sont
// passés à createShortcuts (testé à part, voir test/shortcuts.test.js).

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
  const registered = new Set(); // identifiants enregistrés avec succès
  const taken = new Set(); // identifiants refusés (combinaison prise ailleurs)

  // Une erreur dans une action ne doit pas remonter jusqu'à Electron.
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
        // Noté une seule fois par combinaison, pas à chaque nouvel essai.
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

  // Active ou désactive tous les raccourcis (réglage globalShortcuts).
  function apply(on) {
    enabled = !!on;
    if (enabled) registerMissing();
    else unregisterAll();
  }

  // État de chaque raccourci : ok | taken | off. retry : réessaie ceux qui
  // étaient pris (l'autre application a pu les libérer depuis).
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

  // Combinaison d'un raccourci actif (affichée dans le menu de l'icône), sinon undefined.
  const acceleratorOf = (id) => (registered.has(id) ? BY_ID[id].accelerator : undefined);

  return { apply, status, unregisterAll, acceleratorOf };
}

module.exports = { createShortcuts };
