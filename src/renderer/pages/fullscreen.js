(function () {
  'use strict';
  const { currentPosition, fmt } = window.SV;
  const Catalog = window.SillonCatalog;
  const { STYLE_ORDER, THEME_ORDER } = Catalog;
  const I18n = window.SillonI18n;
  const t = I18n.t;
  const $ = (id) => document.getElementById(id);
  const bridge = window.bridge;
  // Screen saver: same page, without controls, with the disc in the middle.
  // Any action (mouse, keyboard, focus loss) closes it.
  const VEILLE = new URLSearchParams(location.search).has('veille');
  if (VEILLE) {
    document.body.classList.add('veille');
    // Tells screen readers how to leave the screen saver.
    $('veilleStatus').dataset.i18n = 'fullscreen.veille';
  }
  // Reduced motion: Sillon setting (class set by common.js) or Windows setting.
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduceMotion = () => document.body.classList.contains('reduce-motion') || reduceQuery.matches;

  // In full screen, the visualizer and the colors change here without touching the widget.
  let localStyle = null;
  let localTheme = null;
  let lastRaw = null;

  const lyrics = new window.LyricsView($('lyrics'), { maxChars: 16 });

  const volume = window.SillonVolume($('volume'));
  const app = window.SVApp.createApp($('viz'), {
    onLyrics: (l) => lyrics.set(l),
    onMedia(m, coverChanged) {
      volume.update(m);
      $('title').textContent = m.active ? m.title || '' : t('common.nothingPlaying');
      $('artist').textContent = m.active ? [m.artist, m.album].filter(Boolean).join(' · ') : '';
      const playing = m.status === 'Playing';
      $('play').innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
      $('play').setAttribute('aria-label', playing ? t('common.pause') : t('common.play'));
      // Music paused: the background stops drifting.
      document.body.classList.toggle('paused', !playing);
      if (coverChanged) {
        // The decoded cover comes from common.js (app.state.coverImg), no second decoding.
        $('cover').src = m.cover || '';
        $('roomImg').src = m.cover || '';
        $('cover').classList.toggle('hidden', !m.cover);
        $('roomImg').classList.toggle('hidden', !m.cover);
      }
    },
    transformSettings: (s) => {
      if (lastRaw && s.style !== lastRaw.style) localStyle = null;
      if (lastRaw && s.theme !== lastRaw.theme) localTheme = null;
      lastRaw = s;
      if (VEILLE) return { ...s, style: 'disc' };
      return { ...s, style: localStyle || s.style, theme: localTheme || s.theme };
    },
    onSettings: () => layout(),
    onPalette(pal) {
      $('shade').style.background =
        `radial-gradient(70% 60% at 50% 45%, transparent, rgba(0,0,0,.55)),` +
        `linear-gradient(180deg, transparent 50%, ${pal[0]}33)`;
      document.documentElement.style.setProperty('--accent', pal[1]);
    },
  });

  const apply = (s) => app.applySettings(s);

  // Placement: the ring turns around the cover, the others rise from the bottom.
  function layout() {
    const r = app.renderer;
    const w = window.innerWidth,
      h = window.innerHeight;
    const size = Math.min(w, h) * 0.34;
    if (VEILLE) {
      const radius = Math.min(w, h) * 0.17;
      const ly = $('lyrics').style;
      ly.left = `${w * 0.04}px`;
      ly.width = `${Math.max(200, w / 2 - radius * 2.3 - w * 0.04)}px`;
      ly.top = `${h * 0.5}px`;
      document.documentElement.style.setProperty('--lyr-size', `${Math.round(Math.min(h * 0.075, w * 0.045))}px`);
      veilleOpts(radius);
      return;
    }
    const coverEl = $('cover');
    coverEl.style.width = coverEl.style.height = `${size}px`;
    // Lyrics to the left of the cover.
    const ly = $('lyrics').style;
    ly.left = `${w * 0.04}px`;
    ly.width = `${Math.max(200, w / 2 - size * 0.75 - w * 0.06)}px`;
    ly.top = `${h * 0.45}px`;
    document.documentElement.style.setProperty('--lyr-size', `${Math.round(Math.min(h * 0.07, w * 0.04))}px`);
    const isRing = r.style === 'ring';
    document.body.classList.toggle('ring-mode', isRing);
    r.opts = isRing
      ? { glow: true, cx: w / 2, cy: h / 2, radius: size * 0.5 * 1.08 }
      : { glow: true, reflection: false };
  }
  window.addEventListener('resize', layout);

  function veilleOpts(radius) {
    const w = window.innerWidth,
      h = window.innerHeight;
    const st = app.state;
    app.renderer.opts = {
      glow: true,
      cx: w / 2,
      cy: h / 2,
      radius: radius || Math.min(w, h) * 0.17,
      image: st.coverImg,
      intensity: st.settings.discIntensity ?? 1.3,
      spin: st.media.status === 'Playing',
      halo: (st.albumPalette && st.albumPalette[0]) || app.renderer.palette[0],
      palette: st.albumPalette || null,
      rays: st.settings.discRays || 'fine',
      bloom: st.settings.discBloom ?? 0.8,
    };
    // Fixed colors (or the wheel's) picked for the disc, otherwise the cover's.
    const fixed = window.SV.themePalette(st.settings.discColors, st.settings.customColor);
    if (fixed) {
      app.renderer.opts.palette = fixed;
      app.renderer.opts.halo = fixed[0];
    }
  }

  // ----- Ripples on the bass beat -----
  const rc = $('ripples');
  const rctx = rc.getContext('2d');
  const ripples = [];
  function sizeRipples() {
    rc.width = window.innerWidth * devicePixelRatio;
    rc.height = window.innerHeight * devicePixelRatio;
    rctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  sizeRipples();
  window.addEventListener('resize', sizeRipples);

  let coverPulse = 0;
  let hadRipples = false;
  let lastPct = '';
  let lastTime = '';
  let lastSecond = -1;
  const bar = $('bar');
  const progress = bar.parentElement;
  app.renderer.hooks.push((a) => {
    const w = window.innerWidth,
      h = window.innerHeight;
    const base = Math.min(w, h) * 0.17;
    const still = reduceMotion();
    // No ripples or pulsing when motion is reduced.
    if (a.beat && app.state.media.active && !still) ripples.push({ r: base, alpha: 0.5 });
    if (hadRipples || ripples.length) rctx.clearRect(0, 0, w, h);
    hadRipples = ripples.length > 0;
    rctx.strokeStyle = app.renderer.palette[2];
    for (let i = ripples.length - 1; i >= 0; i--) {
      const p = ripples[i];
      p.r += 4 + p.r * 0.012;
      p.alpha *= 0.965;
      if (p.alpha < 0.02) {
        ripples.splice(i, 1);
        continue;
      }
      rctx.globalAlpha = p.alpha;
      rctx.lineWidth = 2;
      rctx.beginPath();
      rctx.arc(w / 2, h / 2, p.r, 0, Math.PI * 2);
      rctx.stroke();
    }
    rctx.globalAlpha = 1;
    coverPulse = still ? 0 : coverPulse * 0.85 + a.bass * 0.15;
    $('cover').style.transform = `translate(-50%, -50%) scale(${1 + coverPulse * 0.04})`;

    const m = app.state.media;
    const pos = currentPosition(m);
    if (VEILLE) veilleOpts();
    // Only write to the DOM when the displayed value changed.
    const pct = m.duration ? `${Math.round((pos / m.duration) * 1000) / 10}%` : '0%';
    if (pct !== lastPct) {
      lastPct = pct;
      bar.style.width = pct;
    }
    const time = m.duration ? `${fmt(pos)} / ${fmt(m.duration)}` : '';
    if (time !== lastTime) {
      lastTime = time;
      $('time').textContent = time;
    }
    // Position bar announced to screen readers: at most one update per second.
    const sec = m.duration ? Math.floor(pos) : -1;
    if (sec !== lastSecond) {
      lastSecond = sec;
      if (m.duration) {
        progress.setAttribute('aria-valuemax', String(Math.round(m.duration)));
        progress.setAttribute('aria-valuenow', String(sec));
        progress.setAttribute('aria-valuetext', t('common.positionOf', { pos: fmt(pos), total: fmt(m.duration) }));
      } else {
        progress.setAttribute('aria-valuemax', '0');
        progress.setAttribute('aria-valuenow', '0');
        progress.removeAttribute('aria-valuetext');
      }
    }
    const showLyrics = app.state.settings.showLyrics !== false;
    $('lyrics').classList.toggle('hidden', !showLyrics);
    if (showLyrics) lyrics.update(m, pos);
  });

  // ----- Controls -----
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove('show'), 1400);
  }
  const cmd = (c) => bridge && bridge.command(c);
  $('prev').onclick = () => cmd('previous');
  $('next').onclick = () => cmd('next');
  $('play').onclick = () => cmd('playpause');
  $('settingsBtn').onclick = () => bridge && bridge.openSettings();

  // ----- Leaving the screen saver -----
  if (VEILLE && bridge) {
    const started = performance.now();
    let origin = null;
    let gone = false;
    // Grace delay: the shortcut keys are still being released at launch.
    const leave = () => {
      if (gone || performance.now() - started < 1500) return;
      gone = true;
      bridge.veilleExit();
    };
    window.addEventListener('mousemove', (e) => {
      if (!origin) {
        origin = { x: e.screenX, y: e.screenY };
        return;
      }
      if (Math.hypot(e.screenX - origin.x, e.screenY - origin.y) > 12) leave();
    });
    for (const ev of ['mousedown', 'wheel', 'keydown', 'touchstart']) {
      window.addEventListener(
        ev,
        (e) => {
          e.preventDefault();
          leave();
        },
        { capture: true, passive: false },
      );
    }
    window.addEventListener('blur', leave);
  }

  // A focused control only keeps the keys it handles itself:
  // Space and Enter on a button, arrows on a slider or a list. After clicking
  // a button, V, C, [, ] and the arrows therefore keep working.
  function keepsKey(el, e) {
    if (!el) return false;
    const tag = el.tagName;
    const arrows = e.key.startsWith('Arrow');
    if (tag === 'BUTTON') return e.code === 'Space' || e.key === 'Enter';
    if (tag === 'A') return e.key === 'Enter';
    if (tag === 'SELECT' || tag === 'TEXTAREA') return arrows || e.code === 'Space';
    if (tag === 'INPUT') return el.type === 'range' ? arrows || e.code === 'Space' : true;
    return false;
  }
  window.addEventListener('keydown', (e) => {
    if (VEILLE) return;
    if (e.key === 'Escape') {
      if (bridge) bridge.closeFullscreen();
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey || keepsKey(e.target, e)) return;
    const s = app.state.settings;
    if (e.code === 'Space') {
      e.preventDefault();
      cmd('playpause');
    } else if (e.key === 'ArrowRight') cmd('next');
    else if (e.key === 'ArrowLeft') cmd('previous');
    else if (e.key === 'v' || e.key === 'V') {
      const cur = localStyle || s.style || 'bars';
      localStyle = STYLE_ORDER[(STYLE_ORDER.indexOf(cur) + 1) % STYLE_ORDER.length];
      apply(s);
      toast(Catalog.name('style', localStyle, t));
    } else if (e.key === 'c' || e.key === 'C') {
      const cur = localTheme || s.theme || 'wallpaper';
      localTheme = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
      apply(s);
      toast(Catalog.name('theme', localTheme, t));
    } else if (e.key === '[' || e.key === ']') {
      // Lyrics offset for this track.
      const d = e.key === ']' ? 0.25 : -0.25;
      bridge && bridge.nudgeLyrics(d);
      toast(t(d > 0 ? 'fullscreen.lyricsEarlier' : 'fullscreen.lyricsLater'));
    } else if (e.key === '?' || e.key === 'h' || e.key === 'H') {
      // Shortcut help, shown or hidden.
      document.body.classList.toggle('show-keys');
    }
  });

  // The buttons fade out when the mouse stops moving.
  let idle;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idle);
    idle = setTimeout(() => document.body.classList.add('idle'), 2500);
  }
  window.addEventListener('mousemove', wake);
  // Keyboard or screen reader: the buttons must come back with the focus.
  window.addEventListener('keydown', wake);
  window.addEventListener('focusin', wake);
  wake();
  layout();
  // Texts written from code (title, play button) follow the language too.
  I18n.onChange(() => app.applyMedia({ ...app.state.media, coverKept: true }));
  I18n.start(bridge);
})();
