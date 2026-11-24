/* Sillon — colors: conversions, palettes taken from a cover or a
   color, opacity (withAlpha / prepareColor).
   Classic script: exposes window.SillonColors. Loaded before visualizers.js. */
(function () {
  'use strict';

  function hexToRgb(h) {
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    let h = 0,
      s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [h * 360, s, l];
  }
  const hsl = (h, s, l) => `hsl(${((h % 360) + 360) % 360} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;

  // 3 colors taken from the cover. A gray cover gives tinted whites
  // rather than a made-up color.
  function paletteFromImage(img, { soft = false } = {}) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0, 32, 32);
    const px = x.getImageData(0, 0, 32, 32).data;
    const buckets = new Map();
    for (let i = 0; i < px.length; i += 4) {
      const [h, s, l] = rgbToHsl(px[i], px[i + 1], px[i + 2]);
      if (l < 0.08 || l > 0.95) continue;
      const key = Math.round(h / 24);
      const w = s * (1 - Math.abs(l - 0.5));
      const b = buckets.get(key) || { w: 0, h: 0, s: 0, l: 0, n: 0 };
      b.w += w;
      b.h += h * w;
      b.s += s * w;
      b.l += l * w;
      b.n++;
      buckets.set(key, b);
    }
    const ranked = [...buckets.values()]
      .filter((b) => b.w > 0)
      .map((b) => ({ h: b.h / b.w, s: b.s / b.w, l: b.l / b.w, w: b.w }))
      .sort((a, b) => b.w - a.w);
    const totalW = ranked.reduce((a, b) => a + b.w, 0);
    if (!ranked.length || totalW / 1024 < 0.05) {
      const tint = ranked[0] ? ranked[0].h : 220;
      return [hsl(tint, 0.25, 0.85), hsl(tint, 0.1, 0.97), hsl(tint + 30, 0.3, 0.75)];
    }
    const main = ranked[0];
    const second = ranked.find((b) => Math.abs(((b.h - main.h + 540) % 360) - 180) < 150) || { h: main.h + 40 };
    if (soft) {
      // Soft, light tones taken from the wallpaper: they blend in instead of standing out.
      const ss = Math.min(0.75, Math.max(0.35, main.s));
      return [
        hsl(main.h, ss, 0.72),
        hsl(second.h, Math.min(0.75, Math.max(0.35, second.s || ss)), 0.78),
        hsl(main.h + 15, ss * 0.8, 0.9),
      ];
    }
    const s = Math.max(0.6, main.s);
    return [hsl(main.h, s, 0.55), hsl(second.h, Math.max(0.6, second.s || s), 0.6), hsl(main.h + 20, s, 0.75)];
  }

  // A picked color -> palette of 3 by sweeping the hue both ways.
  function paletteFromColor(hex) {
    const [h, s] = rgbToHsl(...hexToRgb(hex));
    return [hsl(h - 28, Math.max(0.6, s), 0.55), hsl(h, Math.max(0.65, s), 0.6), hsl(h + 28, Math.max(0.6, s), 0.72)];
  }

  // Color wheel color -> palette of 3. Unlike paletteFromColor, the picked
  // saturation and lightness are kept: the main one is the exact color
  // (glows, halo), the secondary a neighboring hue, the highlight a lighter
  // version. Invalid color: Sillon violet.
  function paletteFromCustom(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) hex = '#8b5cf6';
    const [h, s, l] = rgbToHsl(...hexToRgb(hex));
    const clamp = (v) => Math.max(0.08, Math.min(0.95, v));
    return [hex.toLowerCase(), hsl(h + 24, s, clamp(l * 0.95 + 0.04)), hsl(h - 16, s * 0.85, clamp(l + 0.2))];
  }

  // "hsl(10 80% 50%)" or "#rrggbb" -> same color with an opacity.
  // The start of the string ("rgba(r, g, b, " or "hsl(… / ") is computed once
  // per color (see prepareColor, called when the palette changes): every
  // frame only the opacity is left to append.
  const colorPrefix = new Map();
  function prepareColor(color) {
    let p = colorPrefix.get(color);
    if (p === undefined) {
      if (color.startsWith('#')) {
        const [r, g, b] = hexToRgb(color);
        p = `rgba(${r}, ${g}, ${b}, `;
      } else if (color.startsWith('hsl(')) p = color.slice(0, -1) + ' / ';
      else p = null;
      if (colorPrefix.size > 256) colorPrefix.clear();
      colorPrefix.set(color, p);
    }
    return p;
  }
  function withAlpha(color, alpha) {
    const p = prepareColor(color);
    return p === null ? color : p + Math.round(alpha * 1000) / 1000 + ')';
  }

  window.SillonColors = {
    hexToRgb,
    rgbToHsl,
    paletteFromImage,
    paletteFromColor,
    paletteFromCustom,
    prepareColor,
    withAlpha,
  };
})();
