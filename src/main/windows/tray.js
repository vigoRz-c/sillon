// Menu of the icon in the notification area.

const { app, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const S = require('../app/state');
const { t } = require('../app/i18n');

const Catalog = require('../../renderer/shared/catalog');
const LAYOUTS = () => [
  ['scene', t('tray.layoutScene')],
  ['strip', t('tray.layoutStrip')],
];
const MODES = () => [
  ['wallpaper', t('tray.modeWallpaper')],
  ['top', t('settings.layout.top')],
  ['normal', t('settings.layout.normal')],
];

function radio(list, key) {
  return list.map(([value, label]) => ({
    label,
    type: 'radio',
    checked: S.settings.get(key) === value,
    click: () => S.actions.updateSettings({ [key]: value }),
  }));
}

function buildTray() {
  const A = S.actions;
  const set = (patch) => A.updateSettings(patch);
  const cmd = (c) => A.mediaCommand(c);
  if (!S.tray) {
    S.tray = new Tray(nativeImage.createFromPath(path.join(S.ASSETS, 'tray.png')));
    S.tray.setToolTip('Sillon');
    S.tray.on('click', () => S.tray.popUpContextMenu());
  }
  const m = S.lastMedia;
  const now = m.active && m.title ? `${m.title} — ${m.artist || ''}`.slice(0, 60) : t('common.nothingPlaying');
  const s = S.settings.get();
  const offset = A.lyricsOffsetFor(m);
  const up = A.updateStatus ? A.updateStatus() : {};
  // Combination shown to the right of an entry, if its global shortcut is active.
  const key = (id) => {
    const accelerator = A.shortcutAccelerator && A.shortcutAccelerator(id);
    return accelerator ? { accelerator, registerAccelerator: false } : {};
  };
  S.tray.setContextMenu(
    Menu.buildFromTemplate([
      ...(up.state === 'ready'
        ? [{ label: t('tray.installUpdate', { version: up.version }), click: A.installUpdate }, { type: 'separator' }]
        : []),
      { label: now, enabled: false },
      ...(s.sceneHidden
        ? [
            {
              label: t('tray.showAgain'),
              click: () => set({ sceneHidden: false }),
              ...key('toggleScene'),
            },
          ]
        : []),
      { label: t('controls.playPause'), click: () => cmd('playpause'), ...key('playpause') },
      { label: t('controls.next'), click: () => cmd('next'), ...key('next') },
      { label: t('controls.previous'), click: () => cmd('previous'), ...key('previous') },
      ...(m.canShuffle
        ? [
            {
              label: t('controls.shuffle'),
              type: 'checkbox',
              checked: !!m.shuffle,
              click: () => cmd('shuffle'),
              ...key('shuffle'),
            },
            {
              label: t('controls.repeat'),
              type: 'checkbox',
              checked: !!m.repeat && m.repeat !== 'None',
              click: () => cmd('repeat'),
              ...key('repeat'),
            },
          ]
        : []),
      { type: 'separator' },
      ...(m.active && m.title
        ? [
            {
              label: t('tray.lyricsOffset', { offset: `${offset > 0 ? '+' : ''}${offset.toFixed(2)}` }),
              submenu: [
                { label: t('tray.earlier'), click: () => A.nudgeLyrics(0.25), ...key('lyricsEarlier') },
                { label: t('tray.later'), click: () => A.nudgeLyrics(-0.25), ...key('lyricsLater') },
                { label: t('editor.reset'), click: () => A.nudgeLyrics(null) },
              ],
            },
          ]
        : []),
      { type: 'separator' },
      { label: t('editor.style'), submenu: radio(Catalog.list('style', t), 'style') },
      { label: t('editor.colors'), submenu: radio(Catalog.list('theme', t), 'theme') },
      { label: t('settings.tab.layout'), submenu: radio(LAYOUTS(), 'layout') },
      { label: t('settings.layout.position'), submenu: radio(MODES(), 'mode') },
      {
        label: t('tray.options'),
        submenu: [
          {
            label: t('tray.showNowPlaying'),
            type: 'checkbox',
            checked: s.showNowPlaying,
            click: (i) => set({ showNowPlaying: i.checked }),
          },
          {
            label: t('settings.viz.showLyrics'),
            type: 'checkbox',
            checked: s.showLyrics !== false,
            click: (i) => set({ showLyrics: i.checked }),
            ...key('toggleLyrics'),
          },
          {
            label: t('settings.sound.sensitivity'),
            submenu: [0.6, 1, 1.5, 2.2].map((v) => ({
              label: `× ${v}`,
              type: 'radio',
              checked: s.sensitivity === v,
              click: () => set({ sensitivity: v }),
            })),
          },
          {
            label: t('settings.viz.opacity'),
            submenu: [0.4, 0.6, 0.8, 1].map((v) => ({
              label: `${v * 100} %`,
              type: 'radio',
              checked: s.opacity === v,
              click: () => set({ opacity: v }),
            })),
          },
          {
            label: t('settings.viz.fps'),
            submenu: [30, 60].map((v) => ({
              label: `${v}`,
              type: 'radio',
              checked: s.fps === v,
              click: () => set({ fps: v }),
            })),
          },
          {
            label: t('settings.sound.prefer'),
            submenu: [
              {
                label: 'Spotify',
                type: 'radio',
                checked: s.preferApp === 'spotify',
                click: () => set({ preferApp: 'spotify' }),
              },
              {
                label: t('settings.sound.activePlayer'),
                type: 'radio',
                checked: !s.preferApp,
                click: () => set({ preferApp: '' }),
              },
            ],
          },
          {
            label: t('settings.behavior.veille'),
            submenu: [
              ...[0, 1, 2, 5, 10, 15, 30].map((v) => ({
                label: v ? t('tray.veilleAfter', { minutes: v }) : t('settings.never'),
                type: 'radio',
                checked: Number(s.veilleDelay) === v,
                click: () => set({ veilleDelay: v }),
              })),
              { type: 'separator' },
              {
                label: t('tray.onlyPlaying'),
                type: 'checkbox',
                checked: s.veilleOnlyPlaying !== false,
                click: (i) => set({ veilleOnlyPlaying: i.checked }),
              },
              {
                label: t('tray.lockOnExit'),
                type: 'checkbox',
                checked: s.veilleLock !== false,
                click: (i) => set({ veilleLock: i.checked }),
              },
            ],
          },
          {
            label: t('settings.behavior.launchAtLogin'),
            type: 'checkbox',
            checked: s.launchAtLogin,
            click: (i) => set({ launchAtLogin: i.checked }),
          },
          {
            label: t('tray.shortcuts'),
            type: 'checkbox',
            checked: s.globalShortcuts !== false,
            click: (i) => set({ globalShortcuts: i.checked }),
          },
          {
            label: t('settings.advanced.autoUpdate'),
            type: 'checkbox',
            checked: s.autoUpdate !== false,
            enabled: !!up.enabled,
            click: (i) => set({ autoUpdate: i.checked }),
          },
          {
            label: up.enabled
              ? t('tray.checkUpdates', { version: up.current })
              : t(up.state === 'portable' ? 'tray.versionPortable' : 'tray.versionDev', { version: up.current || '' }),
            enabled: !!up.enabled,
            click: A.checkUpdates,
          },
          { label: t('settings.advanced.copyDiagnostic'), click: A.copyDiagnostic },
          {
            label: t('tray.resetPosition'),
            click: () => {
              S.settings.set({ bounds: null });
              A.applyMode();
            },
          },
        ],
      },
      { type: 'separator' },
      { label: t('tray.settings'), click: A.openSettings, ...key('settings') },
      { label: t('settings.scene.customize'), click: A.openLayoutEditor, enabled: A.isScene(), ...key('sceneEditor') },
      {
        label: S.editing ? t('tray.finishPlacement') : t('tray.place'),
        click: () => A.setEditing(!S.editing),
        enabled: S.editing || !A.isScene(),
        ...key('placeStrip'),
      },
      { label: t('tray.fullscreen'), click: A.toggleFullscreen, ...key('fullscreen') },
      { label: t('settings.behavior.veille'), click: A.startVeille, ...key('veille') },
      { type: 'separator' },
      { label: t('tray.quit'), click: () => app.quit() },
    ]),
  );
}

module.exports = { buildTray };
