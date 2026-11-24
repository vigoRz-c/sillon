/* Faux pont Electron (window.bridge) pour la démo navigateur.
 *
 * Chargé par demo/index.html AVANT les scripts de la vraie page (src/renderer/pages),
 * à l'intérieur de son iframe. Il expose exactement les méthodes de
 * src/main/app/preload.js : test/ipc-contract.test.js vérifie que les deux listes
 * restent identiques. Réglages par défaut : ceux de src/main/app/settings-schema.js.
 *
 * Paramètres d'URL de demo/index.html (lus dans la page parente) :
 *   ?page=widget|fullscreen|settings|controls  &style=ring  &theme=violet  &mode=normal
 */
(function () {
  'use strict';

  // Même origine que demo/index.html : on lit ses paramètres d'URL.
  const top = window.top && window.top !== window ? window.top : window;
  const params = new URLSearchParams(top.location.search);

  // Valeurs par défaut de settings-schema.js (fps 30, réduction des animations désactivée).
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
  };
  for (const key of ['style', 'theme', 'mode', 'layout']) if (params.get(key)) settings[key] = params.get(key);

  // ----- Abonnements : chaque onXxx(cb) enregistre cb, emit() l'appelle -----
  const subs = {};
  const on = (name) => (cb) => {
    (subs[name] = subs[name] || []).push(cb);
  };
  const emit = (name, payload) => (subs[name] || []).forEach((cb) => cb(payload));
  const later = (fn, ms = 50) => setTimeout(fn, ms);

  // Dessins de démo : pochette et fond d'écran en dégradé.
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
    title: 'Morceau de démonstration',
    artist: 'Sillon',
    album: 'Démo',
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
    lines: ['Premier vers', 'Deuxième vers', 'Troisième vers', 'Quatrième vers', 'Cinquième vers', 'Sixième vers'].map(
      (text, i) => ({ t: 10 + i * 30, end: 40 + i * 30, text, words: null }),
    ),
  };

  const queue = {
    items: [
      { title: 'Titre suivant', artist: 'Artiste A' },
      { title: 'Autre morceau', artist: 'Artiste B' },
      { title: 'Encore un', artist: 'Artiste C' },
    ],
  };

  // Son de synthèse (grosse caisse, basse et nappe) pour faire bouger les visuels.
  // Le contexte audio ne démarre qu'après un geste de l'utilisateur (voir resumeAudio).
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
    // Réglages
    getSettings: async () => JSON.parse(JSON.stringify(settings)),
    setSettings: (patch) => {
      Object.assign(settings, JSON.parse(JSON.stringify(patch || {})));
      later(() => emit('settings', JSON.parse(JSON.stringify(settings))), 0);
    },
    onSettings: on('settings'),

    // Morceau, paroles, file, fond d'écran
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
    nudgeLyrics: (delta) => console.log('décalage des paroles', delta),
    command: (c) => console.log('commande', c),
    setVolume: (percent) => console.log('volume', percent),

    // Spotify
    spotifyStatus: async () => ({ connected: false, redirectUri: 'http://127.0.0.1:43821/callback' }),
    onSpotifyStatus: on('spotify-status'),
    spotifyLogin: () => console.log('connexion Spotify (démo)'),
    spotifyLogout: () => console.log('déconnexion Spotify (démo)'),
    openSpotifyDashboard: () => {},
    copyDiagnostic: async () => true,

    // Mises à jour
    updateStatus: async () => ({ state: 'dev', enabled: false, auto: true, current: '0.2.0' }),
    onUpdateStatus: on('update-status'),
    checkUpdates: () => {},
    installUpdate: () => {},

    // Son
    onAudioStart: on('audio-start'),
    onAudioPcm: on('audio-pcm'),

    // Fenêtres et édition
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

  // Ce que la page parente (demo/index.html) peut appeler.
  window.sillonDemo = { resumeAudio };

  window.addEventListener('load', startAudio);
})();
