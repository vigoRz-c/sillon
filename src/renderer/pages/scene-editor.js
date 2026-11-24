/* Sillon — layout editor of the scene (widget.html?edit=1).
   Classic script: exposes window.SceneEditor.create(host), called by widget.js
   before it starts. Loaded after scene-layout.js and before widget.js.

   host: { bridge, NODES, app(), lastQueue(), placeAll(), applyLayout(s), renderQueue(q) }
   Returns { draft, draftOpts, start(settings), drawSelection(), settings() }:
   the layout draft and the changed options belong to the editor
   (widget.js reads them to draw the scene being edited). */
(function () {
  'use strict';
  const SL = window.SceneLayout;
  const I18n = window.SillonI18n;
  const t = I18n.t;
  const Catalog = window.SillonCatalog;
  // Names of the elements and templates, in the current language.
  const elName = (id) => I18n.label(t, `scene.element.${id}`, SL.ELEMENTS[id].label);
  const presetName = (id) => I18n.label(t, `scene.preset.${id}`, SL.PRESETS[id].label);
  const $ = (id) => document.getElementById(id);

  function create(host) {
    const { bridge, NODES, placeAll, applyLayout, renderQueue } = host;
    let draft = null; // layout being edited
    let draftOpts = {}; // changed options (rays, colors…)
    const settings = () => ({ ...host.app().state.settings, ...draftOpts });

    // =================== Layout editor ===================
    // Drag an element to move it, pull the handle to resize it, check /
    // uncheck to show or hide it.
    // "Done" saves, "Cancel" forgets everything.

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

    function labelNodes() {
      for (const id of SL.ORDER) {
        const n = $(NODES[id]);
        n.dataset.label = elName(id);
        n.setAttribute('aria-label', elName(id));
      }
    }

    function fillPresets() {
      $('ePreset').innerHTML =
        `<option value="">${t('editor.presets')}</option>` +
        Object.keys(SL.PRESETS)
          .map((k) => `<option value="${k}">${presetName(k)}</option>`)
          .join('');
    }

    function buildEditor() {
      document.body.classList.add('layout-edit');
      labelNodes();
      for (const id of SL.ORDER) {
        const n = $(NODES[id]);
        // Elements usable with the keyboard: Tab to reach them, Enter or Space to pick them.
        n.tabIndex = 0;
        n.setAttribute('role', 'button');
        n.setAttribute('aria-pressed', String(id === selected));
      }
      const live = document.createElement('div');
      live.id = 'eLive';
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      live.style.cssText =
        'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap';
      document.body.appendChild(live);
      // Dummy buttons: the real ones are a separate window.
      $('pControls').innerHTML = '<i></i>'.repeat(6) + '<b></b>' + '<i></i>'.repeat(2);
      $('bigTitleText').textContent = $('bigTitleText').textContent || t('editor.bigTitle');
      $('lyrics').dataset.i18nAttr = 'data-placeholder:editor.lyricsPlaceholder';
      $('bigTitle').classList.add('show');
      renderQueue(host.lastQueue());

      const bar = document.createElement('div');
      bar.id = 'editBar';
      bar.setAttribute('role', 'toolbar');
      bar.dataset.i18nAttr = 'aria-label:editor.customize';
      bar.innerHTML = `
      <strong data-i18n="editor.customize"></strong>
      <select id="ePreset" data-i18n-attr="title:editor.presetTitle;aria-label:editor.presetLabel"></select>
      <button id="eUndo" data-i18n-attr="title:editor.undoTitle;aria-label:editor.undoLabel">↶</button>
      <button id="eReset" data-i18n="editor.reset"></button>
      <span class="sp"></span>
      <button id="eCancel" data-i18n="common.cancel"></button>
      <button id="eDone" class="primary" data-i18n="common.done"></button>`;
      document.body.appendChild(bar);
      fillPresets();

      const side = document.createElement('div');
      side.id = 'editSide';
      side.setAttribute('role', 'group');
      side.dataset.i18nAttr = 'aria-label:editor.sideLabel';
      document.body.appendChild(side);

      const frame = document.createElement('div');
      frame.id = 'selFrame';
      frame.innerHTML =
        '<span class="lbl"></span><div class="handle" role="img" data-i18n-attr="title:editor.handleTitle;aria-label:editor.handleLabel"></div>';
      document.body.appendChild(frame);
      I18n.apply(document.body);
      // Language changed while editing: names, templates and column follow.
      I18n.onChange(() => {
        labelNodes();
        fillPresets();
        fillSide();
        drawSelection();
      });
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

      // Dragging an element.
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

    // Screen reader announcements (groups announcements that come close together).
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
        ? t('editor.position', { x: Math.round(el.x * 100), y: Math.round(el.y * 100) })
        : t('editor.hidden');
      announce(t('editor.elementState', { element: elName(id), state: pos }));
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
      // The undo snapshot is taken on the first actual move (see onDrag).
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
          // Snapping: screen centers, then a 0.5 % grid.
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
        // Stretchable: the width (and the bars' height) follows the handle.
        el.w = drag.el.w + (dx * (spec.ax === 0.5 ? 2 : 1)) / W;
        if (spec.h) el.h = drag.el.h + (dy * (spec.ay === 0.5 ? 2 : 1)) / H;
      } else {
        // The others grow proportionally.
        const k = 1 + (dx + dy) / Math.max(40, drag.rw + drag.rh);
        el.scale = Math.round(drag.el.scale * k * 100) / 100;
      }
      const next = SL.clampElement(drag.id, el);
      // A simple click, without moving, does not pollute the undo history.
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
      // Only controls that handle the key themselves keep it: list, text or
      // number field, and a slider's arrows. Escape and Ctrl+Z always go through
      // for a slider or a checkbox.
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
      // Enter and Delete only count on the page or an element: not on a button.
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
        announce(t('editor.elementHidden', { element: elName(selected) }));
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

    // Frame and handle around the selected element.
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
      f.querySelector('.lbl').textContent = elName(selected);
      const canResize = spec.w || spec.scale[0] !== spec.scale[1];
      f.querySelector('.handle').classList.toggle('hidden', !canResize);
      for (const id of SL.ORDER) {
        $(NODES[id]).classList.toggle('sel', id === selected);
        $(NODES[id]).setAttribute('aria-pressed', String(id === selected));
      }
    }

    // Settings column: list of the elements, then settings of the selected element.
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
        const rays = Catalog.list('rays', t).map(([v, l]) => opt('discRays', v, l));
        const fixed = Catalog.FIXED_THEMES.map(([id]) => opt('discColors', id, Catalog.name('theme', id, t)));
        extra = `<label class="er">${t('editor.ring')}<select data-o="discRays">${rays.join('')}</select></label>
        <label class="er">${t('editor.colors')}<select data-o="discColors">${opt('discColors', 'album', t('editor.fromCover'))}${opt('discColors', 'custom', t('editor.customColor'))}${fixed.join('')}</select></label>`;
      } else if (selected === 'cover') {
        extra = `<label class="ec"><input type="checkbox" data-o="panelRing" ${s.panelRing !== false ? 'checked' : ''}> ${t('editor.vibratingRings')}</label>`;
      } else if (selected === 'bars') {
        const styles = ['bars', 'mirror', 'blocks', 'wave', 'aurora', 'spectrum', 'dots', 'sparks'].map((id) => [
          id,
          Catalog.name('style', id, t),
        ]);
        // Current style missing from the list (ring, halo…): add it, otherwise "Bars" would show wrongly.
        const cur = s.style;
        if (cur && !styles.some(([v]) => v === cur)) styles.push([cur, Catalog.name('style', cur, t)]);
        extra = `<label class="er">${t('editor.style')}<select data-o="style">${styles
          .map(([v, l]) => opt('style', v, l))
          .join('')}</select></label>`;
      }
      side.classList.toggle('left', sideLeft);
      side.innerHTML = `
      <div class="eh">${t('editor.elements')} <button id="eSwap" title="${t('editor.swapSide')}" aria-label="${t('editor.swapSide')}">⇆</button></div>
      ${SL.ORDER.map(
        (id) => `<label class="ec ${id === selected ? 'cur' : ''}" data-id="${id}">
        <input type="checkbox" data-vis="${id}" ${draft[id].visible ? 'checked' : ''}> ${elName(id)}</label>`,
      ).join('')}
      <div class="eh">${elName(selected)}</div>
      ${spec.scale[0] !== spec.scale[1] ? range('scale', spec.scale[0], spec.scale[1], 0.01, t('editor.size')) : ''}
      ${spec.w ? range('w', spec.w[0], spec.w[1], 0.005, t('editor.width')) : ''}
      ${spec.h ? range('h', spec.h[0], spec.h[1], 0.005, t('editor.height')) : ''}
      ${extra}
      <label class="ec"><input type="checkbox" id="eSnap" ${snap ? 'checked' : ''}> ${t('editor.snap')}</label>
      <p class="eh2">${t('editor.help')}</p>`;

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
        // One snapshot per gesture (drag or key press), taken before the first change.
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
      // First settings received: the draft starts from the saved layout.
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
