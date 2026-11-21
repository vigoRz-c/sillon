/* Faux pont Electron pour prévisualiser les pages dans un navigateur, sans Windows.
   Paramètres d'URL : ?style=bars&theme=album  */
(function () {
  const params = new URLSearchParams(location.search);
  const listeners = { settings: [], media: [], editing: [] };
  const settings = {
    style: params.get('style') || 'bars', theme: params.get('theme') || 'album',
    mode: 'normal', showNowPlaying: true, opacity: 1, sensitivity: 1, fps: 60,
  };

  // Pochette de démo dessinée à la volée.
  const c = document.createElement('canvas'); c.width = c.height = 300;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 300, 300);
  g.addColorStop(0, '#ff3d7f'); g.addColorStop(1, '#5b2bff');
  x.fillStyle = g; x.fillRect(0, 0, 300, 300);
  x.fillStyle = 'rgba(255,255,255,.85)'; x.beginPath(); x.arc(150, 150, 70, 0, 7); x.fill();
  x.fillStyle = '#111'; x.beginPath(); x.arc(150, 150, 12, 0, 7); x.fill();

  const media = {
    active: true, app: 'Spotify.exe', title: 'Morceau de démonstration', artist: 'Sillon',
    album: 'Démo', status: 'Playing', position: 42, duration: 214, updated: Date.now(),
    cover: c.toDataURL('image/png'), newTrack: true,
  };

  window.bridge = {
    getSettings: async () => settings,
    setSettings: (p) => { Object.assign(settings, p); listeners.settings.forEach((f) => f(settings)); },
    onSettings: (f) => listeners.settings.push(f),
    onMedia: (f) => { listeners.media.push(f); setTimeout(() => f(media), 50); },
    onEditing: (f) => listeners.editing.push(f),
    command: (c) => console.log('commande', c),
    editDone: () => {}, resizeTo: () => {}, closeFullscreen: () => {},
    openSettings: () => window.open('settings.html', 'settings', 'width=420,height=600'),
    startEditing: () => {}, resetBounds: () => {},
  };

  // Son de synthèse : grosse caisse, basse et nappe, pour faire bouger les visuels.
  window.addEventListener('load', () => {
    const ctx = new AudioContext();
    const out = ctx.createGain(); out.gain.value = 0.9;
    const pad = ctx.createOscillator(); pad.type = 'sawtooth'; pad.frequency.value = 220;
    const padGain = ctx.createGain(); padGain.gain.value = 0.15; pad.connect(padGain).connect(out); pad.start();
    const hi = ctx.createOscillator(); hi.type = 'square'; hi.frequency.value = 1760;
    const hiGain = ctx.createGain(); hiGain.gain.value = 0.03; hi.connect(hiGain).connect(out); hi.start();
    const bass = ctx.createOscillator(); bass.frequency.value = 55;
    const bassGain = ctx.createGain(); bassGain.gain.value = 0; bass.connect(bassGain).connect(out); bass.start();
    let t = ctx.currentTime;
    for (let i = 0; i < 400; i++, t += 0.5) {
      bassGain.gain.setValueAtTime(1, t); bassGain.gain.exponentialRampToValueAtTime(0.01, t + 0.35);
      padGain.gain.setValueAtTime(0.1 + 0.1 * Math.sin(i), t);
    }
    window.sillon.engine.useNode(out);
    ctx.resume();
  });
})();
