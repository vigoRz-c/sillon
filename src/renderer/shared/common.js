/* Logique commune widget / plein écran : réglages, couleurs, morceau en cours. */
(function () {
  'use strict';
  const { AudioEngine, Renderer, THEMES, paletteFromImage, paletteFromColor } = window.SV;

  function createApp(canvas, { onMedia, onPalette, onSettings, onLyrics, transformSettings } = {}) {
    const engine = new AudioEngine();
    const renderer = new Renderer(canvas, engine);
    const state = {
      settings: {},
      media: { active: false },
      albumPalette: null,
      wallpaperPalette: null,
      theme: 'wallpaper',
      coverImg: null, // pochette décodée une seule fois, partagée avec les pages
    };

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

    // La préférence du système peut changer en cours de route.
    const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (reduceQuery && reduceQuery.addEventListener)
      reduceQuery.addEventListener('change', () => applySettings(state.settings));

    function applySettings(raw) {
      state.settings = raw;
      const s = transformSettings ? transformSettings(raw) : raw;
      renderer.style = s.style || 'bars';
      renderer.fps = s.fps || 30;
      engine.sensitivity = s.sensitivity || 1;
      state.theme = s.theme || 'wallpaper';
      // Animations réduites : réglage explicite ou préférence du système.
      const reduce = !!(raw.reduceMotion || (reduceQuery && reduceQuery.matches));
      document.body.classList.toggle('reduce-motion', reduce);
      renderer.reduceMotion = reduce;
      engine.reduceMotion = reduce;
      applyPalette();
      if (onSettings) onSettings(s);
    }

    function applyMedia(m) {
      const coverChanged = m.cover !== state.media.cover;
      state.media = m;
      if (coverChanged) {
        if (m.cover) {
          // Une seule image par pochette : la palette et le disque s'en servent.
          const img = new Image();
          state.coverImg = img;
          img.onload = () => {
            if (state.coverImg !== img) return; // pochette déjà remplacée
            state.albumPalette = paletteFromImage(img);
            applyPalette();
          };
          img.src = m.cover;
        } else {
          state.coverImg = null;
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
      if (bridge.onWallpaper)
        bridge.onWallpaper((url) => {
          const img = new Image();
          img.onload = () => {
            state.wallpaperPalette = paletteFromImage(img, { soft: true });
            applyPalette();
          };
          img.src = url;
        });
      // Le processus principal choisit la source : tout le son du PC ou le seul lecteur suivi.
      if (bridge.onAudioStart)
        bridge.onAudioStart((kind) => (kind === 'app' ? engine.startApp(bridge) : engine.startSystem()));
      bridge.getSettings().then(applySettings);
    }

    // Seul le moteur reste exposé (la démo y branche un son simulé).
    window.sillon = { engine };
    return { engine, renderer, state, applySettings, applyMedia, applyPalette };
  }

  window.SVApp = { createApp };
})();
