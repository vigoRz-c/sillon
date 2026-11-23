/* Fenêtre de paramètres : chaque changement est appliqué tout de suite.
 * Sections en onglets (menu à gauche), recherche dans tous les réglages,
 * aperçu en direct du visualiseur et pastilles de couleurs. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const bridge = window.bridge;
  const Catalog = window.SillonCatalog;

  const selects = [
    'layout',
    'discRays',
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

  // ----- Groupes de boutons radio (styles, couleurs) -----
  // Une seule tabulation par groupe, flèches / Début / Fin pour changer, choix appliqué tout de suite.
  function radioGroup(buttons, choose) {
    for (const [i, b] of buttons.entries()) {
      b.addEventListener('click', () => choose(b));
      b.addEventListener('keydown', (e) => {
        const n = buttons.length;
        const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[
          e.key
        ];
        if (to === undefined) return;
        e.preventDefault();
        const next = buttons[(to + n) % n];
        next.focus();
        choose(next);
      });
    }
  }
  function check(buttons, value, key) {
    for (const b of buttons) {
      const on = b.dataset[key] === value;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
  }

  // ----- Pastilles de couleurs, rangées par familles -----
  const FAMILIES = [
    ['Image', ['wallpaper', 'album']],
    ['Classiques', ['spotify', 'neon', 'sunset', 'ocean', 'violet', 'mono']],
    ['Vifs', ['cyberpunk', 'synthwave', 'acid']],
    ['Doux', ['pastel', 'lavender', 'peach', 'mint']],
    ['Naturels', ['forest', 'fire', 'ice', 'desert']],
    ['Sombres', ['gold', 'blood', 'midnight']],
  ];
  // Noms courts sous les pastilles « image » (le nom complet du catalogue est trop long).
  const SHORT = { wallpaper: "Fond d'écran", album: 'Pochette' };

  function buildSwatches(container, allowed) {
    const names = Catalog.THEME_NAMES;
    const placed = new Set(FAMILIES.flatMap(([, ids]) => ids));
    // Un jeu ajouté au catalogue sans famille reste choisissable.
    const extra = Catalog.THEME_ORDER.filter((id) => !placed.has(id));
    const families = extra.length ? [...FAMILIES, ['Autres', extra]] : FAMILIES;
    const buttons = [];
    for (const [fi, [family, ids]] of families.entries()) {
      const list = ids.filter((id) => allowed.has(id));
      if (!list.length) continue;
      const label = document.createElement('p');
      label.className = 'family';
      label.id = `${container.id}-f${fi}`;
      label.textContent = family;
      const row = document.createElement('div');
      row.className = 'swatch-row';
      for (const id of list) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', 'false');
        b.setAttribute('aria-describedby', label.id);
        b.tabIndex = -1;
        b.dataset.value = id;
        const disc = document.createElement('span');
        disc.className = 'disc';
        disc.setAttribute('aria-hidden', 'true');
        const pal = Catalog.PALETTES[id];
        if (pal) pal.forEach((c, i) => disc.style.setProperty(`--c${i + 1}`, c));
        else disc.classList.add(id);
        const name = document.createElement('span');
        name.textContent = SHORT[id] || names[id] || id;
        b.append(disc, name);
        row.append(b);
        buttons.push(b);
      }
      container.append(label, row);
    }
    const key = container.dataset.setting;
    radioGroup(buttons, (b) => bridge.setSettings({ [key]: b.dataset.value }));
    return buttons;
  }
  const themeSwatches = buildSwatches($('themeSwatches'), new Set(Catalog.THEME_ORDER));
  const discSwatches = buildSwatches(
    $('discColorSwatches'),
    new Set(['album', ...Catalog.FIXED_THEMES.map(([id]) => id)]),
  );

  // ----- Onglets (menu de gauche) -----
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const panelOf = (t) => $(t.getAttribute('aria-controls'));
  const shown = () => tabs.filter((t) => !t.classList.contains('hidden'));
  function selectTab(tab, focus) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (!searching()) panelOf(t).hidden = !on;
    }
    if (focus) tab.focus();
    $('panels').scrollTop = 0;
    paintSoon();
  }
  for (const t of tabs) {
    t.addEventListener('click', () => {
      if (searching()) clearSearch();
      selectTab(t);
    });
    t.addEventListener('keydown', (e) => {
      const list = shown();
      const i = list.indexOf(t);
      const to = {
        ArrowDown: i + 1,
        ArrowRight: i + 1,
        ArrowUp: i - 1,
        ArrowLeft: i - 1,
        Home: 0,
        End: list.length - 1,
      }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      if (searching()) clearSearch();
      selectTab(list[(to + list.length) % list.length], true);
    });
  }
  const activeTab = () => tabs.find((t) => t.getAttribute('aria-selected') === 'true');

  // ----- Recherche : toutes sections confondues, seulement les réglages trouvés -----
  const items = [...document.querySelectorAll('#panels .item')];
  const panels = tabs.map(panelOf);
  const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  // Texte de chaque réglage (libellés, options, aide, mots-clés) et de sa section.
  const haystack = new Map(
    items.map((it) => {
      const panel = it.closest('.panel');
      const text = [panel.querySelector('h2').textContent, it.textContent, it.dataset.keywords || ''].join(' ');
      return [it, fold(text.replace(/\s+/g, ' '))];
    }),
  );
  const searching = () => document.body.classList.contains('searching');
  function runSearch() {
    const words = fold($('search').value).split(/\s+/).filter(Boolean);
    const on = words.length > 0;
    document.body.classList.toggle('searching', on);
    let found = 0;
    for (const it of items) {
      const hit = !on || words.every((w) => haystack.get(it).includes(w));
      it.classList.toggle('miss', !hit);
      const tab = tabs[panels.indexOf(it.closest('.panel'))];
      if (hit && on && !it.classList.contains('hidden') && !tab.classList.contains('hidden')) found++;
    }
    const current = activeTab();
    for (const [i, p] of panels.entries()) {
      const tabHidden = tabs[i].classList.contains('hidden');
      const any = p.querySelector('.item:not(.miss):not(.hidden)');
      p.hidden = on ? tabHidden || !any : tabs[i] !== current;
      // Sous-titres (Disque, Écran de veille…) masqués si rien dessous n'est trouvé.
      for (const h of p.querySelectorAll('h3')) {
        let next = h.nextElementSibling,
          visible = false;
        while (next && next.tagName !== 'H3') {
          if (next.classList.contains('item') && !next.classList.contains('miss')) visible = true;
          next = next.nextElementSibling;
        }
        h.classList.toggle('miss', on && !visible);
      }
    }
    $('searchState').textContent = !on
      ? ''
      : found
        ? `${found} réglage${found > 1 ? 's' : ''} trouvé${found > 1 ? 's' : ''}.`
        : `Aucun réglage ne correspond à « ${$('search').value.trim()} ».`;
    if (on) $('panels').scrollTop = 0;
    paintSoon();
  }
  function clearSearch() {
    $('search').value = '';
    runSearch();
  }
  $('search').addEventListener('input', runSearch);
  // Entrée : aller au premier réglage trouvé.
  $('search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !searching()) return;
    const first = [...document.querySelectorAll('#panels .item:not(.miss):not(.hidden)')].find((it) => it.offsetParent);
    const target =
      first && first.querySelector('button[tabindex="0"], input, select, button:not([tabindex="-1"]):not(.hidden)');
    if (target) target.focus();
  });

  // ----- Aperçus animés : galerie des styles + aperçu en direct -----
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
    paintSoon();
  });
  radioGroup(gallery, (b) => bridge.setSettings({ style: b.dataset.style }));

  // Légèreté : on ne dessine que les aperçus visibles (onglet ouvert, à l'écran),
  // à 30 i/s, rien pendant le défilement (sinon la fenêtre saccade) ni quand la
  // fenêtre est cachée. Les tailles sont lues une fois par l'observateur.
  const live = { c: $('liveCanvas'), w: 0, h: 0, visible: false, live: true };
  const previews = [live, ...gallery.map((b) => ({ b, c: b.querySelector('canvas'), w: 0, h: 0, visible: false }))];
  const dpr = window.devicePixelRatio || 1;
  const sizes = new ResizeObserver((entries) => {
    for (const e of entries) {
      const p = previews.find((x) => x.c === e.target);
      p.w = e.contentRect.width;
      p.h = e.contentRect.height;
      p.c.width = Math.round(p.w * dpr);
      p.c.height = Math.round(p.h * dpr);
    }
    paintSoon();
  });
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) previews.find((x) => x.c === e.target).visible = e.isIntersecting;
    paintSoon();
  });
  for (const p of previews) {
    sizes.observe(p.c);
    seen.observe(p.c);
  }
  let scrolling = 0,
    lastDraw = 0,
    frame = 0;
  $('panels').addEventListener(
    'scroll',
    () => {
      clearTimeout(scrolling);
      scrolling = setTimeout(() => {
        scrolling = 0;
        paintSoon();
      }, 180);
    },
    { passive: true },
  );
  // Relance la boucle de dessin (elle s'arrête d'elle-même quand il n'y a rien à animer).
  function paintSoon() {
    needsPaint = true;
    if (!frame && !document.hidden) frame = requestAnimationFrame(draw);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else paintSoon();
  });
  // Palette de l'aperçu : « fond d'écran » et « pochette » dépendent de l'image du
  // moment, inconnue ici ; on montre le violet de Sillon.
  const paletteOf = (theme) => THEMES[theme] || THEMES.violet;
  function draw(now) {
    frame = 0;
    if (document.hidden) return;
    const frozen = still();
    const visible = previews.filter((p) => p.visible && p.w);
    // Figé ou rien à l'écran : une seule image, puis la boucle s'arrête.
    if ((frozen || !visible.length) && !needsPaint) return;
    frame = requestAnimationFrame(draw);
    if (scrolling || now - lastDraw < 1000 / 30 - 2) return;
    needsPaint = false;
    lastDraw = now;
    const t = frozen ? 1500 : now;
    const a = fake.frame(t);
    const pal = paletteOf(current.theme);
    for (const p of visible) {
      const ctx = p.c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, p.w, p.h);
      const style = p.live ? current.style || 'bars' : p.b.dataset.style;
      const opts = { glow: true, t, reflection: false, sensitivity: p.live ? Number(current.sensitivity) || 1 : 1 };
      VISUALIZERS[style](ctx, p.w, p.h, a, pal, opts);
    }
  }
  function showLive(s) {
    const style = s.style || 'bars';
    $('liveStyle').textContent = Catalog.STYLE_NAMES[style] || style;
    $('liveTheme').textContent = Catalog.THEME_NAMES[s.theme] || '';
    live.c.style.opacity = String(Math.max(0.2, Math.min(1, Number(s.opacity) || 1)));
    document.body.style.setProperty('--pv1', paletteOf(s.theme)[0]);
  }

  function fill(s) {
    const defaults = {
      layout: 'scene',
      sceneScreen: 'primary',
      sleepAfter: 0,
      discRays: 'fine',
      audioSource: 'app',
    };
    for (const k of selects) if (document.activeElement !== $(k)) $(k).value = String(s[k] ?? defaults[k] ?? '');
    $('showNowPlaying').checked = s.showNowPlaying !== false;
    $('showLyrics').checked = s.showLyrics !== false;
    current = s;
    $('reduceMotion').checked = !!s.reduceMotion;
    document.body.classList.toggle('reduce-motion', still());
    check(gallery, s.style || 'bars', 'style');
    check(themeSwatches, s.theme || 'wallpaper', 'value');
    check(discSwatches, s.discColors || 'album', 'value');
    showLive(s);
    paintSoon();
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
    $('tab-scene').classList.toggle('hidden', !scene);
    $('discColorsGroup').classList.toggle('hidden', !scene);
    $('sceneScreenRow').classList.toggle('hidden', !scene);
    $('sceneNeedsWallpaper').classList.toggle('hidden', !(wantsScene && s.mode !== 'wallpaper'));
    $('showNowPlayingRow').classList.toggle('hidden', scene);
    // La scène occupe tout le bureau : rien à déplacer.
    $('editRow').classList.toggle('hidden', scene);
    // Onglet « Scène » ouvert alors que la scène disparaît : retour à « Disposition ».
    if (!scene && activeTab() === $('tab-scene')) selectTab($('tab-layout'));
    if (searching()) runSearch();
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
  // Échap : vide d'abord la recherche, puis ferme la fenêtre.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (e.target === $('search') && $('search').value) {
      e.preventDefault();
      clearSearch();
      return;
    }
    window.close();
  });
  // Ctrl+F : aller à la recherche.
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $('search').focus();
      $('search').select();
    }
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

  // ----- Scène et diagnostic -----
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
