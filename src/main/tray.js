// Menu de l'icône dans la zone de notification.

const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const S = require('./state');

const STYLES = [
  ['bars', 'Barres'], ['mirror', 'Miroir'], ['ring', 'Anneau'],
  ['wave', 'Onde'], ['aurora', 'Aurore'],
];
const THEMES = [
  ['wallpaper', 'Couleurs du fond d\'écran'],
  ['album', 'Couleurs de la pochette'], ['spotify', 'Spotify'], ['neon', 'Néon'],
  ['sunset', 'Coucher de soleil'], ['ocean', 'Océan'], ['mono', 'Blanc'],
];
const LAYOUTS = [
  ['scene', 'Scène : disque, paroles et panneau sur tout le bureau'],
  ['strip', 'Bandeau : barres et morceau en bas de l\'écran'],
];
const MODES = [
  ['wallpaper', 'Sur le fond d\'écran (derrière les fenêtres)'],
  ['top', 'Toujours au premier plan'],
  ['normal', 'Fenêtre normale'],
];

function radio(list, key) {
  return list.map(([value, label]) => ({
    label, type: 'radio', checked: S.settings.get(key) === value,
    click: () => S.actions.updateSettings({ [key]: value }),
  }));
}

function buildTray() {
  const A = S.actions;
  const set = (patch) => A.updateSettings(patch);
  const cmd = (c) => S.media && S.media.command(c);
  if (!S.tray) {
    S.tray = new Tray(nativeImage.createFromPath(path.join(S.ASSETS, 'tray.png')));
    S.tray.setToolTip('Sillon');
    S.tray.on('click', () => S.tray.popUpContextMenu());
  }
  const m = S.lastMedia;
  const now = m.active && m.title ? `${m.title} — ${m.artist || ''}`.slice(0, 60) : 'Rien en lecture';
  const s = S.settings.get();
  const offset = A.lyricsOffsetFor(m);
  const up = A.updateStatus ? A.updateStatus() : {};
  S.tray.setContextMenu(Menu.buildFromTemplate([
    ...(up.state === 'ready' ? [
      { label: `⬆ Redémarrer pour installer Sillon ${up.version}`, click: A.installUpdate },
      { type: 'separator' },
    ] : []),
    { label: now, enabled: false },
    ...(s.sceneHidden ? [{ label: 'Réafficher Sillon sur le bureau', click: () => set({ sceneHidden: false }) }] : []),
    { label: 'Lecture / pause', click: () => cmd('playpause') },
    { label: 'Suivant', click: () => cmd('next') },
    { label: 'Précédent', click: () => cmd('previous') },
    { label: 'Lecture aléatoire', type: 'checkbox', checked: !!m.shuffle, click: () => cmd('shuffle') },
    { label: 'Répéter', type: 'checkbox', checked: !!m.repeat && m.repeat !== 'None', click: () => cmd('repeat') },
    { type: 'separator' },
    ...(m.active && m.title ? [{
      label: `Paroles de ce morceau : décalage ${offset > 0 ? '+' : ''}${offset.toFixed(2)} s`,
      submenu: [
        { label: 'Plus tôt (+0,25 s)', click: () => A.nudgeLyrics(0.25) },
        { label: 'Plus tard (−0,25 s)', click: () => A.nudgeLyrics(-0.25) },
        { label: 'Réinitialiser', click: () => A.nudgeLyrics(null) },
      ],
    }] : []),
    { type: 'separator' },
    { label: 'Style', submenu: radio(STYLES, 'style') },
    { label: 'Couleurs', submenu: radio(THEMES, 'theme') },
    { label: 'Disposition', submenu: radio(LAYOUTS, 'layout') },
    { label: 'Position', submenu: radio(MODES, 'mode') },
    {
      label: 'Réglages', submenu: [
        { label: 'Afficher le morceau en cours', type: 'checkbox', checked: s.showNowPlaying,
          click: (i) => set({ showNowPlaying: i.checked }) },
        { label: 'Afficher les paroles', type: 'checkbox', checked: s.showLyrics !== false,
          click: (i) => set({ showLyrics: i.checked }) },
        { label: 'Afficher le panneau (scène)', type: 'checkbox', checked: s.showPanel !== false,
          click: (i) => set({ showPanel: i.checked }) },
        { label: 'Sensibilité', submenu: [0.6, 1, 1.5, 2.2].map((v) => ({
          label: `× ${v}`, type: 'radio', checked: s.sensitivity === v, click: () => set({ sensitivity: v }) })) },
        { label: 'Opacité', submenu: [0.4, 0.6, 0.8, 1].map((v) => ({
          label: `${v * 100} %`, type: 'radio', checked: s.opacity === v, click: () => set({ opacity: v }) })) },
        { label: 'Images par seconde', submenu: [30, 60].map((v) => ({
          label: `${v}`, type: 'radio', checked: s.fps === v, click: () => set({ fps: v }) })) },
        { label: 'Suivre en priorité', submenu: [
          { label: 'Spotify', type: 'radio', checked: s.preferApp === 'spotify', click: () => set({ preferApp: 'spotify' }) },
          { label: 'Le lecteur actif (YouTube, VLC…)', type: 'radio', checked: !s.preferApp, click: () => set({ preferApp: '' }) },
        ] },
        { label: 'Écran de veille', submenu: [
          ...[0, 1, 2, 5, 10, 15, 30].map((v) => ({
            label: v ? `Après ${v} min d'inactivité` : 'Jamais', type: 'radio',
            checked: Number(s.veilleDelay) === v, click: () => set({ veilleDelay: v }) })),
          { type: 'separator' },
          { label: 'Seulement pendant la lecture', type: 'checkbox', checked: s.veilleOnlyPlaying !== false,
            click: (i) => set({ veilleOnlyPlaying: i.checked }) },
          { label: 'Verrouiller la session en sortant', type: 'checkbox', checked: s.veilleLock !== false,
            click: (i) => set({ veilleLock: i.checked }) },
        ] },
        { label: 'Lancer au démarrage de Windows', type: 'checkbox', checked: s.launchAtLogin,
          click: (i) => set({ launchAtLogin: i.checked }) },
        { label: 'Mises à jour automatiques', type: 'checkbox', checked: s.autoUpdate !== false,
          enabled: !!up.enabled, click: (i) => set({ autoUpdate: i.checked }) },
        { label: up.enabled ? `Rechercher les mises à jour (version ${up.current})` : `Version ${up.current || ''} (développement)`,
          enabled: !!up.enabled, click: A.checkUpdates },
        { label: 'Remettre la position par défaut', click: () => { S.settings.set({ bounds: null }); A.applyMode(); } },
      ],
    },
    { type: 'separator' },
    { label: 'Paramètres…', click: A.openSettings },
    { label: S.editing ? '✔ Terminer le placement' : 'Déplacer / redimensionner…', click: () => A.setEditing(!S.editing),
      enabled: S.editing || !A.isScene() },
    { label: 'Plein écran   Ctrl+Alt+F', click: A.toggleFullscreen },
    { label: 'Écran de veille   Ctrl+Alt+L', click: A.startVeille },
    { type: 'separator' },
    { label: 'Quitter', click: () => app.quit() },
  ]));
}

module.exports = { buildTray };
