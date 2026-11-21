(function () {
  'use strict';
  const { currentPosition } = window.SV;
  const $ = (id) => document.getElementById(id);
  const bridge = window.bridge;

  // Scène (disque + paroles + panneau, sur tout le bureau) ou bandeau.
  const isScene = (s) => s.layout !== 'strip' && s.mode === 'wallpaper';
  let scene = false;
  let coverImg = null;
  let lastTitle = null;
  let titleTimer = null;

  const lyrics = new window.LyricsView($('lyrics'));

  const app = window.SVApp.createApp($('viz'), {
    onMedia(m, coverChanged) {
      const show = app ? app.state.settings.showNowPlaying !== false : true;
      $('now').classList.toggle('hidden', !(m.active && m.title && show) || scene);
      $('title').textContent = m.title || '';
      $('artist').textContent = [m.artist, m.album].filter(Boolean).join(' · ');
      $('pTitle').textContent = m.active ? (m.title || '') : 'Rien en lecture';
      $('pArtist').textContent = m.active ? [m.artist, m.album].filter(Boolean).join(' · ') : '';
      if (coverChanged) {
        $('cover').src = m.cover || '';
        $('cover').classList.toggle('hidden', !m.cover);
        $('pCover').src = m.cover || '';
        $('pCover').classList.toggle('empty', !m.cover);
        if (m.cover) { coverImg = new Image(); coverImg.src = m.cover; } else coverImg = null;
      }
      // Nouveau morceau : le titre en très grand quelques secondes.
      const title = m.active ? m.title : null;
      if (title && title !== lastTitle) showBigTitle(title);
      lastTitle = title;
      if (app) updateDisc();
    },
    onLyrics: (l) => lyrics.set(l),
    transformSettings: (s) => (isScene(s) ? { ...s, style: 'disc' } : s),
    onSettings: (s) => applyLayout(s),
    onPalette(pal) {
      document.documentElement.style.setProperty('--accent', pal[1]);
      $('glow').style.background =
        `radial-gradient(60% 80% at 30% 60%, ${pal[0]}, transparent 70%),` +
        `radial-gradient(50% 70% at 75% 50%, ${pal[1]}, transparent 70%)`;
      if (app) updateDisc();
    },
  });

  function showBigTitle(title) {
    const el = $('bigTitle');
    el.textContent = title;
    el.classList.add('show');
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => el.classList.remove('show'), 5000);
  }

  // ----- Géométrie de la scène -----
  const geo = {};
  function computeGeometry() {
    const W = window.innerWidth, H = window.innerHeight;
    geo.cx = W * 0.6;
    geo.cy = H * 0.45;
    geo.r = Math.min(W, H) * 0.13;
    // Paroles : à gauche du disque, sans toucher ses rayons ni le panneau.
    const right = geo.cx - geo.r * 2.3;
    const left = W * 0.06;
    const box = $('lyrics').style;
    box.left = `${left}px`;
    box.width = `${Math.max(160, right - left)}px`;
    box.top = `${geo.cy}px`;
    document.documentElement.style.setProperty('--lyr-size', `${Math.round(Math.min(H * 0.075, W * 0.045))}px`);
    document.documentElement.style.setProperty('--title-size', `${Math.round(Math.min(W * 0.075, H * 0.14))}px`);
    // Panneau : grande pochette à moitié hors de l'écran, en bas à gauche.
    const R = Math.round(Math.min(H * 0.13, 120));
    document.documentElement.style.setProperty('--p-r', `${R}px`);
    $('panel').style.top = `${Math.round(H * 0.8 - R)}px`;
  }

  function updateDisc() {
    if (!scene) return;
    const st = app.state;
    app.renderer.opts = {
      glow: true, cx: geo.cx, cy: geo.cy, radius: geo.r,
      image: coverImg,
      spin: st.media.status === 'Playing',
      halo: (st.albumPalette && st.albumPalette[0]) || app.renderer.palette[0],
      palette: st.albumPalette || null,
    };
  }

  // Les boutons du panneau sont une petite fenêtre à part (la scène ne reçoit
  // pas les clics) : on lui indique où se placer.
  function reportControls() {
    if (!bridge || !bridge.reportControlsRect) return;
    const visible = scene && !$('panel').classList.contains('hidden');
    if (!visible) { bridge.reportControlsRect(null); return; }
    const r = $('pControls').getBoundingClientRect();
    bridge.reportControlsRect({ x: r.left, y: r.top, width: r.width, height: r.height });
  }

  function applyLayout(s) {
    scene = isScene(s);
    document.body.style.opacity = s.opacity ?? 1;
    document.body.classList.toggle('scene', scene);
    document.body.classList.toggle('with-now', !scene && s.showNowPlaying !== false);
    document.body.classList.toggle('no-lyrics', s.showLyrics === false);
    $('now').classList.toggle('hidden',
      scene || !(s.showNowPlaying !== false && app.state.media.active && app.state.media.title));
    $('panel').classList.toggle('hidden', !scene || s.showPanel === false);
    computeGeometry();
    if (!scene) app.renderer.opts = { glow: true };
    updateDisc();
    requestAnimationFrame(reportControls);
  }

  window.addEventListener('resize', () => {
    computeGeometry();
    updateDisc();
    requestAnimationFrame(reportControls);
  });

  // Progression, paroles et message d'état audio, à chaque image.
  app.renderer.hooks.push(() => {
    const m = app.state.media;
    const pos = currentPosition(m);
    const pct = m.duration ? `${(pos / m.duration) * 100}%` : '0%';
    $('bar').style.width = pct;
    if (scene) {
      $('pBar').style.width = pct;
      if (app.state.settings.showLyrics !== false) lyrics.update(m, pos);
    }
    const st = app.engine.status;
    const msg = st === 'no-audio' ? 'Aucun son système détecté'
      : st === 'error' ? 'Capture audio refusée' : '';
    $('status').textContent = msg;
    $('status').classList.toggle('hidden', !msg);
  });

  // ----- Mode placement (bandeau) -----
  if (bridge) {
    bridge.onEditing((on) => {
      document.body.classList.toggle('editing', on);
      $('edit').classList.toggle('hidden', !on);
    });
    $('done').addEventListener('click', () => bridge.editDone());

    const grip = $('grip');
    let start = null;
    grip.addEventListener('pointerdown', (e) => {
      grip.setPointerCapture(e.pointerId);
      start = { x: e.screenX, y: e.screenY, w: window.outerWidth, h: window.outerHeight };
    });
    grip.addEventListener('pointermove', (e) => {
      if (!start) return;
      bridge.resizeTo(start.w + e.screenX - start.x, start.h + e.screenY - start.y);
    });
    grip.addEventListener('pointerup', () => { start = null; });
  }
})();
