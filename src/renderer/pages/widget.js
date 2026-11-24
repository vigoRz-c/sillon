(function () {
  'use strict';
  const { currentPosition, fmt, THEMES, VISUALIZERS, drawEdgeGlow, drawCoverRings } = window.SV;
  const SL = window.SceneLayout;
  const $ = (id) => document.getElementById(id);
  const bridge = window.bridge;

  // ?edit=1 : éditeur de disposition (fenêtre à part, au premier plan).
  const EDIT = new URLSearchParams(location.search).has('edit');

  // Scène (éléments placés sur tout le bureau) ou bandeau.
  const isScene = (s) => EDIT || (s.layout !== 'strip' && s.mode === 'wallpaper');
  let scene = false;
  let coverImg = null;
  let lastTitle = null;
  let titleTimer = null;

  // Disposition affichée : celle des réglages, ou le brouillon de l'éditeur.
  // En édition, la disposition et les options modifiées sont celles de l'éditeur (scene-editor.js).
  let editor = null;
  const settings = () => (editor ? editor.settings() : app.state.settings);
  // Recalculée seulement quand les réglages changent (appelée à chaque image).
  let cachedFor = null,
    cachedLayout = null;
  const layout = () => {
    if (editor && editor.draft) return editor.draft;
    if (cachedFor !== app.state.settings) {
      cachedFor = app.state.settings;
      cachedLayout = SL.fromSettings(cachedFor);
    }
    return cachedLayout;
  };

  const lyrics = new window.LyricsView($('lyrics'));
  // Paroles et titre annoncés par les lecteurs d'écran (sans interrompre la lecture en cours).
  $('lyrics').setAttribute('aria-live', 'polite');
  $('pInfo').setAttribute('aria-live', 'polite');

  const app = window.SVApp.createApp($('viz'), {
    onMedia(m, coverChanged) {
      const show = app ? app.state.settings.showNowPlaying !== false : true;
      $('now').classList.toggle('hidden', !(m.active && m.title && show) || scene);
      $('title').textContent = m.title || '';
      $('artist').textContent = [m.artist, m.album].filter(Boolean).join(' · ');
      $('pTitle').textContent = m.active ? m.title || '' : 'Rien en lecture';
      $('pArtist').textContent = m.active ? [m.artist, m.album].filter(Boolean).join(' · ') : '';
      if (coverChanged) {
        $('cover').src = m.cover || '';
        $('cover').classList.toggle('hidden', !m.cover);
        $('pCover').src = m.cover || '';
        $('pCover').classList.toggle('empty', !m.cover);
        // Image décodée une seule fois par pochette (créée dans common.js).
        coverImg = m.cover && app ? app.state.coverImg : null;
      }
      // Nouveau morceau : le titre en très grand quelques secondes.
      const title = m.active ? m.title : null;
      if (title && title !== lastTitle) showBigTitle(title);
      lastTitle = title;
      if (app) updateDisc();
    },
    onLyrics: (l) => lyrics.set(l),
    transformSettings: (s) => (isScene(s) ? { ...s, style: 'disc' } : s),
    onSettings: (s) => {
      if (editor && !editor.draft) editor.start(s);
      applyLayout(s);
    },
    onPalette(pal) {
      document.documentElement.style.setProperty('--accent', pal[1]);
      $('glow').style.background =
        `radial-gradient(60% 80% at 30% 60%, ${pal[0]}, transparent 70%),` +
        `radial-gradient(50% 70% at 75% 50%, ${pal[1]}, transparent 70%)`;
      if (app) updateDisc();
    },
  });

  function showBigTitle(title) {
    $('bigTitleText').textContent = title;
    $('bigTitle').classList.add('show');
    clearTimeout(titleTimer);
    // Dans l'éditeur, le titre reste visible pour pouvoir le placer.
    if (!EDIT) titleTimer = setTimeout(() => $('bigTitle').classList.remove('show'), 5000);
    if (scene) requestAnimationFrame(placeAll);
  }

  // ----- Placement des éléments -----
  const geo = {};
  const NODES = {
    disc: 'discEl',
    lyrics: 'lyrics',
    title: 'bigTitle',
    cover: 'pCover',
    info: 'pInfo',
    buttons: 'pControls',
    queue: 'pQueue',
    clock: 'clock',
    bars: 'barsEl',
  };
  // Éléments agrandis par transform (texte) ; les autres changent de taille réelle.
  const SCALED = new Set(['info', 'buttons', 'queue', 'clock']);
  // Éléments gardés entièrement dans l'écran (la pochette et le disque peuvent dépasser).
  const KEEP_INSIDE = new Set(['title', 'info', 'buttons', 'queue', 'clock', 'lyrics', 'bars']);

  function placeAll() {
    if (!scene) return;
    const W = window.innerWidth,
      H = window.innerHeight;
    const L = layout();
    const base = Math.min(W, H);
    // Taille de base du texte de la scène (l'horloge s'en sert), et taille des
    // paroles, posée sur les paroles seules : agrandir l'une ne touche pas l'autre.
    const textBase = Math.round(Math.min(H * 0.075, W * 0.045));
    document.documentElement.style.setProperty('--scene-text', `${textBase}px`);
    $('lyrics').style.setProperty('--lyr-size', `${Math.round(textBase * L.lyrics.scale)}px`);
    document.documentElement.style.setProperty(
      '--title-size',
      `${Math.round(Math.min(W * 0.075, H * 0.14) * L.title.scale)}px`,
    );

    // Disque (dessiné dans le canevas) : rayon et zone de saisie.
    geo.cx = W * L.disc.x;
    geo.cy = H * L.disc.y;
    geo.r = base * 0.13 * L.disc.scale;
    geo.discOn = L.disc.visible;
    const reach = geo.r * (1.6 + 0.6 * (settings().discIntensity ?? 1.3));
    size('disc', reach * 2, reach * 2);
    // Pochette du panneau.
    const R = Math.round(Math.min(H * 0.13, 120) * L.cover.scale);
    size('cover', R * 2, R * 2);
    // Paroles et barres : largeur (et hauteur) en fraction de l'écran.
    size('lyrics', L.lyrics.w * W);
    size('bars', L.bars.w * W, L.bars.h * H);

    for (const id of SL.ORDER) place(id, L[id], W, H);

    const c = $('pCover').getBoundingClientRect();
    geo.pc = L.cover.visible && c.width ? { x: c.left + c.width / 2, y: c.top + c.height / 2, R: c.width / 2 } : null;
    geo.bars = L.bars.visible
      ? { x: W * L.bars.x - (L.bars.w * W) / 2, y: H * L.bars.y - (L.bars.h * H) / 2, w: L.bars.w * W, h: L.bars.h * H }
      : null;
    updateDisc();
    if (editor) editor.drawSelection();
    requestAnimationFrame(reportControls);
  }

  function size(id, w, h) {
    const n = $(NODES[id]);
    if (w != null) n.style.width = `${Math.round(w)}px`;
    if (h != null) n.style.height = `${Math.round(h)}px`;
  }

  function place(id, el, W, H) {
    const n = $(NODES[id]),
      spec = SL.ELEMENTS[id];
    n.classList.toggle('off', !el.visible);
    if (!el.visible) return;
    const s = SCALED.has(id) ? el.scale : 1;
    n.style.left = `${W * el.x}px`;
    n.style.top = `${H * el.y}px`;
    n.style.transformOrigin = `${spec.ax * 100}% ${spec.ay * 100}%`;
    n.style.transform = `translate(${-spec.ax * 100}%, ${-spec.ay * 100}%) scale(${s})`;
    if (KEEP_INSIDE.has(id)) {
      // Ne pas déborder de l'écran (texte plus long que prévu, élément agrandi).
      const r = n.getBoundingClientRect();
      const dx = r.left < 0 ? -r.left : r.right > W ? W - r.right : 0;
      const dy = r.top < 0 ? -r.top : r.bottom > H ? H - r.bottom : 0;
      if (dx || dy) {
        n.style.left = `${W * el.x + dx}px`;
        n.style.top = `${H * el.y + dy}px`;
      }
    }
  }

  // Couleurs du disque : celles de la pochette, ou un thème fixe.
  function discPalette() {
    const st = app.state,
      c = settings().discColors || 'album';
    if (c !== 'album' && THEMES[c]) return THEMES[c];
    return st.albumPalette || app.renderer.palette;
  }

  function updateDisc() {
    if (!scene) return;
    const st = app.state,
      s = settings();
    const pal = discPalette();
    app.renderer.style = geo.discOn === false ? 'none' : 'disc';
    app.renderer.opts = {
      glow: true,
      cx: geo.cx,
      cy: geo.cy,
      radius: geo.r,
      image: coverImg,
      intensity: s.discIntensity ?? 1.3,
      spin: st.media.status === 'Playing',
      halo: pal[0],
      palette: pal,
      rays: s.discRays || 'fine',
      bloom: s.discBloom ?? 0.8,
    };
  }

  // Horloge.
  function updateClock() {
    const d = new Date();
    $('clockTime').textContent = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    $('clockDate').textContent = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  updateClock();
  setInterval(updateClock, 5000);

  // File d'attente (si le compte Spotify est connecté dans les paramètres).
  let lastQueue = { items: [] };
  let lastQueueKey = null;
  function renderQueue(q) {
    lastQueue = q || { items: [] };
    let items = lastQueue.items || [];
    // Dans l'éditeur, une file d'exemple pour voir la place qu'elle prend.
    if (EDIT && !items.length) items = [1, 2, 3].map((i) => ({ title: `Morceau suivant ${i}`, artist: 'Artiste' }));
    // File identique à la précédente : on ne reconstruit ni le DOM ni la mise en page.
    const key = items.map((it) => [it.title, it.artist, it.image || ''].join('\u0001')).join('\u0002');
    if (key === lastQueueKey) return;
    lastQueueKey = key;
    const list = $('pQueueList');
    list.textContent = '';
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'q-row';
      const img = document.createElement('img');
      img.className = 'q-cover';
      img.alt = '';
      if (it.image) img.src = it.image;
      else img.classList.add('empty');
      const meta = document.createElement('div');
      meta.className = 'q-meta';
      const t = document.createElement('div');
      t.className = 'q-title';
      t.textContent = it.title;
      const a = document.createElement('div');
      a.className = 'q-artist';
      a.textContent = it.artist;
      meta.append(t, a);
      row.append(img, meta);
      list.appendChild(row);
    }
    $('pQueue').classList.toggle('hidden', !items.length);
    requestAnimationFrame(placeAll);
  }
  if (bridge && bridge.onQueue) bridge.onQueue(renderQueue);

  // Éditeur de disposition (?edit=1) : voir scene-editor.js.
  if (EDIT) {
    editor = window.SceneEditor.create({
      bridge,
      NODES,
      app: () => app,
      lastQueue: () => lastQueue,
      placeAll,
      applyLayout,
      renderQueue,
    });
  }

  // Les boutons sont une petite fenêtre à part (la scène ne reçoit pas les
  // clics) : on lui indique où se placer.
  function reportControls() {
    if (EDIT || !bridge || !bridge.reportControlsRect) return;
    const visible = scene && layout().buttons.visible;
    if (!visible) {
      bridge.reportControlsRect(null);
      return;
    }
    const r = $('pControls').getBoundingClientRect();
    bridge.reportControlsRect({ x: r.left, y: r.top, width: r.width, height: r.height });
  }

  function applyLayout(s) {
    scene = isScene(s);
    document.body.style.opacity = EDIT ? 1 : (s.opacity ?? 1);
    document.body.classList.toggle('scene', scene);
    // Scène plein bureau : un pixel canvas par pixel CSS suffit (le canvas couvre tout l'écran).
    app.renderer.setMaxDpr(scene ? 1 : Infinity);
    document.body.classList.toggle('with-now', !scene && s.showNowPlaying !== false);
    $('now').classList.toggle(
      'hidden',
      scene || !(s.showNowPlaying !== false && app.state.media.active && app.state.media.title),
    );
    if (!scene) {
      app.renderer.opts = { glow: true };
      requestAnimationFrame(reportControls);
      return;
    }
    placeAll();
  }

  window.addEventListener('resize', () => requestAnimationFrame(placeAll));

  // Décors dessinés par-dessus le disque : bord lumineux, anneaux de la
  // pochette, barres.
  const barsOpts = { glow: true, t: 0, reflection: false, sensitivity: 1, reduceMotion: false };
  app.renderer.hooks.push((a, now) => {
    if (!scene) return;
    const s = settings(),
      r = app.renderer,
      pal = discPalette();
    drawEdgeGlow(r.ctx, r.w, r.h, a, pal, s.edgeGlow ?? 0.8, r.reduceMotion);
    if (s.panelRing !== false && geo.pc) drawCoverRings(r.ctx, geo.pc.x, geo.pc.y, geo.pc.R, a, pal, r.reduceMotion);
    if (geo.bars) {
      const b = geo.bars,
        draw = VISUALIZERS[s.style] || VISUALIZERS.bars;
      r.ctx.save();
      r.ctx.beginPath();
      r.ctx.rect(b.x, b.y, b.w, b.h);
      r.ctx.clip();
      r.ctx.translate(b.x, b.y);
      barsOpts.t = now;
      barsOpts.sensitivity = app.engine.sensitivity;
      barsOpts.reduceMotion = r.reduceMotion;
      draw(r.ctx, b.w, b.h, a, r.palette, barsOpts);
      r.ctx.restore();
    }
  });

  // Progression, paroles et message d'état audio, à chaque image. On ne
  // touche à la page que si quelque chose a changé : sinon le navigateur
  // recalcule les styles pour rien, 60 fois par seconde.
  let lastPct = '',
    lastMsg = null,
    lastSec = -1,
    lastDur = -1;
  app.renderer.hooks.push(() => {
    const m = app.state.media;
    const pos = currentPosition(m);
    const pct = m.duration ? `${((pos / m.duration) * 100).toFixed(1)}%` : '0%';
    if (pct !== lastPct) {
      lastPct = pct;
      $('bar').style.width = pct;
      if (scene) $('pBar').style.width = pct;
    }
    // Valeurs exposées aux lecteurs d'écran, au plus une fois par seconde.
    const sec = Math.floor(pos);
    if (sec !== lastSec || (m.duration || 0) !== lastDur) {
      lastSec = sec;
      lastDur = m.duration || 0;
      const text = lastDur ? `${fmt(pos)} sur ${fmt(lastDur)}` : '';
      for (const id of ['bar', 'pBar']) {
        const pb = $(id).parentElement;
        pb.setAttribute('aria-valuemax', String(Math.round(lastDur)));
        pb.setAttribute('aria-valuenow', String(sec));
        pb.setAttribute('aria-valuetext', text);
      }
    }
    if (scene && layout().lyrics.visible) lyrics.update(m, pos);
    const st = app.engine.status;
    const msg =
      st === 'no-audio' ? 'Aucun son système détecté' : st === 'error' ? 'Erreur : capture audio refusée' : '';
    if (msg !== lastMsg) {
      lastMsg = msg;
      $('status').textContent = msg;
      $('status').classList.toggle('hidden', !msg);
    }
  });

  // ----- Pause, sommeil et mode jeu -----
  // Musique en pause : scène atténuée. Sans musique pendant N minutes : scène
  // masquée et rendu arrêté, jusqu'au retour de la musique.
  let silentSince = Date.now();
  let gamePause = false;
  let asleep = false;
  function updateRest() {
    if (EDIT) return; // l'éditeur reste toujours affiché
    const s = app.state.settings;
    const playing = app.state.media.active && app.state.media.status === 'Playing';
    if (playing) silentSince = Date.now();
    const minutes = Number(s.sleepAfter ?? 0);
    asleep = !playing && minutes > 0 && Date.now() - silentSince > minutes * 60000;
    document.body.classList.toggle('is-paused', !playing && s.dimOnPause !== false && !asleep);
    document.body.classList.toggle('is-asleep', asleep);
    app.renderer.paused = gamePause || asleep;
    app.renderer.slow = !playing;
  }
  setInterval(updateRest, 2000);
  if (bridge && bridge.onMedia) bridge.onMedia(() => setTimeout(updateRest, 0));
  if (bridge && bridge.onRenderPause)
    bridge.onRenderPause((on) => {
      gamePause = on;
      updateRest();
    });

  // ----- Mode placement (bandeau) -----
  if (bridge && !EDIT) {
    bridge.onEditing((on) => {
      document.body.classList.toggle('editing', on);
      $('edit').classList.toggle('hidden', !on);
    });
    $('done').addEventListener('click', () => bridge.editDone());

    const grip = $('grip');
    grip.setAttribute('role', 'img');
    grip.setAttribute('aria-label', 'Poignée : tirer pour redimensionner la fenêtre');
    let start = null;
    grip.addEventListener('pointerdown', (e) => {
      grip.setPointerCapture(e.pointerId);
      start = { x: e.screenX, y: e.screenY, w: window.outerWidth, h: window.outerHeight };
    });
    grip.addEventListener('pointermove', (e) => {
      if (!start) return;
      bridge.resizeTo(start.w + e.screenX - start.x, start.h + e.screenY - start.y);
    });
    grip.addEventListener('pointerup', () => {
      start = null;
    });
  }
})();
