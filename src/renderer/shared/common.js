/* Logic shared by the widget and the full screen: settings, colors, current track. */
(function () {
  'use strict';
  const { AudioEngine, Renderer, THEMES, paletteFromImage, paletteFromColor, paletteFromCustom } = window.SV;

  function createApp(canvas, { onMedia, onPalette, onSettings, onLyrics, transformSettings } = {}) {
    const engine = new AudioEngine();
    const renderer = new Renderer(canvas, engine);
    const state = {
      settings: {},
      media: { active: false },
      albumPalette: null,
      wallpaperPalette: null,
      theme: 'wallpaper',
      coverImg: null, // cover decoded only once, shared with the pages
    };

    function applyPalette() {
      const t = state.theme;
      let pal;
      if (t === 'wallpaper') pal = state.wallpaperPalette || state.albumPalette || THEMES.mono;
      else if (t === 'album') pal = state.albumPalette || THEMES.neon;
      else if (t === 'custom') pal = paletteFromCustom(state.settings.customColor);
      else if (t && t.startsWith('#')) pal = paletteFromColor(t);
      else pal = THEMES[t] || THEMES.neon;
      renderer.palette = pal;
      if (onPalette) onPalette(pal);
    }

    // The system preference can change along the way.
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
      // Reduced motion: explicit setting or system preference.
      const reduce = !!(raw.reduceMotion || (reduceQuery && reduceQuery.matches));
      document.body.classList.toggle('reduce-motion', reduce);
      renderer.reduceMotion = reduce;
      engine.reduceMotion = reduce;
      applyPalette();
      if (onSettings) onSettings(s);
    }

    function applyMedia(m) {
      // Unchanged cover: the main process does not send it again (heavy).
      if (m.coverKept) {
        m = { ...m, cover: state.media.cover };
        delete m.coverKept;
      }
      const coverChanged = m.cover !== state.media.cover;
      state.media = m;
      if (coverChanged) {
        if (m.cover) {
          // A single image per cover: the palette and the disc use it.
          const img = new Image();
          state.coverImg = img;
          img.onload = () => {
            if (state.coverImg !== img) return; // cover already replaced
            state.albumPalette = paletteFromImage(img);
            applyPalette();
          };
          // Invalid image: do not inherit the previous track's palette.
          img.onerror = () => {
            if (state.coverImg !== img) return;
            state.coverImg = null;
            state.albumPalette = null;
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

    // Hooked to Electron (or to a fake bridge for the demo / tests).
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
      // The main process picks the source: all the PC's sound or only the followed player.
      if (bridge.onAudioStart)
        bridge.onAudioStart((kind) => (kind === 'app' ? engine.startApp(bridge) : engine.startSystem()));
      bridge.getSettings().then(applySettings);
    }

    // Only the engine stays exposed (the demo plugs simulated sound into it).
    window.sillon = { engine };
    return { engine, renderer, state, applySettings, applyMedia, applyPalette };
  }

  window.SVApp = { createApp };
})();
