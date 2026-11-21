(function () {
  'use strict';
  const { currentPosition, fmt, STYLE_ORDER, THEME_ORDER } = window.SV;
  const $ = (id) => document.getElementById(id);
  const bridge = window.bridge;

  const STYLE_NAMES = { bars: 'Barres', mirror: 'Miroir', ring: 'Anneau', wave: 'Onde', aurora: 'Aurore' };
  const THEME_NAMES = { wallpaper: "Couleurs du fond d'écran", album: 'Couleurs de la pochette', spotify: 'Spotify', neon: 'Néon', sunset: 'Coucher de soleil', ocean: 'Océan', mono: 'Blanc' };

  // En plein écran, le visualiseur et les couleurs se changent ici sans toucher au widget.
  let localStyle = null;
  let localTheme = null;
  let lastRaw = null;

  const app = window.SVApp.createApp($('viz'), {
    onMedia(m, coverChanged) {
      $('title').textContent = m.active ? (m.title || '') : 'Rien en lecture';
      $('artist').textContent = m.active ? [m.artist, m.album].filter(Boolean).join(' · ') : '';
      $('play').innerHTML = m.status === 'Playing' ? '&#10074;&#10074;' : '&#9654;';
      if (coverChanged) {
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
    const w = window.innerWidth, h = window.innerHeight;
    const size = Math.min(w, h) * 0.34;
    const coverEl = $('cover');
    coverEl.style.width = coverEl.style.height = `${size}px`;
    const isRing = r.style === 'ring';
    document.body.classList.toggle('ring-mode', isRing);
    r.opts = isRing
      ? { glow: true, cx: w / 2, cy: h / 2, radius: size * 0.5 * 1.08 }
      : { glow: true, reflection: false };
  }
  window.addEventListener('resize', layout);

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
  app.renderer.hooks.push((a) => {
    const w = window.innerWidth, h = window.innerHeight;
    const base = Math.min(w, h) * 0.17;
    if (a.beat && app.state.media.active) ripples.push({ r: base, alpha: 0.5 });
    rctx.clearRect(0, 0, w, h);
    rctx.strokeStyle = app.renderer.palette[2];
    for (let i = ripples.length - 1; i >= 0; i--) {
      const p = ripples[i];
      p.r += 4 + p.r * 0.012;
      p.alpha *= 0.965;
      if (p.alpha < 0.02) { ripples.splice(i, 1); continue; }
      rctx.globalAlpha = p.alpha;
      rctx.lineWidth = 2;
      rctx.beginPath(); rctx.arc(w / 2, h / 2, p.r, 0, Math.PI * 2); rctx.stroke();
    }
    rctx.globalAlpha = 1;
    coverPulse = coverPulse * 0.85 + a.bass * 0.15;
    $('cover').style.transform = `translate(-50%, -50%) scale(${1 + coverPulse * 0.04})`;

    const m = app.state.media;
    const pos = currentPosition(m);
    $('bar').style.width = m.duration ? `${(pos / m.duration) * 100}%` : '0%';
    $('time').textContent = m.duration ? `${fmt(pos)} / ${fmt(m.duration)}` : '';
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

  window.addEventListener('keydown', (e) => {
    const s = app.state.settings;
    if (e.code === 'Space') { e.preventDefault(); cmd('playpause'); }
    else if (e.key === 'ArrowRight') cmd('next');
    else if (e.key === 'ArrowLeft') cmd('previous');
    else if (e.key === 'v' || e.key === 'V') {
      const cur = localStyle || s.style || 'bars';
      localStyle = STYLE_ORDER[(STYLE_ORDER.indexOf(cur) + 1) % STYLE_ORDER.length];
      apply(s); toast(STYLE_NAMES[localStyle]);
    } else if (e.key === 'c' || e.key === 'C') {
      const cur = localTheme || s.theme || 'wallpaper';
      localTheme = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length];
      apply(s); toast(THEME_NAMES[localTheme]);
    } else if (e.key === 'Escape') {
      if (bridge) bridge.closeFullscreen();
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
  wake();
  layout();
})();
