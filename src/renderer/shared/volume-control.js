/* Barre de volume du lecteur (Spotify, navigateur…).
 *
 * Règle le volume de l'application dans le mélangeur de Windows : le volume
 * général du PC et les autres applications (Discord…) ne bougent pas.
 * Utilisée par les boutons de la scène et le plein écran.
 *
 *   SillonVolume(élément) -> { update(media) }
 *
 * L'élément reçoit un bouton (couper / remettre le son) et un curseur ; il est
 * masqué tant que le lecteur n'a pas de son ouvert dans Windows.
 */
(function () {
  'use strict';
  const icon = (d) =>
    `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
  const SPEAKER = 'M4 9h4l5-4v14l-5-4H4z';
  const ICONS = {
    mute: icon(
      `${SPEAKER}M16.5 9.5l1.4-1.4 2.1 2.1 2.1-2.1 1.4 1.4-2.1 2.1 2.1 2.1-1.4 1.4-2.1-2.1-2.1 2.1-1.4-1.4 2.1-2.1z`,
    ),
    low: icon(`${SPEAKER}M15.5 8.5a5 5 0 0 1 0 7l-1.4-1.4a3 3 0 0 0 0-4.2z`),
    high: icon(
      `${SPEAKER}M15.5 8.5a5 5 0 0 1 0 7l-1.4-1.4a3 3 0 0 0 0-4.2zM18.4 5.6a9 9 0 0 1 0 12.8L17 17a7 7 0 0 0 0-9.9z`,
    ),
  };

  window.SillonVolume = function (root) {
    const bridge = window.bridge;
    root.classList.add('vol', 'hidden');
    root.innerHTML =
      '<button type="button" class="vol-btn" title="Couper le son du lecteur" aria-label="Couper le son du lecteur"></button>' +
      '<input class="vol-range" type="range" min="0" max="100" step="1" aria-label="Volume du lecteur" aria-valuetext="0 pour cent">';
    const btn = root.querySelector('button');
    const range = root.querySelector('input');
    let value = -1;
    let restore = 50; // volume remis après « couper le son »
    let dragging = false;
    let holdUntil = 0; // ignore les relectures juste après un réglage
    let pending = null;

    function paint(v) {
      range.value = String(v);
      range.style.setProperty('--v', `${v}%`);
      btn.innerHTML = v === 0 ? ICONS.mute : v < 50 ? ICONS.low : ICONS.high;
      const label = v === 0 ? 'Remettre le son du lecteur' : 'Couper le son du lecteur';
      btn.title = label;
      btn.setAttribute('aria-label', label);
      range.setAttribute('aria-valuetext', `${v} pour cent`);
    }

    // Un envoi par image au plus pendant le glissement.
    function set(v) {
      v = Math.max(0, Math.min(100, Math.round(v)));
      if (v > 0) restore = v;
      value = v;
      paint(v);
      holdUntil = Date.now() + 1500;
      if (pending === null) {
        requestAnimationFrame(() => {
          bridge.setVolume(pending);
          pending = null;
        });
      }
      pending = v;
    }

    range.addEventListener('input', () => set(Number(range.value)));
    // Fin du geste, même relâché hors de la fenêtre ou interrompu : sinon le
    // volume réel ne serait plus jamais affiché.
    function endDrag() {
      if (dragging) {
        dragging = false;
        holdUntil = Date.now() + 1500;
      }
    }
    range.addEventListener('pointerdown', (e) => {
      dragging = true;
      try {
        range.setPointerCapture(e.pointerId);
      } catch {
        // Pointeur déjà relâché : les écouteurs ci-dessous suffisent.
      }
    });
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    range.addEventListener('lostpointercapture', endDrag);
    btn.addEventListener('click', () => set(value > 0 ? 0 : restore || 50));
    root.addEventListener(
      'wheel',
      (e) => {
        if (value < 0) return;
        e.preventDefault();
        e.stopPropagation();
        set(value + (e.deltaY < 0 ? 5 : -5));
      },
      { passive: false },
    );

    return {
      update(m) {
        const v = m && m.active && Number.isFinite(m.volume) ? m.volume : null;
        root.classList.toggle('hidden', v === null);
        if (v === null) {
          value = -1;
          return;
        }
        if (dragging || Date.now() < holdUntil) return;
        if (v > 0) restore = v;
        value = v;
        paint(v);
      },
    };
  };
})();
