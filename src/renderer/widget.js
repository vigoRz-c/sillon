(function () {
  'use strict';
  const { currentPosition, THEMES, VISUALIZERS, drawEdgeGlow, drawCoverRings } = window.SV;
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
  let draft = null;        // éditeur : disposition en cours de modification
  let draftOpts = {};      // éditeur : options modifiées (rayons, couleurs…)
  const settings = () => (EDIT ? { ...app.state.settings, ...draftOpts } : app.state.settings);
  const layout = () => (EDIT && draft ? draft : SL.fromSettings(app.state.settings));

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
    onSettings: (s) => {
      if (EDIT && !draft) { draft = SL.fromSettings(s); buildEditor(); }
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
    disc: 'discEl', lyrics: 'lyrics', title: 'bigTitle', cover: 'pCover', info: 'pInfo',
    buttons: 'pControls', queue: 'pQueue', clock: 'clock', bars: 'barsEl',
  };
  // Éléments agrandis par transform (texte) ; les autres changent de taille réelle.
  const SCALED = new Set(['info', 'buttons', 'queue', 'clock']);
  // Éléments gardés entièrement dans l'écran (la pochette et le disque peuvent dépasser).
  const KEEP_INSIDE = new Set(['title', 'info', 'buttons', 'queue', 'clock', 'lyrics', 'bars']);

  function placeAll() {
    if (!scene) return;
    const W = window.innerWidth, H = window.innerHeight;
    const L = layout();
    const base = Math.min(W, H);
    document.documentElement.style.setProperty('--lyr-size', `${Math.round(Math.min(H * 0.075, W * 0.045) * L.lyrics.scale)}px`);
    document.documentElement.style.setProperty('--title-size', `${Math.round(Math.min(W * 0.075, H * 0.14) * L.title.scale)}px`);

    // Disque (dessiné dans le canevas) : rayon et zone de saisie.
    geo.cx = W * L.disc.x; geo.cy = H * L.disc.y;
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
    geo.bars = L.bars.visible ? { x: W * L.bars.x - (L.bars.w * W) / 2, y: H * L.bars.y - (L.bars.h * H) / 2, w: L.bars.w * W, h: L.bars.h * H } : null;
    updateDisc();
    if (EDIT) drawSelection();
    requestAnimationFrame(reportControls);
  }

  function size(id, w, h) {
    const n = $(NODES[id]);
    if (w != null) n.style.width = `${Math.round(w)}px`;
    if (h != null) n.style.height = `${Math.round(h)}px`;
  }

  function place(id, el, W, H) {
    const n = $(NODES[id]), spec = SL.ELEMENTS[id];
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
      if (dx || dy) { n.style.left = `${W * el.x + dx}px`; n.style.top = `${H * el.y + dy}px`; }
    }
  }

  // Couleurs du disque : celles de la pochette, ou un thème fixe.
  function discPalette() {
    const st = app.state, c = settings().discColors || 'album';
    if (c !== 'album' && THEMES[c]) return THEMES[c];
    return st.albumPalette || app.renderer.palette;
  }

  function updateDisc() {
    if (!scene) return;
    const st = app.state, s = settings();
    const pal = discPalette();
    app.renderer.style = geo.discOn === false ? 'none' : 'disc';
    app.renderer.opts = {
      glow: true, cx: geo.cx, cy: geo.cy, radius: geo.r,
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
  function renderQueue(q) {
    lastQueue = q || { items: [] };
    let items = lastQueue.items || [];
    // Dans l'éditeur, une file d'exemple pour voir la place qu'elle prend.
    if (EDIT && !items.length) items = [1, 2, 3].map((i) => ({ title: `Morceau suivant ${i}`, artist: 'Artiste' }));
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
    requestAnimationFrame(placeAll);
  }
  if (bridge && bridge.onQueue) bridge.onQueue(renderQueue);

  // Les boutons sont une petite fenêtre à part (la scène ne reçoit pas les
  // clics) : on lui indique où se placer.
  function reportControls() {
    if (EDIT || !bridge || !bridge.reportControlsRect) return;
    const visible = scene && layout().buttons.visible;
    if (!visible) { bridge.reportControlsRect(null); return; }
    const r = $('pControls').getBoundingClientRect();
    bridge.reportControlsRect({ x: r.left, y: r.top, width: r.width, height: r.height });
  }

  function applyLayout(s) {
    scene = isScene(s);
    document.body.style.opacity = EDIT ? 1 : (s.opacity ?? 1);
    document.body.classList.toggle('scene', scene);
    document.body.classList.toggle('with-now', !scene && s.showNowPlaying !== false);
    $('now').classList.toggle('hidden',
      scene || !(s.showNowPlaying !== false && app.state.media.active && app.state.media.title));
    if (!scene) { app.renderer.opts = { glow: true }; requestAnimationFrame(reportControls); return; }
    placeAll();
  }

  window.addEventListener('resize', () => requestAnimationFrame(placeAll));

  // Décors dessinés par-dessus le disque : bord lumineux, anneaux de la
  // pochette, barres.
  app.renderer.hooks.push((a, now) => {
    if (!scene) return;
    const s = settings(), r = app.renderer, pal = discPalette();
    drawEdgeGlow(r.ctx, r.w, r.h, a, pal, s.edgeGlow ?? 0.8);
    if (s.panelRing !== false && geo.pc) drawCoverRings(r.ctx, geo.pc.x, geo.pc.y, geo.pc.R, a, pal);
    if (geo.bars) {
      const b = geo.bars, draw = VISUALIZERS[s.style] || VISUALIZERS.bars;
      r.ctx.save();
      r.ctx.beginPath(); r.ctx.rect(b.x, b.y, b.w, b.h); r.ctx.clip();
      r.ctx.translate(b.x, b.y);
      draw(r.ctx, b.w, b.h, a, r.palette, { glow: true, t: now, reflection: false, sensitivity: app.engine.sensitivity });
      r.ctx.restore();
    }
  });

  // Progression, paroles et message d'état audio, à chaque image.
  app.renderer.hooks.push(() => {
    const m = app.state.media;
    const pos = currentPosition(m);
    const pct = m.duration ? `${(pos / m.duration) * 100}%` : '0%';
    $('bar').style.width = pct;
    if (scene) {
      $('pBar').style.width = pct;
      if (layout().lyrics.visible) lyrics.update(m, pos);
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
    if (EDIT) return; // l'éditeur reste toujours affiché
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
  if (bridge && !EDIT) {
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

  // =================== Éditeur de disposition ===================
  // Glisser un élément pour le déplacer, tirer la poignée pour le
  // redimensionner, cocher / décocher pour l'afficher ou le masquer.
  // « Terminé » enregistre, « Annuler » oublie tout.

  if (EDIT && bridge && bridge.onEditorBackground) {
    bridge.onEditorBackground((url) => { document.body.style.backgroundImage = url ? `url("${url}")` : ''; });
  }

  let selected = 'disc';
  let snap = true;
  let sideLeft = false;
  let history = [];

  function snapshot() { history.push(JSON.stringify({ draft, draftOpts })); if (history.length > 50) history.shift(); }
  function undo() {
    const h = history.pop();
    if (!h) return;
    ({ draft, draftOpts } = JSON.parse(h));
    refreshEditor();
  }

  function refreshEditor() {
    applyLayout(app.state.settings);
    fillSide();
  }

  function buildEditor() {
    document.body.classList.add('layout-edit');
    for (const id of SL.ORDER) $(NODES[id]).dataset.label = SL.ELEMENTS[id].label;
    // Boutons factices : les vrais sont une fenêtre à part.
    $('pControls').innerHTML = '<i></i>'.repeat(7);
    $('bigTitleText').textContent = $('bigTitleText').textContent || 'Grand titre';
    $('bigTitle').classList.add('show');
    renderQueue(lastQueue);

    const bar = document.createElement('div');
    bar.id = 'editBar';
    bar.innerHTML = `
      <strong>Personnaliser la scène</strong>
      <select id="ePreset" title="Partir d'un modèle">
        <option value="">Modèles…</option>
        ${Object.entries(SL.PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}
      </select>
      <button id="eUndo" title="Annuler la dernière modification (Ctrl+Z)">↶</button>
      <button id="eReset">Réinitialiser</button>
      <span class="sp"></span>
      <button id="eCancel">Annuler</button>
      <button id="eDone" class="primary">Terminé</button>`;
    document.body.appendChild(bar);

    const side = document.createElement('div');
    side.id = 'editSide';
    document.body.appendChild(side);

    const frame = document.createElement('div');
    frame.id = 'selFrame';
    frame.innerHTML = '<span class="lbl"></span><div class="handle" title="Tirer pour redimensionner"></div>';
    document.body.appendChild(frame);
    const gx = document.createElement('div'); gx.id = 'guideX'; gx.className = 'guide v';
    const gy = document.createElement('div'); gy.id = 'guideY'; gy.className = 'guide h';
    document.body.append(gx, gy);

    $('ePreset').onchange = () => {
      const v = $('ePreset').value;
      if (!v) return;
      snapshot();
      draft = SL.preset(v);
      $('ePreset').value = '';
      refreshEditor();
    };
    $('eUndo').onclick = undo;
    $('eReset').onclick = () => { snapshot(); draft = SL.preset('default'); draftOpts = {}; refreshEditor(); };
    $('eCancel').onclick = () => bridge.layoutCancel();
    $('eDone').onclick = () => bridge.layoutDone({ sceneLayout: draft, ...draftOpts });

    // Glisser un élément.
    for (const id of SL.ORDER) {
      const n = $(NODES[id]);
      n.addEventListener('pointerdown', (e) => startDrag(e, id, 'move'));
    }
    frame.querySelector('.handle').addEventListener('pointerdown', (e) => { e.stopPropagation(); startDrag(e, selected, 'resize'); });
    window.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('keydown', onKey);
    fillSide();
  }

  let drag = null;
  function startDrag(e, id, kind) {
    if (e.button !== 0) return;
    e.preventDefault();
    if (selected !== id) { selected = id; fillSide(); }
    snapshot();
    const el = draft[id];
    const r = $(NODES[id]).getBoundingClientRect();
    drag = { id, kind, x0: e.clientX, y0: e.clientY, el: { ...el }, rw: r.width, rh: r.height };
    drawSelection();
  }

  function onDrag(e) {
    if (!drag) return;
    const W = window.innerWidth, H = window.innerHeight;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    const el = { ...drag.el };
    const spec = SL.ELEMENTS[drag.id];
    let gxOn = false, gyOn = false;
    if (drag.kind === 'move') {
      el.x = drag.el.x + dx / W;
      el.y = drag.el.y + dy / H;
      if (snap && !e.altKey) {
        // Aimants : centres de l'écran, puis grille de 0,5 %.
        if (Math.abs(el.x - 0.5) < 0.012) { el.x = 0.5; gxOn = true; } else el.x = Math.round(el.x * 200) / 200;
        if (Math.abs(el.y - 0.5) < 0.012) { el.y = 0.5; gyOn = true; } else el.y = Math.round(el.y * 200) / 200;
      }
    } else if (spec.w) {
      // Étirables : la largeur (et la hauteur des barres) suit la poignée.
      el.w = drag.el.w + (dx * (spec.ax === 0.5 ? 2 : 1)) / W;
      if (spec.h) el.h = drag.el.h + (dy * (spec.ay === 0.5 ? 2 : 1)) / H;
    } else {
      // Les autres s'agrandissent proportionnellement.
      const k = 1 + (dx + dy) / Math.max(40, drag.rw + drag.rh);
      el.scale = Math.round(drag.el.scale * k * 100) / 100;
    }
    draft[drag.id] = SL.clampElement(drag.id, el);
    $('guideX').classList.toggle('on', gxOn);
    $('guideY').classList.toggle('on', gyOn);
    placeAll();
    fillSide(true);
  }

  function endDrag() {
    if (!drag) return;
    drag = null;
    $('guideX').classList.remove('on');
    $('guideY').classList.remove('on');
  }

  function onKey(e) {
    if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') { bridge.layoutCancel(); return; }
    if (e.key === 'Enter') { $('eDone').click(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    const el = draft[selected];
    if (!el) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { snapshot(); el.visible = false; refreshEditor(); return; }
    const step = e.shiftKey ? 10 : 1;
    const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!mv) return;
    e.preventDefault();
    snapshot();
    el.x += mv[0] / window.innerWidth;
    el.y += mv[1] / window.innerHeight;
    draft[selected] = SL.clampElement(selected, el);
    placeAll();
  }

  // Cadre et poignée autour de l'élément choisi.
  function drawSelection() {
    const f = $('selFrame');
    if (!f) return;
    const el = draft && draft[selected];
    if (!el || !el.visible) { f.classList.add('hidden'); return; }
    const spec = SL.ELEMENTS[selected];
    const r = $(NODES[selected]).getBoundingClientRect();
    f.classList.remove('hidden');
    Object.assign(f.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    f.querySelector('.lbl').textContent = spec.label;
    const canResize = spec.w || spec.scale[0] !== spec.scale[1];
    f.querySelector('.handle').classList.toggle('hidden', !canResize);
    for (const id of SL.ORDER) $(NODES[id]).classList.toggle('sel', id === selected);
  }

  // Colonne de réglages : liste des éléments, puis réglages de l'élément choisi.
  function fillSide(onlyValues) {
    const side = $('editSide');
    if (!side) return;
    const el = draft[selected], spec = SL.ELEMENTS[selected];
    if (onlyValues) {
      for (const k of ['scale', 'w', 'h']) {
        const i = side.querySelector(`[data-k="${k}"]`);
        if (i && document.activeElement !== i) i.value = el[k];
      }
      return;
    }
    const s = settings();
    const opt = (k, v, label) => `<option value="${v}" ${String(s[k] ?? '') === String(v) ? 'selected' : ''}>${label}</option>`;
    const range = (k, lo, hi, step, label) => `<label class="er">${label}<input type="range" data-k="${k}" min="${lo}" max="${hi}" step="${step}" value="${el[k]}"></label>`;
    let extra = '';
    if (selected === 'disc') {
      extra = `<label class="er">Rayons<select data-o="discRays">${opt('discRays', 'fine', 'Fins et serrés')}${opt('discRays', 'bold', 'Épais et espacés')}</select></label>
        <label class="er">Couleurs<select data-o="discColors">${opt('discColors', 'album', 'De la pochette')}${['violet', 'neon', 'sunset', 'ocean', 'spotify', 'mono'].map((t) => opt('discColors', t, { violet: 'Violet', neon: 'Néon', sunset: 'Coucher de soleil', ocean: 'Océan', spotify: 'Spotify', mono: 'Blanc' }[t])).join('')}</select></label>`;
    } else if (selected === 'cover') {
      extra = `<label class="ec"><input type="checkbox" data-o="panelRing" ${s.panelRing !== false ? 'checked' : ''}> Anneaux qui vibrent</label>`;
    } else if (selected === 'bars') {
      extra = `<label class="er">Style<select data-o="style">${[['bars', 'Barres'], ['mirror', 'Miroir'], ['blocks', 'Blocs'], ['wave', 'Onde'], ['aurora', 'Aurore']].map(([v, l]) => opt('style', v, l)).join('')}</select></label>`;
    }
    side.classList.toggle('left', sideLeft);
    side.innerHTML = `
      <div class="eh">Éléments <button id="eSwap" title="Passer la colonne de l'autre côté">⇆</button></div>
      ${SL.ORDER.map((id) => `<label class="ec ${id === selected ? 'cur' : ''}" data-id="${id}">
        <input type="checkbox" data-vis="${id}" ${draft[id].visible ? 'checked' : ''}> ${SL.ELEMENTS[id].label}</label>`).join('')}
      <div class="eh">${spec.label}</div>
      ${spec.scale[0] !== spec.scale[1] ? range('scale', spec.scale[0], spec.scale[1], 0.01, 'Taille') : ''}
      ${spec.w ? range('w', spec.w[0], spec.w[1], 0.005, 'Largeur') : ''}
      ${spec.h ? range('h', spec.h[0], spec.h[1], 0.005, 'Hauteur') : ''}
      ${extra}
      <label class="ec"><input type="checkbox" id="eSnap" ${snap ? 'checked' : ''}> Aimanter (grille et centres)</label>
      <p class="eh2">Glisser : déplacer · poignée : taille · flèches : 1 px (Maj : 10) · Suppr : masquer · Alt : sans aimant · Ctrl+Z : annuler</p>`;

    side.querySelectorAll('[data-vis]').forEach((c) => c.addEventListener('change', () => {
      snapshot();
      draft[c.dataset.vis].visible = c.checked;
      selected = c.dataset.vis;
      refreshEditor();
    }));
    side.querySelectorAll('label[data-id]').forEach((l) => l.addEventListener('click', (e) => {
      if (e.target.tagName === 'INPUT') return;
      selected = l.dataset.id;
      fillSide();
      drawSelection();
    }));
    side.querySelectorAll('input[type=range][data-k]').forEach((i) => {
      i.addEventListener('pointerdown', snapshot);
      i.addEventListener('input', () => {
        draft[selected] = SL.clampElement(selected, { ...draft[selected], [i.dataset.k]: Number(i.value) });
        placeAll();
      });
    });
    side.querySelectorAll('[data-o]').forEach((i) => i.addEventListener('change', () => {
      snapshot();
      draftOpts[i.dataset.o] = i.type === 'checkbox' ? i.checked : i.value;
      refreshEditor();
    }));
    $('eSnap').onchange = () => { snap = $('eSnap').checked; };
    $('eSwap').onclick = () => { sideLeft = !sideLeft; fillSide(); };
  }
})();
