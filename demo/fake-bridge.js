/* Fake Electron bridge (window.bridge) for the browser demo.
 *
 * Loaded by demo/index.html BEFORE the scripts of the real page (src/renderer/pages),
 * inside its iframe. It exposes exactly the methods of
 * src/main/app/preload.js: test/ipc-contract.test.js checks that both lists
 * stay identical. Default settings: those of src/main/app/settings-schema.js.
 *
 * URL parameters of demo/index.html (read in the parent page):
 *   ?page=widget|fullscreen|settings|controls  &style=ring  &theme=violet  &mode=normal
 */
(function () {
  'use strict';

  // Same origin as demo/index.html: read its URL parameters.
  const top = window.top && window.top !== window ? window.top : window;
  const params = new URLSearchParams(top.location.search);

  // Default values of settings-schema.js (fps 30, reduced animations off).
  const settings = {
    style: 'bars',
    theme: 'wallpaper',
    customColor: '#8b5cf6',
    mode: 'wallpaper',
    layout: 'scene',
    showLyrics: true,
    sceneHidden: false,
    sceneScreen: 'primary',
    gameMode: true,
    dimOnPause: true,
    sleepAfter: 0,
    lyricsOffsets: {},
    discIntensity: 1.3,
    discRays: 'fine',
    discColors: 'album',
    discBloom: 0.8,
    edgeGlow: 0.8,
    panelRing: true,
    reduceMotion: false,
    veilleDelay: 5,
    veilleOnlyPlaying: true,
    veilleLock: true,
    spotifyCustomClientId: false,
    spotifyClientId: '',
    bounds: null,
    showNowPlaying: true,
    opacity: 1,
    sensitivity: 1,
    audioSource: 'app',
    fps: 30,
    preferApp: 'spotify',
    launchAtLogin: false,
    autoUpdate: true,
    globalShortcuts: true,
  };
  for (const key of ['style', 'theme', 'mode', 'layout']) if (params.get(key)) settings[key] = params.get(key);

  // ----- Subscriptions: each onXxx(cb) registers cb, emit() calls it -----
  const subs = {};
  const on = (name) => (cb) => {
    (subs[name] = subs[name] || []).push(cb);
  };
  const emit = (name, payload) => (subs[name] || []).forEach((cb) => cb(payload));
  const later = (fn, ms = 50) => setTimeout(fn, ms);

  // Demo drawings: cover and wallpaper as gradients.
  function drawImage(w, h, from, to, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, from);
    g.addColorStop(1, to);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    if (draw) draw(x, w, h);
    return c.toDataURL('image/png');
  }
  const cover = drawImage(300, 300, '#ff3d7f', '#5b2bff', (x) => {
    x.fillStyle = 'rgba(255,255,255,.85)';
    x.beginPath();
    x.arc(150, 150, 70, 0, 7);
    x.fill();
    x.fillStyle = '#111';
    x.beginPath();
    x.arc(150, 150, 12, 0, 7);
    x.fill();
  });
  const wallpaper = drawImage(640, 360, '#0f766e', '#f59e0b');

  const media = {
    active: true,
    app: 'Spotify.exe',
    title: 'Demo track',
    artist: 'Sillon',
    album: 'Demo',
    status: 'Playing',
    position: 42,
    duration: 214,
    updated: Date.now(),
    cover,
    newTrack: true,
  };

  const lyrics = {
    title: media.title,
    artist: media.artist,
    instrumental: false,
    lines: ['First line', 'Second line', 'Third line', 'Fourth line', 'Fifth line', 'Sixth line'].map((text, i) => ({
      t: 10 + i * 30,
      end: 40 + i * 30,
      text,
      words: null,
    })),
  };

  const queue = {
    items: [
      { title: 'Titre suivant', artist: 'Artiste A' },
      { title: 'Autre morceau', artist: 'Artiste B' },
      { title: 'Encore un', artist: 'Artiste C' },
    ],
  };

  // Synthetic sound (kick drum, bass and pad) to move the visuals.
  // The audio context only starts after a user gesture (see resumeAudio).
  let audio = null;
  function startAudio() {
    if (audio || !window.AudioContext) return;
    const ctx = new AudioContext();
    const out = ctx.createGain();
    out.gain.value = 0.9;
    const pad = ctx.createOscillator();
    pad.type = 'sawtooth';
    pad.frequency.value = 220;
    const padGain = ctx.createGain();
    padGain.gain.value = 0.15;
    pad.connect(padGain).connect(out);
    pad.start();
    const hi = ctx.createOscillator();
    hi.type = 'square';
    hi.frequency.value = 1760;
    const hiGain = ctx.createGain();
    hiGain.gain.value = 0.03;
    hi.connect(hiGain).connect(out);
    hi.start();
    const bass = ctx.createOscillator();
    bass.frequency.value = 55;
    const bassGain = ctx.createGain();
    bassGain.gain.value = 0;
    bass.connect(bassGain).connect(out);
    bass.start();
    let t = ctx.currentTime;
    for (let i = 0; i < 400; i++, t += 0.5) {
      bassGain.gain.setValueAtTime(1, t);
      bassGain.gain.exponentialRampToValueAtTime(0.01, t + 0.35);
      padGain.gain.setValueAtTime(0.1 + 0.1 * Math.sin(i), t);
    }
    if (window.sillon && window.sillon.engine) window.sillon.engine.useNode(out);
    audio = ctx;
  }
  function resumeAudio() {
    startAudio();
    if (audio && audio.state !== 'running') audio.resume();
    return audio && audio.state === 'running';
  }

  window.bridge = {
    // Settings
    getSettings: async () => JSON.parse(JSON.stringify(settings)),
    setSettings: (patch) => {
      Object.assign(settings, JSON.parse(JSON.stringify(patch || {})));
      later(() => emit('settings', JSON.parse(JSON.stringify(settings))), 0);
    },
    onSettings: on('settings'),
    getLanguage: async () => (settings.language === 'fr' || settings.language === 'en' ? settings.language : 'en'),
    onLanguage: on('language'),

    // Track, lyrics, queue, wallpaper
    onMedia: (cb) => {
      on('media')(cb);
      later(() => cb(media));
    },
    onLyrics: (cb) => {
      on('lyrics')(cb);
      later(() => cb(lyrics));
    },
    onQueue: (cb) => {
      on('queue')(cb);
      later(() => cb(queue));
    },
    onWallpaper: (cb) => {
      on('wallpaper')(cb);
      later(() => cb(wallpaper));
    },
    onEditorBackground: (cb) => {
      on('editor-background')(cb);
      later(() => cb(wallpaper));
    },
    onRenderPause: on('render-pause'),
    reportControlsRect: () => {},
    nudgeLyrics: (delta) => console.log('lyrics offset', delta),
    command: (c) => console.log('commande', c),
    setVolume: (percent) => console.log('volume', percent),

    // Spotify
    spotifyStatus: async () => ({ connected: false, redirectUri: 'http://127.0.0.1:43821/callback' }),
    onSpotifyStatus: on('spotify-status'),
    spotifyLogin: () => console.log('Spotify sign-in (demo)'),
    spotifyLogout: () => console.log('Spotify sign-out (demo)'),
    openSpotifyDashboard: () => {},
    copyDiagnostic: async () => true,

    // Updates
    updateStatus: async () => ({ state: 'dev', enabled: false, auto: true, current: '0.2.0' }),
    onUpdateStatus: on('update-status'),
    checkUpdates: () => {},
    installUpdate: () => {},

    // Global keyboard shortcuts: all active in the demo (unless turned off).
    shortcutsStatus: async () => ({
      enabled: settings.globalShortcuts !== false,
      items: (window.SillonShortcuts ? window.SillonShortcuts.SHORTCUTS : []).map((s) => ({
        id: s.id,
        state: settings.globalShortcuts !== false ? 'ok' : 'off',
      })),
    }),

    // Son
    onAudioStart: on('audio-start'),
    onAudioPcm: on('audio-pcm'),

    // Windows and editing
    openSettings: () => top.dispatchEvent(new CustomEvent('sillon-demo', { detail: { page: 'settings' } })),
    closeFullscreen: () => top.dispatchEvent(new CustomEvent('sillon-demo', { detail: { page: 'widget' } })),
    editDone: () => {},
    resizeTo: () => {},
    onEditing: (cb) => {
      on('editing')(cb);
      later(() => cb(false), 0);
    },
    startEditing: () => {},
    resetBounds: () => {},
    startVeille: () => {},
    veilleExit: () => {},
    openLayoutEditor: () => {},
    layoutDone: () => {},
    layoutCancel: () => {},
  };

  // What the parent page (demo/index.html) can call.
  window.sillonDemo = { resumeAudio };

  window.addEventListener('load', startAudio);
})();
