/* Logique commune widget / plein écran : réglages, couleurs, morceau en cours. */
(function () {
  'use strict';
  const { AudioEngine, Renderer, THEMES, paletteFromImage, paletteFromColor } = window.SV;

  function createApp(canvas, { onMedia, onPalette, onSettings, onLyrics, transformSettings } = {}) {
    const engine = new AudioEngine();
    const renderer = new Renderer(canvas, engine);
    const state = { settings: {}, media: { active: false }, albumPalette: null, wallpaperPalette: null, theme: 'wallpaper' };

    function applyPalette() {
      const t = state.theme;
      let pal;
      if (t === 'wallpaper') pal = state.wallpaperPalette || state.albumPalette || THEMES.mono;
      else if (t === 'album') pal = state.albumPalette || THEMES.neon;
      else if (t && t.startsWith('#')) pal = paletteFromColor(t);
      else pal = THEMES[t] || THEMES.neon;
      renderer.palette = pal;
      if (onPalette) onPalette(pal);
    }

    function applySettings(raw) {
      state.settings = raw;
      const s = transformSettings ? transformSettings(raw) : raw;
      renderer.style = s.style || 'bars';
      renderer.fps = s.fps || 60;
      engine.sensitivity = s.sensitivity || 1;
      state.theme = s.theme || 'wallpaper';
      applyPalette();
      if (onSettings) onSettings(s);
    }

    function applyMedia(m) {
      const coverChanged = m.cover !== state.media.cover;
      state.media = m;
      if (coverChanged) {
        if (m.cover) {
          const img = new Image();
          img.onload = () => { state.albumPalette = paletteFromImage(img); applyPalette(); };
          img.src = m.cover;
        } else {
          state.albumPalette = null;
          applyPalette();
        }
      }
      if (onMedia) onMedia(m, coverChanged);
    }

    // Branchement sur Electron (ou sur un faux pont pour la démo / les tests).
    const bridge = window.bridge;
    if (bridge) {
      bridge.onSettings(applySettings);
      bridge.onMedia(applyMedia);
      if (bridge.onLyrics && onLyrics) bridge.onLyrics(onLyrics);
      if (bridge.onWallpaper) bridge.onWallpaper((url) => {
        const img = new Image();
        img.onload = () => { state.wallpaperPalette = paletteFromImage(img, { soft: true }); applyPalette(); };
        img.src = url;
      });
      bridge.getSettings().then(applySettings);
    }

    // Appelé par le process principal avec un "geste utilisateur" simulé.
    window.spotiView = {
      startAudio: () => engine.startSystem(),
      engine, renderer, state, applySettings, applyMedia,
    };
    return { engine, renderer, state, applySettings, applyMedia, applyPalette };
  }

  window.SVApp = { createApp };
})();
