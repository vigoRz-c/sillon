/* Settings window: every change is applied right away.
 * Sections in tabs (menu on the left), search in every setting,
 * live preview of the visualizer and color swatches. */
(function () {
  'use strict';
  const I18n = window.SillonI18n;
  // The page is built once the language is known; on a language change, the main process reloads it.
  I18n.start(window.bridge).then(init);

  function init() {
    const t = I18n.t;
    const $ = (id) => document.getElementById(id);
    const bridge = window.bridge;
    const Catalog = window.SillonCatalog;
    const Shortcuts = window.SillonShortcuts;
    // Number with one decimal, in the page's language (1.5 / 1,5).
    const dec = (v) => v.toLocaleString(I18n.language(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });

    // ----- Keyboard shortcuts: one line per shortcut (before the search index) -----
    const shortcutState = {}; // id -> element that says "taken" or "off"
    {
      let last = $('globalShortcutsItem');
      for (const s of Shortcuts.SHORTCUTS) {
        const item = document.createElement('div');
        item.className = 'item shortcut';
        item.dataset.keywords = t('settings.shortcutKeywords');
        const row = document.createElement('div');
        row.className = 'row';
        const label = document.createElement('span');
        label.textContent = Shortcuts.label(s.id, t);
        const keys = document.createElement('span');
        keys.className = 'shortcut-keys';
        const state = document.createElement('span');
        state.className = 'state';
        const kbd = document.createElement('kbd');
        kbd.textContent = s.display;
        keys.append(state, kbd);
        row.append(label, keys);
        item.append(row);
        last.after(item);
        last = item;
        shortcutState[s.id] = state;
      }
    }
    function showShortcuts(st) {
      if (!st) return;
      for (const { id, state } of st.items) {
        const el = shortcutState[id];
        if (!el) continue;
        el.textContent = state === 'taken' ? t('settings.shortcutTaken') : ''; // off: only grayed out
        el.className = state === 'taken' ? 'state error' : 'state';
        el.closest('.item').classList.toggle('off', state === 'off');
      }
    }
    const refreshShortcuts = () => bridge.shortcutsStatus().then(showShortcuts);
    let shownShortcuts = null; // value of globalShortcuts at the last requested state

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
      'language',
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
      'globalShortcuts',
    ];
    const numeric = new Set(['fps', 'veilleDelay', 'sleepAfter']);
    const pct = (v) => `${Math.round(v * 100)} %`;
    const times = (v) => `× ${dec(v)}`;
    const timesSay = (v) => t('settings.timesSay', { value: dec(v) });
    // For each slider: text shown, and text read by screen readers (with the unit).
    const ranges = {
      sensitivity: { show: times, say: timesSay },
      opacity: { show: pct, say: (v) => t('volume.percent', { value: Math.round(v * 100) }) },
      discIntensity: { show: times, say: timesSay },
      discBloom: {
        show: (v) => (v ? times(v) : t('settings.noneGlow')),
        say: (v) => (v ? timesSay(v) : t('settings.noneGlow')),
      },
      edgeGlow: {
        show: (v) => (v ? times(v) : t('settings.noneEdge')),
        say: (v) => (v ? timesSay(v) : t('settings.noneEdge')),
      },
    };
    function showRange(k, v) {
      $(`${k}Out`).textContent = ranges[k].show(v);
      $(k).setAttribute('aria-valuetext', ranges[k].say(v));
    }

    // Shapes of the disc's ring: from the catalog (before the search index).
    for (const [id, name] of Catalog.list('rays', t)) $('discRays').append(new Option(name, id));

    // Style gallery: one animated preview per visualizer of the catalog.
    for (const [id, name] of Catalog.list('style', t)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.dataset.style = id;
      const c = document.createElement('canvas');
      c.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = name;
      b.append(c, label);
      $('styleGallery').append(b);
    }

    // The focus lands on the title on opening: the screen reader announces the window.
    $('pageTitle').focus({ preventScroll: true });

    // ----- Radio button groups (styles, colors) -----
    // A single tab stop per group, arrows / Home / End to change, choice applied right away.
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

    // ----- Color swatches, sorted by families -----
    const FAMILIES = [
      [t('settings.family.image'), ['wallpaper', 'album']],
      [t('settings.family.classic'), ['spotify', 'neon', 'sunset', 'ocean', 'violet', 'mono']],
      [t('settings.family.bright'), ['cyberpunk', 'synthwave', 'acid']],
      [t('settings.family.soft'), ['pastel', 'lavender', 'peach', 'mint']],
      [t('settings.family.natural'), ['forest', 'fire', 'ice', 'desert']],
      [t('settings.family.dark'), ['gold', 'blood', 'midnight']],
      [t('settings.family.wheel'), ['custom']],
    ];
    // Short names under the "image" swatches (the full catalog name is too long).
    const SHORT = {
      wallpaper: t('settings.short.wallpaper'),
      album: t('settings.short.album'),
      custom: t('settings.short.custom'),
    };

    function buildSwatches(container, allowed) {
      const placed = new Set(FAMILIES.flatMap(([, ids]) => ids));
      // A set added to the catalog without a family can still be chosen.
      const extra = Catalog.THEME_ORDER.filter((id) => !placed.has(id));
      const families = extra.length ? [...FAMILIES, [t('settings.family.other'), extra]] : FAMILIES;
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
          name.textContent = SHORT[id] || Catalog.name('theme', id, t);
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
      new Set(['album', 'custom', ...Catalog.FIXED_THEMES.map(([id]) => id)]),
    );

    // ----- Color wheel (customColor setting, "custom" set) -----
    // Hue = angle, saturation = distance to the center, lightness = slider next to it.
    // Each change also chooses the "custom" set for the visualizer.
    const { hexToRgb, rgbToHsl, paletteFromCustom } = window.SillonColors;
    // Component (0 to 1) of an HSL color: n = 0 red, 8 green, 4 blue.
    function hslChannel(n, h, s, l) {
      const k = (n + h / 30) % 12;
      return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    }
    const hslToHex = (h, s, l) =>
      '#' +
      [0, 8, 4]
        .map((n) =>
          Math.round(hslChannel(n, h, s, l) * 255)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
    const wheel = {
      el: $('wheel'),
      canvas: $('wheelCanvas'),
      thumb: $('wheelThumb'),
      h: 0,
      s: 0.7,
      l: 0.6,
      hex: '',
      drawnL: -1,
      dragging: false,
      timer: 0,
      pending: false,
    };
    // Wheel pixels for a lightness: computed again only when it changes.
    function paintWheel() {
      const c = wheel.canvas;
      const css = wheel.el.clientWidth;
      if (!css) return; // hidden tab: drawn on opening (see selectTab)
      const size = Math.round(css * (window.devicePixelRatio || 1));
      if (c.width === size && wheel.drawnL === wheel.l) return;
      c.width = c.height = size;
      wheel.drawnL = wheel.l;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(size, size);
      const px = img.data,
        R = size / 2,
        l = wheel.l;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = x + 0.5 - R,
            dy = y + 0.5 - R;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > R) continue;
          const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
          const s = d / R;
          const i = (y * size + x) * 4;
          px[i] = hslChannel(0, h, s, l) * 255;
          px[i + 1] = hslChannel(8, h, s, l) * 255;
          px[i + 2] = hslChannel(4, h, s, l) * 255;
          px[i + 3] = Math.min(1, R - d) * 255; // bord adouci
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    function showWheel() {
      paintWheel();
      const r = (wheel.el.clientWidth || 168) / 2;
      const ang = (wheel.h * Math.PI) / 180;
      wheel.thumb.style.left = `${r + Math.cos(ang) * wheel.s * r}px`;
      wheel.thumb.style.top = `${r + Math.sin(ang) * wheel.s * r}px`;
      wheel.thumb.style.setProperty('--thumb', wheel.hex);
      wheel.el.setAttribute('aria-valuenow', String(Math.round(wheel.h)));
      wheel.el.setAttribute(
        'aria-valuetext',
        t('settings.wheelValue', { hue: Math.round(wheel.h), saturation: Math.round(wheel.s * 100), hex: wheel.hex }),
      );
      $('customLightOut').textContent = pct(wheel.l);
      $('customLight').setAttribute('aria-valuetext', t('volume.percent', { value: Math.round(wheel.l * 100) }));
      if (document.activeElement !== $('customLight')) $('customLight').value = String(wheel.l);
      if (document.activeElement !== $('customHex')) $('customHex').value = wheel.hex;
      paletteFromCustom(wheel.hex).forEach((c, i) => ($(`customChip${i + 1}`).style.background = c));
    }
    // Grouped send (at most ~16 times per second during a drag): each send
    // goes out to every window.
    function sendColor() {
      if (wheel.timer) {
        wheel.pending = true;
        return;
      }
      bridge.setSettings({ customColor: wheel.hex, theme: 'custom' });
      wheel.timer = setTimeout(() => {
        wheel.timer = 0;
        if (wheel.pending) {
          wheel.pending = false;
          sendColor();
        }
      }, 60);
    }
    function setHsl(h, s, l) {
      wheel.h = ((h % 360) + 360) % 360;
      wheel.s = Math.max(0, Math.min(1, s));
      wheel.l = Math.max(0.1, Math.min(0.9, l));
      wheel.hex = hslToHex(wheel.h, wheel.s, wheel.l);
      $('customHex').removeAttribute('aria-invalid');
      $('customHexState').textContent = '';
      showWheel();
      sendColor();
    }
    // Color received from the settings: the wheel takes it, except while it is being handled.
    function wheelFrom(hex) {
      if (!hex || hex === wheel.hex || wheel.dragging || wheel.timer) return;
      const [h, s, l] = rgbToHsl(...hexToRgb(hex));
      // Gray (zero saturation): the hue means nothing, keep the previous one.
      if (s > 0.001) wheel.h = h;
      wheel.s = s;
      wheel.l = Math.max(0.1, Math.min(0.9, l));
      wheel.hex = hex;
      showWheel();
    }
    function pickAt(e) {
      const rect = wheel.el.getBoundingClientRect();
      const r = rect.width / 2;
      const dx = e.clientX - rect.left - r,
        dy = e.clientY - rect.top - r;
      setHsl((Math.atan2(dy, dx) * 180) / Math.PI, Math.hypot(dx, dy) / r, wheel.l);
    }
    wheel.el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      wheel.dragging = true;
      wheel.el.setPointerCapture(e.pointerId);
      wheel.el.focus();
      pickAt(e);
    });
    wheel.el.addEventListener('pointermove', (e) => {
      if (wheel.dragging) pickAt(e);
    });
    const endDrag = () => {
      wheel.dragging = false;
    };
    wheel.el.addEventListener('pointerup', endDrag);
    wheel.el.addEventListener('pointercancel', endDrag);
    wheel.el.addEventListener('keydown', (e) => {
      const big = e.shiftKey;
      const dh = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      const ds = { ArrowUp: 1, ArrowDown: -1 }[e.key];
      if (dh === undefined && ds === undefined) return;
      e.preventDefault();
      if (dh) setHsl(wheel.h + dh * (big ? 15 : 3), wheel.s, wheel.l);
      else setHsl(wheel.h, wheel.s + ds * (big ? 0.1 : 0.03), wheel.l);
    });
    $('customLight').addEventListener('input', () => setHsl(wheel.h, wheel.s, Number($('customLight').value)));
    $('customHex').addEventListener('change', () => {
      let v = $('customHex').value.trim().toLowerCase();
      if (!v.startsWith('#')) v = `#${v}`;
      if (/^#[0-9a-f]{3}$/.test(v)) v = `#${[...v.slice(1)].map((x) => x + x).join('')}`;
      if (!/^#[0-9a-f]{6}$/.test(v)) {
        $('customHex').setAttribute('aria-invalid', 'true');
        $('customHexState').textContent = t('settings.hexInvalid');
        return;
      }
      $('customHex').removeAttribute('aria-invalid');
      $('customHexState').textContent = '';
      wheel.hex = '';
      wheelFrom(v);
      sendColor();
    });
    // "Custom" swatches: in the wheel's colors.
    function paintCustomSwatches(hex) {
      const pal = paletteFromCustom(hex);
      for (const b of [...themeSwatches, ...discSwatches]) {
        if (b.dataset.value !== 'custom') continue;
        const disc = b.querySelector('.disc');
        pal.forEach((c, i) => disc.style.setProperty(`--c${i + 1}`, c));
      }
    }

    // ----- Tabs (left menu) -----
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
      showWheel(); // the wheel has no size as long as its tab is hidden
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

    // ----- Search: across every section, only the settings found -----
    const items = [...document.querySelectorAll('#panels .item')];
    const panels = tabs.map(panelOf);
    const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    // Text of each setting (labels, options, help, keywords) and of its section.
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
        // Subtitles (Disc, Screen saver…) hidden if nothing under them is found.
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
          ? t(found > 1 ? 'settings.foundMany' : 'settings.foundOne', { n: found })
          : t('settings.foundNone', { query: $('search').value.trim() });
      if (on) $('panels').scrollTop = 0;
      showWheel();
      paintSoon();
    }
    function clearSearch() {
      $('search').value = '';
      runSearch();
    }
    $('search').addEventListener('input', runSearch);
    // Enter: go to the first setting found.
    $('search').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !searching()) return;
      const first = [...document.querySelectorAll('#panels .item:not(.miss):not(.hidden)')].find(
        (it) => it.offsetParent,
      );
      const target =
        first && first.querySelector('button[tabindex="0"], input, select, button:not([tabindex="-1"]):not(.hidden)');
      if (target) target.focus();
    });

    // ----- Animated previews: style gallery + live preview -----
    const { VISUALIZERS, THEMES, FakeAudio, themePalette } = window.SV;
    const gallery = [...document.querySelectorAll('#styleGallery button')];
    let current = {};
    const fake = new FakeAudio();
    // Reduced animations: Sillon setting or Windows setting. The previews stay still.
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const still = () => !!current.reduceMotion || motionQuery.matches;
    let needsPaint = true;
    motionQuery.addEventListener('change', () => {
      document.body.classList.toggle('reduce-motion', still());
      paintSoon();
    });
    radioGroup(gallery, (b) => bridge.setSettings({ style: b.dataset.style }));

    // Lightness: only the visible previews are drawn (tab open, on screen),
    // at 30 fps, nothing while scrolling (otherwise the window stutters) nor when the
    // window is hidden. The sizes are read once by the observer.
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
    // Restarts the drawing loop (it stops by itself when there is nothing to animate).
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
    // Preview palette: "wallpaper" and "cover" depend on the image of the
    // moment, unknown here; Sillon's violet is shown.
    const paletteOf = (s) => themePalette(s.theme, s.customColor) || THEMES.violet;
    function draw(now) {
      frame = 0;
      if (document.hidden) return;
      const frozen = still();
      const visible = previews.filter((p) => p.visible && p.w);
      // Still or nothing on screen: a single frame, then the loop stops.
      if ((frozen || !visible.length) && !needsPaint) return;
      frame = requestAnimationFrame(draw);
      if (scrolling || now - lastDraw < 1000 / 30 - 2) return;
      needsPaint = false;
      lastDraw = now;
      const t = frozen ? 1500 : now;
      const a = fake.frame(t);
      const pal = paletteOf(current);
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
      $('liveStyle').textContent = Catalog.name('style', style, t);
      $('liveTheme').textContent = s.theme ? Catalog.name('theme', s.theme, t) : '';
      live.c.style.opacity = String(Math.max(0.2, Math.min(1, Number(s.opacity) || 1)));
      document.body.style.setProperty('--pv1', paletteOf(s)[0]);
    }

    function fill(s) {
      const defaults = {
        layout: 'scene',
        sceneScreen: 'primary',
        sleepAfter: 0,
        discRays: 'fine',
        audioSource: 'app',
        language: 'auto',
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
      const customColor = s.customColor || Catalog.CUSTOM_DEFAULT;
      wheelFrom(customColor);
      paintCustomSwatches(customColor);
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
      $('globalShortcuts').checked = s.globalShortcuts !== false;
      // Only on opening and when the setting changes (not on every slider move).
      if (shownShortcuts !== s.globalShortcuts) {
        shownShortcuts = s.globalShortcuts;
        refreshShortcuts();
      }
      // Scene chosen and really shown (only on the wallpaper).
      const wantsScene = (s.layout || 'scene') !== 'strip';
      const scene = wantsScene && s.mode === 'wallpaper';
      $('tab-scene').classList.toggle('hidden', !scene);
      $('discColorsGroup').classList.toggle('hidden', !scene);
      $('sceneScreenRow').classList.toggle('hidden', !scene);
      $('sceneNeedsWallpaper').classList.toggle('hidden', !(wantsScene && s.mode !== 'wallpaper'));
      $('showNowPlayingRow').classList.toggle('hidden', scene);
      // The scene fills the whole desktop: nothing to move.
      $('editRow').classList.toggle('hidden', scene);
      // "Scene" tab open while the scene disappears: back to "Layout".
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
    // Esc: first clears the search, then closes the window.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (e.target === $('search') && $('search').value) {
        e.preventDefault();
        clearSearch();
        return;
      }
      window.close();
    });
    // Ctrl+F: go to the search.
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        $('search').focus();
        $('search').select();
      }
    });

    // ----- Spotify account -----
    $('spotifyClientId').addEventListener('change', () =>
      bridge.setSettings({ spotifyClientId: $('spotifyClientId').value.trim() }),
    );
    $('spotifyCustomClientId').addEventListener('change', () => {
      bridge.setSettings({ spotifyCustomClientId: $('spotifyCustomClientId').checked });
      setTimeout(() => bridge.spotifyStatus().then(showSpotify), 150);
    });
    $('spotifyLogin').onclick = () => {
      if ($('spotifyCustomClientId').checked)
        bridge.setSettings({ spotifyClientId: $('spotifyClientId').value.trim() });
      $('spotifyState').textContent = t('settings.spotify.connecting');
      $('spotifyState').className = 'state';
      setTimeout(() => bridge.spotifyLogin(), 200);
    };
    $('spotifyLogout').onclick = () => bridge.spotifyLogout();
    $('dashboard').onclick = () => bridge.openSpotifyDashboard();
    $('copyRedirect').onclick = async () => {
      await navigator.clipboard.writeText($('redirectUri').textContent);
      $('copyRedirect').textContent = t('settings.copied');
      setTimeout(() => {
        $('copyRedirect').textContent = t('settings.copy');
      }, 1500);
    };
    function showSpotify(st) {
      if (!st) return;
      if (st.redirectUri) $('redirectUri').textContent = st.redirectUri;
      $('spotifyLogin').textContent = st.connected ? t('settings.spotify.reconnect') : t('settings.spotify.login');
      $('spotifyLogout').classList.toggle('hidden', !st.connected);
      const el = $('spotifyState');
      el.textContent = st.error
        ? t('settings.error', { error: st.error })
        : !st.connected
          ? t('settings.spotify.notConnected')
          : st.needsReconnect
            ? t('settings.spotify.needsReconnect')
            : t('settings.spotify.connected');
      el.className = `state${st.error ? ' error' : st.connected ? ' ok' : ''}`;
    }
    bridge.onSpotifyStatus(showSpotify);
    bridge.spotifyStatus().then(showSpotify);

    // ----- Updates -----
    function showUpdate(u) {
      if (!u) return;
      const el = $('updateState');
      const v = t('settings.update.installed', { version: u.current }) + ' ';
      const text =
        {
          dev: t('settings.update.dev'),
          portable: t('settings.update.portable'),
          idle: v,
          checking: v + t('settings.update.checking'),
          uptodate: v + t('settings.update.upToDate'),
          downloading: v + t('settings.update.downloading', { version: u.version, progress: u.progress }),
          ready: t('settings.update.ready', { version: u.version }),
          error: t('settings.error', { error: v + u.error }),
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

    // ----- Scene and diagnostic -----
    $('openLayout').onclick = () => bridge.openLayoutEditor();
    $('copyDiagnostic').onclick = async () => {
      const el = $('diagnosticState');
      try {
        await bridge.copyDiagnostic();
        el.textContent = t('settings.diagnosticCopied');
        el.className = 'state ok';
      } catch (e) {
        el.textContent = t('settings.diagnosticFailed', { error: e.message });
        el.className = 'state error';
      }
    };

    bridge.onSettings(fill);
    bridge.getSettings().then(fill);
  }
})();
