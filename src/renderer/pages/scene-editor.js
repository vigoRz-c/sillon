/* Sillon — éditeur de disposition de la scène (widget.html?edit=1).
   Script classique : expose window.SceneEditor.create(host), appelé par widget.js
   avant son démarrage. Chargé après scene-layout.js et avant widget.js.

   host : { bridge, NODES, app(), lastQueue(), placeAll(), applyLayout(s), renderQueue(q) }
   Renvoie { draft, draftOpts, start(settings), drawSelection(), settings() } :
   le brouillon de disposition et les options modifiées restent la propriété de
   l'éditeur (widget.js les lit pour dessiner la scène en cours d'édition). */
(function () {
  'use strict';
  const SL = window.SceneLayout;
  const $ = (id) => document.getElementById(id);

  function create(host) {
    const { bridge, NODES, placeAll, applyLayout, renderQueue } = host;
    let draft = null; // disposition en cours de modification
    let draftOpts = {}; // options modifiées (rayons, couleurs…)
    const settings = () => ({ ...host.app().state.settings, ...draftOpts });

    // =================== Éditeur de disposition ===================
    // Glisser un élément pour le déplacer, tirer la poignée pour le
    // redimensionner, cocher / décocher pour l'afficher ou le masquer.
    // « Terminé » enregistre, « Annuler » oublie tout.

    if (bridge && bridge.onEditorBackground) {
      bridge.onEditorBackground((url) => {
        document.body.style.backgroundImage = url ? `url("${url}")` : '';
      });
    }

    let selected = 'disc';
    let snap = true;
    let sideLeft = false;
    const history = [];

    function snapshot() {
      history.push(JSON.stringify({ draft, draftOpts }));
      if (history.length > 50) history.shift();
    }
    function undo() {
      const h = history.pop();
      if (!h) return;
      ({ draft, draftOpts } = JSON.parse(h));
      refreshEditor();
    }

    function refreshEditor() {
      applyLayout(host.app().state.settings);
      fillSide();
    }

    function buildEditor() {
      document.body.classList.add('layout-edit');
      for (const id of SL.ORDER) {
        const n = $(NODES[id]);
        n.dataset.label = SL.ELEMENTS[id].label;
        // Éléments utilisables au clavier : Tab pour y aller, Entrée ou Espace pour les choisir.
        n.tabIndex = 0;
        n.setAttribute('role', 'button');
        n.setAttribute('aria-label', SL.ELEMENTS[id].label);
        n.setAttribute('aria-pressed', String(id === selected));
      }
      const live = document.createElement('div');
      live.id = 'eLive';
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      live.style.cssText =
        'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
      document.body.appendChild(live);
      // Boutons factices : les vrais sont une fenêtre à part.
      $('pControls').innerHTML = '<i></i>'.repeat(6) + '<b></b>' + '<i></i>'.repeat(2);
      $('bigTitleText').textContent = $('bigTitleText').textContent || 'Grand titre';
      $('bigTitle').classList.add('show');
      renderQueue(host.lastQueue());

      const bar = document.createElement('div');
      bar.id = 'editBar';
      bar.setAttribute('role', 'toolbar');
      bar.setAttribute('aria-label', 'Personnaliser la scène');
      bar.innerHTML = `
      <strong>Personnaliser la scène</strong>
      <select id="ePreset" title="Partir d'un modèle" aria-label="Partir d'un modèle de disposition">
        <option value="">Modèles…</option>
        ${Object.entries(SL.PRESETS)
          .map(([k, p]) => `<option value="${k}">${p.label}</option>`)
          .join('')}
      </select>
      <button id="eUndo" title="Annuler la dernière modification (Ctrl+Z)" aria-label="Annuler la dernière modification">↶</button>
      <button id="eReset">Réinitialiser</button>
      <span class="sp"></span>
      <button id="eCancel">Annuler</button>
      <button id="eDone" class="primary">Terminé</button>`;
      document.body.appendChild(bar);

      const side = document.createElement('div');
      side.id = 'editSide';
      side.setAttribute('role', 'group');
      side.setAttribute('aria-label', 'Éléments de la scène et réglages');
      document.body.appendChild(side);

      const frame = document.createElement('div');
      frame.id = 'selFrame';
      frame.innerHTML =
        '<span class="lbl"></span><div class="handle" title="Tirer pour redimensionner" role="img" aria-label="Poignée de redimensionnement (la taille se règle aussi dans la colonne de réglages)"></div>';
      document.body.appendChild(frame);
      const gx = document.createElement('div');
      gx.id = 'guideX';
      gx.className = 'guide v';
      const gy = document.createElement('div');
      gy.id = 'guideY';
      gy.className = 'guide h';
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
      $('eReset').onclick = () => {
        snapshot();
        draft = SL.preset('default');
        draftOpts = {};
        refreshEditor();
      };
      $('eCancel').onclick = () => bridge.layoutCancel();
      $('eDone').onclick = () => bridge.layoutDone({ sceneLayout: draft, ...draftOpts });

      // Glisser un élément.
      for (const id of SL.ORDER) {
        const n = $(NODES[id]);
        n.addEventListener('pointerdown', (e) => startDrag(e, id, 'move'));
        n.addEventListener('keydown', (e) => {
          if (e.target !== n || (e.key !== 'Enter' && e.key !== ' ')) return;
          e.preventDefault();
          e.stopPropagation(); // Entrée choisit l'élément, elle ne valide pas la scène
          selected = id;
          fillSide();
          drawSelection();
          announceElement(id);
        });
      }
      frame.querySelector('.handle').addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        startDrag(e, selected, 'resize');
      });
      window.addEventListener('pointermove', onDrag);
      window.addEventListener('pointerup', endDrag);
      window.addEventListener('keydown', onKey);
      fillSide();
    }

    // Annonce aux lecteurs d'écran (regroupe les annonces rapprochées).
    let liveTimer = null;
    function announce(msg) {
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => {
        const l = $('eLive');
        if (l) l.textContent = msg;
      }, 250);
    }
    function announceElement(id) {
      const el = draft[id];
      const pos = el.visible
        ? `${Math.round(el.x * 100)} % de la largeur, ${Math.round(el.y * 100)} % de la hauteur`
        : 'masqué';
      announce(`${SL.ELEMENTS[id].label} : ${pos}`);
    }

    let drag = null;
    function startDrag(e, id, kind) {
      if (e.button !== 0) return;
      e.preventDefault();
      if (selected !== id) {
        selected = id;
        fillSide();
      }
      const el = draft[id];
      const r = $(NODES[id]).getBoundingClientRect();
      // L'instantané d'annulation est pris au premier déplacement effectif (voir onDrag).
      drag = { id, kind, x0: e.clientX, y0: e.clientY, el: { ...el }, rw: r.width, rh: r.height, snapped: false };
      drawSelection();
    }

    function onDrag(e) {
      if (!drag) return;
      const W = window.innerWidth,
        H = window.innerHeight;
      const dx = e.clientX - drag.x0,
        dy = e.clientY - drag.y0;
      const el = { ...drag.el };
      const spec = SL.ELEMENTS[drag.id];
      let gxOn = false,
        gyOn = false;
      if (drag.kind === 'move') {
        el.x = drag.el.x + dx / W;
        el.y = drag.el.y + dy / H;
        if (snap && !e.altKey) {
          // Aimants : centres de l'écran, puis grille de 0,5 %.
          if (Math.abs(el.x - 0.5) < 0.012) {
            el.x = 0.5;
            gxOn = true;
          } else el.x = Math.round(el.x * 200) / 200;
          if (Math.abs(el.y - 0.5) < 0.012) {
            el.y = 0.5;
            gyOn = true;
          } else el.y = Math.round(el.y * 200) / 200;
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
      const next = SL.clampElement(drag.id, el);
      // Un simple clic, sans déplacement, ne pollue pas l'historique d'annulation.
      if (!drag.snapped && JSON.stringify(next) !== JSON.stringify(draft[drag.id])) {
        snapshot();
        drag.snapped = true;
      }
      draft[drag.id] = next;
      $('guideX').classList.toggle('on', gxOn);
      $('guideY').classList.toggle('on', gyOn);
      placeAll();
      fillSide(true);
    }

    function endDrag() {
      if (!drag) return;
      announceElement(drag.id);
      drag = null;
      $('guideX').classList.remove('on');
      $('guideY').classList.remove('on');
    }

    function onKey(e) {
      // Seuls les contrôles qui gèrent eux-mêmes la touche la gardent : liste, champ
      // texte ou nombre, et flèches d'un curseur. Échap et Ctrl+Z passent toujours
      // pour un curseur ou une case à cocher.
      const tg = e.target;
      if (tg.tagName === 'SELECT') return;
      if (tg.tagName === 'INPUT') {
        if (tg.type !== 'range' && tg.type !== 'checkbox') return;
        if (tg.type === 'range' && e.key.startsWith('Arrow')) return;
      }
      if (e.key === 'Escape') {
        bridge.layoutCancel();
        return;
      }
      // Entrée et Suppr ne valent que sur la page ou un élément : pas sur un bouton.
      const t = e.target;
      const neutral =
        t === document.body || t === document.documentElement || (t.classList && t.classList.contains('el'));
      if (e.key === 'Enter') {
        if (neutral) $('eDone').click();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
        return;
      }
      const el = draft[selected];
      if (!el) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!neutral) return;
        snapshot();
        el.visible = false;
        refreshEditor();
        announce(`${SL.ELEMENTS[selected].label} masqué`);
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!mv) return;
      e.preventDefault();
      snapshot();
      el.x += mv[0] / window.innerWidth;
      el.y += mv[1] / window.innerHeight;
      draft[selected] = SL.clampElement(selected, el);
      placeAll();
      announceElement(selected);
    }

    // Cadre et poignée autour de l'élément choisi.
    function drawSelection() {
      const f = $('selFrame');
      if (!f) return;
      const el = draft && draft[selected];
      if (!el || !el.visible) {
        f.classList.add('hidden');
        return;
      }
      const spec = SL.ELEMENTS[selected];
      const r = $(NODES[selected]).getBoundingClientRect();
      f.classList.remove('hidden');
      Object.assign(f.style, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
      f.querySelector('.lbl').textContent = spec.label;
      const canResize = spec.w || spec.scale[0] !== spec.scale[1];
      f.querySelector('.handle').classList.toggle('hidden', !canResize);
      for (const id of SL.ORDER) {
        $(NODES[id]).classList.toggle('sel', id === selected);
        $(NODES[id]).setAttribute('aria-pressed', String(id === selected));
      }
    }

    // Colonne de réglages : liste des éléments, puis réglages de l'élément choisi.
    function fillSide(onlyValues) {
      const side = $('editSide');
      if (!side) return;
      const el = draft[selected],
        spec = SL.ELEMENTS[selected];
      if (onlyValues) {
        for (const k of ['scale', 'w', 'h']) {
          const i = side.querySelector(`[data-k="${k}"]`);
          if (i && document.activeElement !== i) i.value = el[k];
        }
        return;
      }
      const s = settings();
      const opt = (k, v, label) =>
        `<option value="${v}" ${String(s[k] ?? '') === String(v) ? 'selected' : ''}>${label}</option>`;
      const range = (k, lo, hi, step, label) =>
        `<label class="er">${label}<input type="range" data-k="${k}" min="${lo}" max="${hi}" step="${step}" value="${el[k]}"></label>`;
      let extra = '';
      if (selected === 'disc') {
        extra = `<label class="er">Anneau<select data-o="discRays">${window.SillonCatalog.DISC_RAYS.map(([v, l]) => opt('discRays', v, l)).join('')}</select></label>
        <label class="er">Couleurs<select data-o="discColors">${opt('discColors', 'album', 'De la pochette')}${opt('discColors', 'custom', 'Couleur personnalisée')}${window.SillonCatalog.FIXED_THEMES.map(([t, name]) => opt('discColors', t, name)).join('')}</select></label>`;
      } else if (selected === 'cover') {
        extra = `<label class="ec"><input type="checkbox" data-o="panelRing" ${s.panelRing !== false ? 'checked' : ''}> Anneaux qui vibrent</label>`;
      } else if (selected === 'bars') {
        const styles = [
          ['bars', 'Barres'],
          ['mirror', 'Miroir'],
          ['blocks', 'Blocs'],
          ['wave', 'Onde'],
          ['aurora', 'Aurore'],
          ['spectrum', 'Spectre'],
          ['dots', 'Points'],
          ['sparks', 'Étincelles'],
        ];
        // Style courant absent de la liste (anneau, halo…) : on l'ajoute, sinon « Barres » s'afficherait à tort.
        const cur = s.style;
        if (cur && !styles.some(([v]) => v === cur)) styles.push([cur, window.SillonCatalog.STYLE_NAMES[cur] || cur]);
        extra = `<label class="er">Style<select data-o="style">${styles
          .map(([v, l]) => opt('style', v, l))
          .join('')}</select></label>`;
      }
      side.classList.toggle('left', sideLeft);
      side.innerHTML = `
      <div class="eh">Éléments <button id="eSwap" title="Passer la colonne de l'autre côté" aria-label="Passer la colonne de l'autre côté">⇆</button></div>
      ${SL.ORDER.map(
        (id) => `<label class="ec ${id === selected ? 'cur' : ''}" data-id="${id}">
        <input type="checkbox" data-vis="${id}" ${draft[id].visible ? 'checked' : ''}> ${SL.ELEMENTS[id].label}</label>`,
      ).join('')}
      <div class="eh">${spec.label}</div>
      ${spec.scale[0] !== spec.scale[1] ? range('scale', spec.scale[0], spec.scale[1], 0.01, 'Taille') : ''}
      ${spec.w ? range('w', spec.w[0], spec.w[1], 0.005, 'Largeur') : ''}
      ${spec.h ? range('h', spec.h[0], spec.h[1], 0.005, 'Hauteur') : ''}
      ${extra}
      <label class="ec"><input type="checkbox" id="eSnap" ${snap ? 'checked' : ''}> Aimanter (grille et centres)</label>
      <p class="eh2">Glisser : déplacer · poignée : taille · flèches : 1 px (Maj : 10) · Suppr : masquer · Alt : sans aimant · Ctrl+Z : annuler</p>`;

      side.querySelectorAll('[data-vis]').forEach((c) =>
        c.addEventListener('change', () => {
          snapshot();
          draft[c.dataset.vis].visible = c.checked;
          selected = c.dataset.vis;
          refreshEditor();
        }),
      );
      side.querySelectorAll('label[data-id]').forEach((l) =>
        l.addEventListener('click', (e) => {
          if (e.target.tagName === 'INPUT') return;
          selected = l.dataset.id;
          fillSide();
          drawSelection();
        }),
      );
      side.querySelectorAll('input[type=range][data-k]').forEach((i) => {
        // Un instantané par geste (glissement ou pression de touche), pris avant la première modification.
        let snapped = false;
        i.addEventListener('change', () => (snapped = false));
        i.addEventListener('input', () => {
          if (!snapped) {
            snapshot();
            snapped = true;
          }
          draft[selected] = SL.clampElement(selected, { ...draft[selected], [i.dataset.k]: Number(i.value) });
          placeAll();
        });
      });
      side.querySelectorAll('[data-o]').forEach((i) =>
        i.addEventListener('change', () => {
          snapshot();
          draftOpts[i.dataset.o] = i.type === 'checkbox' ? i.checked : i.value;
          refreshEditor();
        }),
      );
      $('eSnap').onchange = () => {
        snap = $('eSnap').checked;
      };
      $('eSwap').onclick = () => {
        sideLeft = !sideLeft;
        fillSide();
      };
    }

    return {
      get draft() {
        return draft;
      },
      get draftOpts() {
        return draftOpts;
      },
      // Premier réglage reçu : le brouillon part de la disposition enregistrée.
      start(s) {
        draft = SL.fromSettings(s);
        buildEditor();
      },
      drawSelection,
      settings,
    };
  }

  window.SceneEditor = { create };
})();
