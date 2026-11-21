(function () {
  'use strict';
  const { currentPosition } = window.SV;
  const $ = (id) => document.getElementById(id);

  const app = window.SVApp.createApp($('viz'), {
    onMedia(m, coverChanged) {
      const show = app ? app.state.settings.showNowPlaying !== false : true;
      $('now').classList.toggle('hidden', !(m.active && m.title && show));
      $('title').textContent = m.title || '';
      $('artist').textContent = [m.artist, m.album].filter(Boolean).join(' · ');
      if (coverChanged) {
        $('cover').src = m.cover || '';
        $('cover').classList.toggle('hidden', !m.cover);
      }
    },
    onSettings: (s) => applyLayout(s),
    onPalette(pal) {
      document.documentElement.style.setProperty('--accent', pal[1]);
      $('glow').style.background =
        `radial-gradient(60% 80% at 30% 60%, ${pal[0]}, transparent 70%),` +
        `radial-gradient(50% 70% at 75% 50%, ${pal[1]}, transparent 70%)`;
    },
  });

  // Réglages qui touchent la mise en page.
  function applyLayout(s) {
    document.body.style.opacity = s.opacity ?? 1;
    document.body.classList.toggle('with-now', s.showNowPlaying !== false);
    $('now').classList.toggle('hidden',
      !(s.showNowPlaying !== false && app.state.media.active && app.state.media.title));
  }

  // Barre de progression + message d'état audio.
  app.renderer.hooks.push(() => {
    const m = app.state.media;
    $('bar').style.width = m.duration ? `${(currentPosition(m) / m.duration) * 100}%` : '0%';
    const st = app.engine.status;
    const msg = st === 'no-audio' ? 'Aucun son système détecté'
      : st === 'error' ? 'Capture audio refusée' : '';
    $('status').textContent = msg;
    $('status').classList.toggle('hidden', !msg);
  });

  // ----- Mode placement -----
  if (window.bridge) {
    window.bridge.onEditing((on) => {
      document.body.classList.toggle('editing', on);
      $('edit').classList.toggle('hidden', !on);
    });
    $('done').addEventListener('click', () => window.bridge.editDone());

    const grip = $('grip');
    let start = null;
    grip.addEventListener('pointerdown', (e) => {
      grip.setPointerCapture(e.pointerId);
      start = { x: e.screenX, y: e.screenY, w: window.outerWidth, h: window.outerHeight };
    });
    grip.addEventListener('pointermove', (e) => {
      if (!start) return;
      window.bridge.resizeTo(start.w + e.screenX - start.x, start.h + e.screenY - start.y);
    });
    grip.addEventListener('pointerup', () => { start = null; });
  }
})();
