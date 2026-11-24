/* Player volume bar (Spotify, browser…).
 *
 * Sets the application's volume in the Windows mixer: the PC's master
 * volume and the other applications (Discord…) do not move.
 * Used by the scene's buttons and the full screen.
 *
 *   SillonVolume(element) -> { update(media) }
 *
 * The element gets a button (mute / unmute) and a slider; it is hidden
 * as long as the player has no sound open in Windows.
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
    const t = window.SillonI18n.t;
    root.innerHTML =
      '<button type="button" class="vol-btn"></button>' +
      '<input class="vol-range" type="range" min="0" max="100" step="1" data-i18n-attr="aria-label:volume.label">';
    const btn = root.querySelector('button');
    const range = root.querySelector('input');
    range.setAttribute('aria-label', t('volume.label'));
    let value = -1;
    let restore = 50; // volume restored after "mute"
    let dragging = false;
    let holdUntil = 0; // ignores readings right after a change
    let pending = null;

    function paint(v) {
      range.value = String(v);
      range.style.setProperty('--v', `${v}%`);
      btn.innerHTML = v === 0 ? ICONS.mute : v < 50 ? ICONS.low : ICONS.high;
      const label = v === 0 ? t('volume.unmute') : t('volume.mute');
      btn.title = label;
      btn.setAttribute('aria-label', label);
      range.setAttribute('aria-valuetext', t('volume.percent', { value: v }));
    }
    paint(0);
    window.SillonI18n.onChange(() => paint(Math.max(0, value)));

    // At most one send per frame while dragging.
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
    // End of the gesture, even released outside the window or interrupted: otherwise
    // the real volume would never be shown again.
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
        // Pointer already released: the listeners below are enough.
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
