/* Disposition de la scène : où est chaque élément, s'il est affiché, sa taille.
 *
 * Partagé par la scène (widget.js), l'éditeur de disposition et les tests
 * (node). Les positions sont en fractions de la zone de la scène (0 à 1), pour
 * rester justes quand la résolution ou l'écran change.
 *
 * Chaque élément est placé par un point d'ancrage (ax, ay) pris dans sa propre
 * boîte : 0,0 = coin haut gauche, 0.5,0.5 = centre, 1,0 = coin haut droit.
 * x, y disent où ce point se trouve sur l'écran.
 */
(function (root) {
  'use strict';

  // id -> description. scale : taille relative (1 = taille d'origine).
  // w / h : largeur / hauteur en fraction de l'écran (éléments étirables).
  const ELEMENTS = {
    disc: { label: 'Disque', ax: 0.5, ay: 0.5, scale: [0.4, 2.2] },
    lyrics: { label: 'Paroles', ax: 0.5, ay: 0.5, scale: [0.5, 1.8], w: [0.15, 0.95] },
    title: { label: 'Grand titre', ax: 0.5, ay: 0.5, scale: [0.4, 1.6] },
    cover: { label: 'Pochette du panneau', ax: 0.5, ay: 0.5, scale: [0.4, 2] },
    info: { label: 'En lecture', ax: 0, ay: 0, scale: [0.6, 2] },
    buttons: { label: 'Boutons', ax: 0, ay: 0, scale: [1, 1] },
    queue: { label: 'À suivre', ax: 0, ay: 0, scale: [0.6, 2] },
    clock: { label: 'Horloge', ax: 1, ay: 0, scale: [0.5, 2.5] },
    bars: { label: 'Barres', ax: 0.5, ay: 0.5, scale: [1, 1], w: [0.1, 1], h: [0.04, 0.5] },
  };
  const ORDER = ['disc', 'lyrics', 'title', 'cover', 'info', 'buttons', 'queue', 'clock', 'bars'];

  // Disposition d'origine (celle d'avant l'éditeur).
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

  // Modèles prêts à l'emploi (seules les différences avec DEFAULTS).
  const PRESETS = {
    default: { label: 'Par défaut', layout: {} },
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
      label: 'Paroles seules',
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
      label: 'Vide',
      layout: Object.fromEntries(ORDER.map((id) => [id, { visible: false }])),
    },
  };

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

  // Ramène un élément dans des valeurs sûres (position dans l'écran, taille
  // dans les limites de l'élément).
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

  // Disposition complète à partir des réglages. Sans disposition enregistrée,
  // on reprend les anciens réglages (position et taille du disque, paroles,
  // panneau et horloge affichés ou non).
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

  // Applique un modèle : DEFAULTS + ses différences.
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
