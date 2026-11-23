(function () {
  'use strict';
  const { currentPosition, fmt } = window.SV;
  const { STYLE_ORDER, THEME_ORDER, STYLE_NAMES, THEME_NAMES } = window.SillonCatalog;
  const $ = (id) => document.getElementById(id);
  const bridge = window.bridge;
  // Écran de veille : même page, sans commandes, avec le disque au centre.
  // Toute action (souris, clavier, perte du focus) la ferme.
  const VEILLE = new URLSearchParams(location.search).has('veille');
  if (VEILLE) {
    document.body.classList.add('veille');
    // Annonce aux lecteurs d'écran comment quitter la veille.
    $('veilleStatus').textContent = 'Écran de veille : appuie sur une touche pour quitter';
  }
  // Animations réduites : réglage Sillon (classe posée par common.js) ou réglage Windows.
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduceMotion = () => document.body.classList.contains('reduce-motion') || reduceQuery.matches;

  // En plein écran, le visualiseur et les couleurs se changent ici sans toucher au widget.
  let localStyle = null;
  let localTheme = null;
  let lastRaw = null;

  const lyrics = new window.LyricsView($('lyrics'), { maxChars: 16 });

  const volume = window.SillonVolume($('volume'));
  const app = window.SVApp.createApp($('viz'), {
    onLyrics: (l) => lyrics.set(l),
    onMedia(m, coverChanged) {
      volume.update(m);
      $('title').textContent = m.active ? m.title || '' : 'Rien en lecture';
      $('artist').textContent = m.active ? [m.artist, m.album].filter(Boolean).join(' · ') : '';
      const playing = m.status === 'Playing';
      $('play').innerHTML = playing ? '&#10074;&#10074;' : '&#9654;';
      $('play').setAttribute('aria-label', playing ? 'Pause' : 'Lecture');
      // Musique en pause : le fond cesse de dériver.
      document.body.classList.toggle('paused', !playing);
      if (coverChanged) {
        // La pochette décodée vient de common.js (app.state.coverImg), pas d'un second décodage.
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

  // Placement : l'anneau tourne autour de la pochette, les autres montent du bas.
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
    // Paroles à gauche de la pochette.
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
    // Couleurs fixes choisies pour le disque (sinon celles de la pochette).
    const c = st.settings.discColors;
    if (c && c !== 'album' && window.SV.THEMES[c]) {
      app.renderer.opts.palette = window.SV.THEMES[c];
      app.renderer.opts.halo = window.SV.THEMES[c][0];
    }
  }

  // ----- Ondes au rythme des basses -----
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
    // Pas d'ondes ni de pulsation si les animations sont réduites.
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
    // On n'écrit dans le DOM que si la valeur affichée a changé.
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
    // Barre de position annoncée aux lecteurs d'écran : une mise à jour par seconde au plus.
    const sec = m.duration ? Math.floor(pos) : -1;
    if (sec !== lastSecond) {
      lastSecond = sec;
      if (m.duration) {
        progress.setAttribute('aria-valuemax', String(Math.round(m.duration)));
        progress.setAttribute('aria-valuenow', String(sec));
        progress.setAttribute('aria-valuetext', `${fmt(pos)} sur ${fmt(m.duration)}`);
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

  // ----- Commandes -----
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

  // ----- Sortie de veille -----
  if (VEILLE && bridge) {
    const started = performance.now();
    let origin = null;
    let gone = false;
    // Délai de grâce : les touches du raccourci sont encore relâchées au lancement.
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

  // Un contrôle qui a le focus ne garde que les touches qu'il gère lui-même :
  // Espace et Entrée sur un bouton, flèches sur un curseur ou une liste. Après un
  // clic sur un bouton, V, C, [, ] et les flèches continuent donc de marcher.
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
      toast(STYLE_NAMES[localStyle]);
    } else if (e.key === 'c' || e.key === 'C') {
      const cur = localTheme || s.theme || 'wallpaper';
      localTheme = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
      apply(s);
      toast(THEME_NAMES[localTheme]);
    } else if (e.key === '[' || e.key === ']') {
      // Décalage des paroles pour ce morceau.
      const d = e.key === ']' ? 0.25 : -0.25;
      bridge && bridge.nudgeLyrics(d);
      toast(`Paroles ${d > 0 ? 'plus tôt' : 'plus tard'} (${d > 0 ? '+' : '−'}0,25 s)`);
    }
  });

  // Les boutons disparaissent quand la souris ne bouge plus.
  let idle;
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idle);
    idle = setTimeout(() => document.body.classList.add('idle'), 2500);
  }
  window.addEventListener('mousemove', wake);
  // Clavier ou lecteur d'écran : les boutons doivent réapparaître avec le focus.
  window.addEventListener('keydown', wake);
  window.addEventListener('focusin', wake);
  wake();
  layout();
})();
