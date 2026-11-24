(function () {
  'use strict';
  const { currentPosition, fmt, themePalette, VISUALIZERS, drawEdgeGlow, drawCoverRings } = window.SV;
  const SL = window.SceneLayout;
  const I18n = window.SillonI18n;
  const t = I18n.t;
  const $ = (id) => document.getElementById(id);
  const bridge = window.bridge;

  // ?edit=1: layout editor (separate window, in the foreground).
  const EDIT = new URLSearchParams(location.search).has('edit');

  // Scene (elements placed across the desktop) or strip.
  const isScene = (s) => EDIT || (s.layout !== 'strip' && s.mode === 'wallpaper');
  let scene = false;
  let coverImg = null;
  let lastTitle = null;
  let titleTimer = null;

  // Displayed layout: the settings' one, or the editor's draft.
  // While editing, the layout and the changed options are the editor's (scene-editor.js).
  let editor = null;
  const settings = () => (editor ? editor.settings() : app.state.settings);
  // Recomputed only when the settings change (called every frame).
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
  // Lyrics and title announced by screen readers (without interrupting what is being read).
  $('lyrics').setAttribute('aria-live', 'polite');
  $('pInfo').setAttribute('aria-live', 'polite');

  const app = window.SVApp.createApp($('viz'), {
    onMedia(m, coverChanged) {
      const show = app ? app.state.settings.showNowPlaying !== false : true;
      $('now').classList.toggle('hidden', !(m.active && m.title && show) || scene);
      $('title').textContent = m.title || '';
      $('artist').textContent = [m.artist, m.album].filter(Boolean).join(' · ');
      $('pTitle').textContent = m.active ? m.title || '' : t('common.nothingPlaying');
      $('pArtist').textContent = m.active ? [m.artist, m.album].filter(Boolean).join(' · ') : '';
      if (coverChanged) {
        $('cover').src = m.cover || '';
        $('cover').classList.toggle('hidden', !m.cover);
        $('pCover').src = m.cover || '';
        $('pCover').classList.toggle('empty', !m.cover);
        // Image decoded only once per cover (created in common.js).
        coverImg = m.cover && app ? app.state.coverImg : null;
      }
      // New track: the title in very large type for a few seconds.
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
    // In the editor, the title stays visible so it can be placed.
    if (!EDIT) titleTimer = setTimeout(() => $('bigTitle').classList.remove('show'), 5000);
    if (scene) requestAnimationFrame(placeAll);
  }

  // ----- Placing the elements -----
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
  // Elements enlarged with transform (text); the others change their real size.
  const SCALED = new Set(['info', 'buttons', 'queue', 'clock']);
  // Elements kept entirely on screen (the cover and the disc may overflow).
  const KEEP_INSIDE = new Set(['title', 'info', 'buttons', 'queue', 'clock', 'lyrics', 'bars']);

  function placeAll() {
    if (!scene) return;
    const W = window.innerWidth,
      H = window.innerHeight;
    const L = layout();
    const base = Math.min(W, H);
    // Base text size of the scene (the clock uses it), and lyrics size, set on
    // the lyrics alone: enlarging one does not touch the other.
    const textBase = Math.round(Math.min(H * 0.075, W * 0.045));
    document.documentElement.style.setProperty('--scene-text', `${textBase}px`);
    $('lyrics').style.setProperty('--lyr-size', `${Math.round(textBase * L.lyrics.scale)}px`);
    document.documentElement.style.setProperty(
      '--title-size',
      `${Math.round(Math.min(W * 0.075, H * 0.14) * L.title.scale)}px`,
    );

    // Disc (drawn in the canvas): radius and grab area.
    geo.cx = W * L.disc.x;
    geo.cy = H * L.disc.y;
    geo.r = base * 0.13 * L.disc.scale;
    geo.discOn = L.disc.visible;
    const reach = geo.r * (1.6 + 0.6 * (settings().discIntensity ?? 1.3));
    size('disc', reach * 2, reach * 2);
    // Panel cover.
    const R = Math.round(Math.min(H * 0.13, 120) * L.cover.scale);
    size('cover', R * 2, R * 2);
    // Lyrics and bars: width (and height) as a fraction of the screen.
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
      // Do not overflow the screen (text longer than expected, enlarged element).
      const r = n.getBoundingClientRect();
      const dx = r.left < 0 ? -r.left : r.right > W ? W - r.right : 0;
      const dy = r.top < 0 ? -r.top : r.bottom > H ? H - r.bottom : 0;
      if (dx || dy) {
        n.style.left = `${W * el.x + dx}px`;
        n.style.top = `${H * el.y + dy}px`;
      }
    }
  }

  // Disc colors: the cover's, a fixed theme or the wheel's color.
  function discPalette() {
    const st = app.state,
      s = settings(),
      fixed = themePalette(s.discColors || 'album', s.customColor);
    if (fixed) return fixed;
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

  // Clock.
  function updateClock() {
    const d = new Date();
    const lang = I18n.language();
    $('clockTime').textContent = d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
    $('clockDate').textContent = d.toLocaleDateString(lang, { weekday: 'long', day: 'numeric', month: 'long' });
  }
  updateClock();
  setInterval(updateClock, 5000);

  // Queue (if the Spotify account is connected in the settings).
  let lastQueue = { items: [] };
  let lastQueueKey = null;
  function renderQueue(q) {
    lastQueue = q || { items: [] };
    let items = lastQueue.items || [];
    // In the editor, a sample queue to see how much room it takes.
    if (EDIT && !items.length)
      items = [1, 2, 3].map((n) => ({ title: t('widget.sampleTrack', { n }), artist: t('widget.sampleArtist') }));
    // Same queue as before: rebuild neither the DOM nor the layout.
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

  // Layout editor (?edit=1): see scene-editor.js.
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

  // The buttons are a small separate window (the scene does not receive
  // clicks): tell it where to go.
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
    // Full-desktop scene: one canvas pixel per CSS pixel is enough (the canvas covers the whole screen).
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

  // Decorations drawn over the disc: glowing edge, cover rings,
  // bars.
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

  // Progress, lyrics and audio status message, every frame. The page is only
  // touched when something changed: otherwise the browser recomputes the
  // styles for nothing, 60 times per second.
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
    // Values exposed to screen readers, at most once per second.
    const sec = Math.floor(pos);
    if (sec !== lastSec || (m.duration || 0) !== lastDur) {
      lastSec = sec;
      lastDur = m.duration || 0;
      const text = lastDur ? t('common.positionOf', { pos: fmt(pos), total: fmt(lastDur) }) : '';
      for (const id of ['bar', 'pBar']) {
        const pb = $(id).parentElement;
        pb.setAttribute('aria-valuemax', String(Math.round(lastDur)));
        pb.setAttribute('aria-valuenow', String(sec));
        pb.setAttribute('aria-valuetext', text);
      }
    }
    if (scene && layout().lyrics.visible) lyrics.update(m, pos);
    const st = app.engine.status;
    const msg = st === 'no-audio' ? t('widget.noAudio') : st === 'error' ? t('widget.captureDenied') : '';
    if (msg !== lastMsg) {
      lastMsg = msg;
      $('status').textContent = msg;
      $('status').classList.toggle('hidden', !msg);
    }
  });

  // ----- Pause, sleep and game mode -----
  // Music paused: dimmed scene. No music for N minutes: scene hidden and
  // rendering stopped, until the music comes back.
  let silentSince = Date.now();
  let gamePause = false;
  let asleep = false;
  function updateRest() {
    if (EDIT) return; // the editor always stays shown
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

  // ----- Placement mode (strip) -----
  if (bridge && !EDIT) {
    bridge.onEditing((on) => {
      document.body.classList.toggle('editing', on);
      $('edit').classList.toggle('hidden', !on);
    });
    $('done').addEventListener('click', () => bridge.editDone());
    // Escape or Enter: finish too (placement window, see widget-window.js).
    window.addEventListener('keydown', (e) => {
      if (document.body.classList.contains('editing') && (e.key === 'Escape' || e.key === 'Enter')) bridge.editDone();
    });

    const grip = $('grip');
    grip.setAttribute('role', 'img');
    grip.dataset.i18nAttr = 'title:widget.resize;aria-label:widget.grip';
    grip.setAttribute('aria-label', t('widget.grip'));
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

  // Texts written from code follow the language: clock, "nothing playing", sample queue.
  I18n.onChange(() => {
    updateClock();
    app.applyMedia({ ...app.state.media, coverKept: true });
    if (EDIT) {
      lastQueueKey = null;
      renderQueue(lastQueue);
    }
  });
  I18n.start(bridge);
})();
