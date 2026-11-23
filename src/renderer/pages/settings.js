/* Fenêtre de paramètres : chaque changement est appliqué tout de suite. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const bridge = window.bridge;

  const selects = [
    'layout',
    'theme',
    'discRays',
    'discColors',
    'mode',
    'preferApp',
    'fps',
    'veilleDelay',
    'sceneScreen',
    'sleepAfter',
    'audioSource',
  ];
  const checks = [
    'showNowPlaying',
    'showLyrics',
    'launchAtLogin',
    'veilleOnlyPlaying',
    'veilleLock',
    'gameMode',
    'dimOnPause',
    'autoUpdate',
    'reduceMotion',
  ];
  const numeric = new Set(['fps', 'veilleDelay', 'sleepAfter']);
  const pct = (v) => `${Math.round(v * 100)} %`;
  const times = (v) => `× ${v.toFixed(1)}`;
  // Pour chaque curseur : texte affiché, et texte lu par les lecteurs d'écran (avec l'unité).
  const ranges = {
    sensitivity: { show: times, say: (v) => `multiplié par ${v.toFixed(1).replace('.', ',')}` },
    opacity: { show: pct, say: (v) => `${Math.round(v * 100)} pour cent` },
    discIntensity: { show: times, say: (v) => `multiplié par ${v.toFixed(1).replace('.', ',')}` },
    discBloom: {
      show: (v) => (v ? times(v) : 'aucune'),
      say: (v) => (v ? `multiplié par ${v.toFixed(1).replace('.', ',')}` : 'aucune'),
    },
    edgeGlow: {
      show: (v) => (v ? times(v) : 'aucun'),
      say: (v) => (v ? `multiplié par ${v.toFixed(1).replace('.', ',')}` : 'aucun'),
    },
  };
  function showRange(k, v) {
    $(`${k}Out`).textContent = ranges[k].show(v);
    $(k).setAttribute('aria-valuetext', ranges[k].say(v));
  }

  // Le focus arrive sur le titre à l'ouverture : le lecteur d'écran annonce la fenêtre.
  $('pageTitle').focus({ preventScroll: true });

  // ----- Galerie des visualiseurs : aperçus animés -----
  const { VISUALIZERS, THEMES, FakeAudio } = window.SV;
  const gallery = [...document.querySelectorAll('#styleGallery button')];
  let current = {};
  const fake = new FakeAudio();
  // Animations réduites : réglage Sillon ou réglage Windows. Les aperçus restent figés.
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const still = () => !!current.reduceMotion || motionQuery.matches;
  let needsPaint = true;
  motionQuery.addEventListener('change', () => {
    document.body.classList.toggle('reduce-motion', still());
    needsPaint = true;
  });
  for (const b of gallery) b.onclick = () => bridge.setSettings({ style: b.dataset.style });
  // Groupe de boutons radio : une seule tabulation, flèches pour changer de style.
  for (const [i, b] of gallery.entries()) {
    b.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = gallery[(i + step + gallery.length) % gallery.length];
      next.focus();
      bridge.setSettings({ style: next.dataset.style });
    });
  }
  // Légèreté : on ne dessine que les aperçus visibles, à 30 i/s, et rien
  // pendant le défilement (sinon la fenêtre saccade). Les tailles sont lues
  // une fois par l'observateur, pas à chaque image.
  const previews = gallery.map((b) => ({ b, c: b.querySelector('canvas'), w: 0, h: 0, visible: false }));
  const dpr = window.devicePixelRatio || 1;
  const sizes = new ResizeObserver((entries) => {
    for (const e of entries) {
      const p = previews.find((x) => x.c === e.target);
      p.w = e.contentRect.width;
      p.h = e.contentRect.height;
      p.c.width = Math.round(p.w * dpr);
      p.c.height = Math.round(p.h * dpr);
    }
    needsPaint = true;
  });
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) previews.find((x) => x.c === e.target).visible = e.isIntersecting;
    needsPaint = true;
  });
  for (const p of previews) {
    sizes.observe(p.c);
    seen.observe(p.c);
  }
  let scrolling = 0,
    lastDraw = 0;
  document.querySelector('main').addEventListener(
    'scroll',
    () => {
      clearTimeout(scrolling);
      scrolling = setTimeout(() => {
        scrolling = 0;
      }, 180);
    },
    { passive: true },
  );
  function drawGallery(now) {
    requestAnimationFrame(drawGallery);
    if (scrolling || now - lastDraw < 1000 / 30 - 2) return;
    // Aperçus figés : une seule image fixe, redessinée seulement si quelque chose a changé.
    const frozen = still();
    if (frozen && !needsPaint) return;
    needsPaint = false;
    lastDraw = now;
    const t = frozen ? 1500 : now;
    const a = fake.frame(t);
    const pal = THEMES[current.theme] || THEMES.violet;
    for (const p of previews) {
      if (!p.visible || !p.w) continue;
      const ctx = p.c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, p.w, p.h);
      VISUALIZERS[p.b.dataset.style](ctx, p.w, p.h, a, pal, { glow: true, t, reflection: false, sensitivity: 1 });
    }
  }
  requestAnimationFrame(drawGallery);

  function fill(s) {
    const defaults = {
      layout: 'scene',
      sceneScreen: 'primary',
      sleepAfter: 5,
      discRays: 'fine',
      discColors: 'album',
      audioSource: 'app',
    };
    for (const k of selects) if (document.activeElement !== $(k)) $(k).value = String(s[k] ?? defaults[k] ?? '');
    $('showNowPlaying').checked = s.showNowPlaying !== false;
    $('showLyrics').checked = s.showLyrics !== false;
    current = s;
    $('reduceMotion').checked = !!s.reduceMotion;
    document.body.classList.toggle('reduce-motion', still());
    needsPaint = true;
    const style = s.style || 'bars';
    for (const b of gallery) {
      const on = b.dataset.style === style;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    $('launchAtLogin').checked = !!s.launchAtLogin;
    if (document.activeElement !== $('spotifyClientId')) $('spotifyClientId').value = s.spotifyClientId || '';
    $('spotifyCustomClientId').checked = !!s.spotifyCustomClientId;
    $('customClient').classList.toggle('hidden', !s.spotifyCustomClientId);
    $('builtinHelp').classList.toggle('hidden', !!s.spotifyCustomClientId);
    $('veilleOnlyPlaying').checked = s.veilleOnlyPlaying !== false;
    $('veilleLock').checked = s.veilleLock !== false;
    $('gameMode').checked = s.gameMode !== false;
    $('autoUpdate').checked = s.autoUpdate !== false;
    $('dimOnPause').checked = s.dimOnPause !== false;
    // Scène choisie et réellement affichée (seulement sur le fond d'écran).
    const wantsScene = (s.layout || 'scene') !== 'strip';
    const scene = wantsScene && s.mode === 'wallpaper';
    $('sceneSection').classList.toggle('hidden', !scene);
    $('sceneScreenRow').classList.toggle('hidden', !scene);
    $('sceneNeedsWallpaper').classList.toggle('hidden', !(wantsScene && s.mode !== 'wallpaper'));
    $('showNowPlayingRow').classList.toggle('hidden', scene);
    // La scène occupe tout le bureau : rien à déplacer.
    $('editRow').classList.toggle('hidden', scene);
    for (const k of Object.keys(ranges)) {
      if (document.activeElement !== $(k)) $(k).value = s[k];
      showRange(k, Number(s[k]));
    }
  }

  for (const k of selects) {
    $(k).addEventListener('change', () => {
      const v = $(k).value;
      bridge.setSettings({ [k]: numeric.has(k) ? Number(v) : v });
    });
  }
  for (const k of checks) $(k).addEventListener('change', () => bridge.setSettings({ [k]: $(k).checked }));
  for (const k of Object.keys(ranges)) {
    $(k).addEventListener('input', () => {
      const v = Number($(k).value);
      showRange(k, v);
      bridge.setSettings({ [k]: v });
    });
  }

  $('edit').onclick = () => bridge.startEditing();
  $('resetBounds').onclick = () => bridge.resetBounds();
  $('veilleNow').onclick = () => bridge.startVeille();
  $('close').onclick = () => window.close();
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.close();
  });

  // ----- Compte Spotify -----
  $('spotifyClientId').addEventListener('change', () =>
    bridge.setSettings({ spotifyClientId: $('spotifyClientId').value.trim() }),
  );
  $('spotifyCustomClientId').addEventListener('change', () => {
    bridge.setSettings({ spotifyCustomClientId: $('spotifyCustomClientId').checked });
    setTimeout(() => bridge.spotifyStatus().then(showSpotify), 150);
  });
  $('spotifyLogin').onclick = () => {
    if ($('spotifyCustomClientId').checked) bridge.setSettings({ spotifyClientId: $('spotifyClientId').value.trim() });
    $('spotifyState').textContent = 'Connexion en cours dans ton navigateur…';
    $('spotifyState').className = 'state';
    setTimeout(() => bridge.spotifyLogin(), 200);
  };
  $('spotifyLogout').onclick = () => bridge.spotifyLogout();
  $('dashboard').onclick = () => bridge.openSpotifyDashboard();
  $('copyRedirect').onclick = async () => {
    await navigator.clipboard.writeText($('redirectUri').textContent);
    $('copyRedirect').textContent = 'Copié';
    setTimeout(() => {
      $('copyRedirect').textContent = 'Copier';
    }, 1500);
  };
  function showSpotify(st) {
    if (!st) return;
    if (st.redirectUri) $('redirectUri').textContent = st.redirectUri;
    $('spotifyLogin').textContent = st.connected ? 'Se reconnecter' : 'Se connecter à Spotify';
    $('spotifyLogout').classList.toggle('hidden', !st.connected);
    const el = $('spotifyState');
    el.textContent = st.error
      ? `Erreur : ${st.error}`
      : !st.connected
        ? 'Non connecté.'
        : st.needsReconnect
          ? 'Connecté. Clique sur « Se reconnecter » pour activer aussi les boutons aléatoire et répétition.'
          : "Connecté : file d'attente, aléatoire et répétition actifs.";
    el.className = `state${st.error ? ' error' : st.connected ? ' ok' : ''}`;
  }
  bridge.onSpotifyStatus(showSpotify);
  bridge.spotifyStatus().then(showSpotify);

  // ----- Mises à jour -----
  function showUpdate(u) {
    if (!u) return;
    const el = $('updateState');
    const v = `Version installée : ${u.current}. `;
    const text =
      {
        dev: 'Mode développement (npm start) : pas de mise à jour automatique.',
        portable: 'Version portable : pas de mise à jour automatique (télécharge la nouvelle version à la main).',
        idle: `${v}`,
        checking: `${v}Recherche en cours…`,
        uptodate: `${v}Sillon est à jour.`,
        downloading: `${v}Téléchargement de la version ${u.version}… ${u.progress} %`,
        ready: `Version ${u.version} prête : elle s'installera à la fermeture, ou maintenant.`,
        error: `Erreur : ${v}${u.error}`,
      }[u.state] || v;
    el.textContent = text;
    el.className = `state${u.state === 'error' ? ' error' : u.state === 'ready' || u.state === 'uptodate' ? ' ok' : ''}`;
    $('checkUpdates').disabled = !u.enabled;
    $('autoUpdate').disabled = !u.enabled;
    $('installUpdate').classList.toggle('hidden', u.state !== 'ready');
  }
  $('checkUpdates').onclick = () => bridge.checkUpdates();
  $('installUpdate').onclick = () => bridge.installUpdate();
  bridge.onUpdateStatus(showUpdate);
  bridge.updateStatus().then(showUpdate);

  // ----- Diagnostic -----
  $('openLayout').onclick = () => bridge.openLayoutEditor();
  $('copyDiagnostic').onclick = async () => {
    const el = $('diagnosticState');
    try {
      await bridge.copyDiagnostic();
      el.textContent = 'Réussi : copié dans le presse-papiers, colle-le (Ctrl+V) dans ton message.';
      el.className = 'state ok';
    } catch (e) {
      el.textContent = `Erreur : impossible de copier (${e.message})`;
      el.className = 'state error';
    }
  };

  bridge.onSettings(fill);
  bridge.getSettings().then(fill);
})();
