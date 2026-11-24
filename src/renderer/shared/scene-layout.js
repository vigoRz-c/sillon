/* Layout of the scene: where each element is, whether it is shown, its size.
 *
 * Shared by the scene (widget.js), the layout editor and the tests
 * (node). Positions are fractions of the scene area (0 to 1), so they
 * stay right when the resolution or the display changes.
 *
 * Each element is placed by an anchor point (ax, ay) taken in its own
 * box: 0,0 = top left corner, 0.5,0.5 = center, 1,0 = top right corner.
 * x, y say where that point is on the screen.
 */
(function (root) {
  'use strict';

  // id -> description. scale: relative size (1 = original size).
  // w / h: width / height as a fraction of the screen (stretchable elements).
  const ELEMENTS = {
    disc: { label: 'Disc', ax: 0.5, ay: 0.5, scale: [0.4, 2.2] },
    lyrics: { label: 'Lyrics', ax: 0.5, ay: 0.5, scale: [0.5, 1.8], w: [0.15, 0.95] },
    title: { label: 'Big title', ax: 0.5, ay: 0.5, scale: [0.4, 1.6] },
    cover: { label: 'Panel cover', ax: 0.5, ay: 0.5, scale: [0.4, 2] },
    info: { label: 'Now playing', ax: 0, ay: 0, scale: [0.6, 2] },
    buttons: { label: 'Buttons', ax: 0, ay: 0, scale: [1, 1] },
    queue: { label: 'Up next', ax: 0, ay: 0, scale: [0.6, 2] },
    clock: { label: 'Clock', ax: 1, ay: 0, scale: [0.5, 2.5] },
    bars: { label: 'Bars', ax: 0.5, ay: 0.5, scale: [1, 1], w: [0.1, 1], h: [0.04, 0.5] },
  };
  const ORDER = ['disc', 'lyrics', 'title', 'cover', 'info', 'buttons', 'queue', 'clock', 'bars'];

  // Original layout (the one from before the editor).
  const DEFAULTS = {
    disc: { x: 0.6, y: 0.45, scale: 1, visible: true },
    lyrics: { x: 0.27, y: 0.42, scale: 1, w: 0.42, visible: true },
    title: { x: 0.5, y: 0.12, scale: 1, visible: true },
    cover: { x: 0, y: 0.72, scale: 1, visible: true },
    info: { x: 0.085, y: 0.655, scale: 1, visible: true },
    buttons: { x: 0.085, y: 0.6, scale: 1, visible: true },
    queue: { x: 0.085, y: 0.77, scale: 1, visible: true },
    clock: { x: 0.97, y: 0.035, scale: 1, visible: true },
    bars: { x: 0.5, y: 0.9, scale: 1, w: 0.5, h: 0.12, visible: false },
  };

  // Ready-made templates (only the differences with DEFAULTS).
  const PRESETS = {
    default: { label: 'Default', layout: {} },
    minimal: {
      label: 'Minimal',
      layout: {
        lyrics: { visible: false },
        title: { visible: false },
        queue: { visible: false },
        clock: { visible: false },
        disc: { x: 0.5, y: 0.45, scale: 1.2 },
      },
    },
    lyricsOnly: {
      label: 'Lyrics only',
      layout: {
        disc: { visible: false },
        cover: { visible: false },
        info: { visible: false },
        buttons: { visible: false },
        queue: { visible: false },
        title: { visible: false },
        lyrics: { x: 0.5, y: 0.45, w: 0.8, scale: 1.4 },
      },
    },
    empty: {
      label: 'Empty',
      layout: Object.fromEntries(ORDER.map((id) => [id, { visible: false }])),
    },
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

  // Brings an element back to safe values (position on screen, size
  // within the element's limits).
  function clampElement(id, el) {
    const spec = ELEMENTS[id],
      d = DEFAULTS[id];
    const out = {
      x: clamp(num(el && el.x, d.x), 0, 1),
      y: clamp(num(el && el.y, d.y), 0, 1),
      scale: clamp(num(el && el.scale, d.scale), spec.scale[0], spec.scale[1]),
      visible: el && typeof el.visible === 'boolean' ? el.visible : d.visible,
    };
    if (spec.w) out.w = clamp(num(el && el.w, d.w), spec.w[0], spec.w[1]);
    if (spec.h) out.h = clamp(num(el && el.h, d.h), spec.h[0], spec.h[1]);
    return out;
  }

  // Full layout from the settings. Without a saved layout, the old
  // settings are used (disc position and size, lyrics, panel and clock
  // shown or not).
  function fromSettings(s) {
    s = s || {};
    const saved = s.sceneLayout && typeof s.sceneLayout === 'object' ? s.sceneLayout : null;
    const out = {};
    for (const id of ORDER) {
      let el = saved ? saved[id] : null;
      if (!saved) {
        el = { ...DEFAULTS[id] };
        if (id === 'disc') {
          el.x = num(s.discX, el.x);
          el.y = num(s.discY, el.y);
          el.scale = num(s.discSize, el.scale);
        }
        if (id === 'lyrics' && s.showLyrics === false) el.visible = false;
        if (['cover', 'info', 'buttons', 'queue'].includes(id) && s.showPanel === false) el.visible = false;
        if (id === 'clock' && s.showClock === false) el.visible = false;
      }
      out[id] = clampElement(id, el);
    }
    return out;
  }

  // Applies a template: DEFAULTS + its differences.
  function preset(name) {
    const p = PRESETS[name] || PRESETS.default;
    const out = {};
    for (const id of ORDER) out[id] = clampElement(id, { ...DEFAULTS[id], ...(p.layout[id] || {}) });
    return out;
  }

  const api = { ELEMENTS, ORDER, DEFAULTS, PRESETS, clampElement, fromSettings, preset };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SceneLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
