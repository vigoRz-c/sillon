const { contextBridge, ipcRenderer } = require('electron');

// Subscribes to a message from the main process. Returns a way to
// unsubscribe (a page that replaces a component does not keep the old listener).
const sub = (channel) => (cb) => {
  const listener = (_e, data) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('bridge', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  getLanguage: () => ipcRenderer.invoke('i18n:language'),
  onLanguage: sub('language'),
  setSettings: (patch) => ipcRenderer.send('settings:set', patch),
  onSettings: sub('settings'),
  onLyrics: sub('lyrics'),
  reportControlsRect: (rect) => ipcRenderer.send('scene:controls-rect', rect),
  onQueue: sub('queue'),
  copyDiagnostic: () => ipcRenderer.invoke('diagnostic:copy'),
  spotifyStatus: () => ipcRenderer.invoke('spotify:status'),
  onSpotifyStatus: sub('spotify-status'),
  spotifyLogin: () => ipcRenderer.send('spotify:login'),
  spotifyLogout: () => ipcRenderer.send('spotify:logout'),
  openSpotifyDashboard: () => ipcRenderer.send('spotify:dashboard'),
  nudgeLyrics: (delta) => ipcRenderer.send('lyrics:nudge', delta),
  onRenderPause: sub('render-pause'),
  updateStatus: () => ipcRenderer.invoke('update:status'),
  onUpdateStatus: sub('update-status'),
  checkUpdates: () => ipcRenderer.send('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  shortcutsStatus: () => ipcRenderer.invoke('shortcuts:status'),
  onAudioStart: sub('audio:start'),
  onAudioPcm: sub('audio-pcm'),
  onMedia: sub('media'),
  onWallpaper: sub('wallpaper'),
  onEditing: sub('editing'),
  command: (cmd) => ipcRenderer.send('media:command', cmd),
  setVolume: (percent) => ipcRenderer.send('media:volume', percent),
  editDone: () => ipcRenderer.send('edit:done'),
  resizeTo: (width, height) => ipcRenderer.send('widget:resize', { width, height }),
  openSettings: () => ipcRenderer.send('settings:open'),
  startEditing: () => ipcRenderer.send('edit:start'),
  resetBounds: () => ipcRenderer.send('bounds:reset'),
  startVeille: () => ipcRenderer.send('veille:start'),
  veilleExit: () => ipcRenderer.send('veille:exit'),
  closeFullscreen: () => ipcRenderer.send('fullscreen:close'),
  // Scene layout editor.
  openLayoutEditor: () => ipcRenderer.send('layout:open'),
  layoutDone: (patch) => ipcRenderer.send('layout:done', patch),
  layoutCancel: () => ipcRenderer.send('layout:cancel'),
  onEditorBackground: sub('editor-background'),
});
