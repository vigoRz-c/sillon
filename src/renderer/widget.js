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
    const s = (app && app.state.settings) || {};
    // Position et taille réglables (paramètres), selon le fond d'écran.
    geo.cx = W * (s.discX ?? 0.6);
    geo.cy = H * (s.discY ?? 0.45);
    geo.r = Math.min(W, H) * 0.13 * (s.discSize ?? 1);
    // Paroles du côté le plus large, sans toucher les rayons du disque.
    const reach = geo.r * (1.6 + 0.6 * (s.discIntensity ?? 1.3));
    let left, right;
    if (geo.cx >= W / 2) { left = W * 0.06; right = geo.cx - reach; }
    else { left = geo.cx + reach; right = W * 0.94; }
    const box = $('lyrics').style;
    box.left = `${left}px`;
    box.width = `${Math.max(160, right - left)}px`;
    box.top = `${geo.cy}px`;
    document.documentElement.style.setProperty('--lyr-size', `${Math.round(Math.min(H * 0.075, W * 0.045))}px`);
    document.documentElement.style.setProperty('--title-size', `${Math.round(Math.min(W * 0.075, H * 0.14))}px`);
    // Panneau : grande pochette à moitié hors de l'écran, en bas à gauche.
    const R = Math.round(Math.min(H * 0.13, 120));
    document.documentElement.style.setProperty('--p-r', `${R}px`);
    geo.R = R;
    placePanel();
  }

  // Le texte du panneau (avec la file d'attente) peut dépasser la pochette :
  // on remonte le panneau pour qu'il reste au-dessus du bas de l'écran.
  function placePanel() {
    const H = window.innerHeight, R = geo.R || 100;
    const text = document.querySelector('.p-text');
    const textBottom = R * 0.45 + (text ? text.offsetHeight : 0);
    const top = Math.min(H * 0.74 - R, H - 16 - Math.max(2 * R, textBottom));
    $('panel').style.top = `${Math.round(Math.max(H * 0.3, top))}px`;
  }

  function updateDisc() {
    if (!scene) return;
    const st = app.state;
    app.renderer.opts = {
      glow: true, cx: geo.cx, cy: geo.cy, radius: geo.r,
      image: coverImg,
      intensity: st.settings.discIntensity ?? 1.3,
      spin: st.media.status === 'Playing',
      halo: (st.albumPalette && st.albumPalette[0]) || app.renderer.palette[0],
      palette: st.albumPalette || null,
    };
  }

  // File d'attente (si le compte Spotify est connecté dans les paramètres).
  function renderQueue(q) {
    const items = (q && q.items) || [];
    const list = $('pQueueList');
    list.textContent = '';
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'q-row';
      const img = document.createElement('img');
      img.className = 'q-cover';
      img.alt = '';
      if (it.image) img.src = it.image; else img.classList.add('empty');
      const meta = document.createElement('div');
      meta.className = 'q-meta';
      const t = document.createElement('div'); t.className = 'q-title'; t.textContent = it.title;
      const a = document.createElement('div'); a.className = 'q-artist'; a.textContent = it.artist;
      meta.append(t, a);
      row.append(img, meta);
      list.appendChild(row);
    }
    $('pQueue').classList.toggle('hidden', !items.length);
    placePanel();
    requestAnimationFrame(reportControls);
  }
  if (bridge && bridge.onQueue) bridge.onQueue(renderQueue);

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

  // ----- Pause, sommeil et mode jeu -----
  // Musique en pause : scène atténuée. Sans musique pendant N minutes : scène
  // masquée et rendu arrêté, jusqu'au retour de la musique.
  let silentSince = Date.now();
  let gamePause = false;
  let asleep = false;
  function updateRest() {
    const s = app.state.settings;
    const playing = app.state.media.active && app.state.media.status === 'Playing';
    if (playing) silentSince = Date.now();
    const minutes = Number(s.sleepAfter ?? 5);
    asleep = !playing && minutes > 0 && Date.now() - silentSince > minutes * 60000;
    document.body.classList.toggle('is-paused', !playing && s.dimOnPause !== false && !asleep);
    document.body.classList.toggle('is-asleep', asleep);
    app.renderer.paused = gamePause || asleep;
  }
  setInterval(updateRest, 2000);
  if (bridge && bridge.onMedia) bridge.onMedia(() => setTimeout(updateRest, 0));
  if (bridge && bridge.onRenderPause) bridge.onRenderPause((on) => { gamePause = on; updateRest(); });

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
