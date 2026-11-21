const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.send('settings:set', patch),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  onMedia: (cb) => ipcRenderer.on('media', (_e, m) => cb(m)),
  onWallpaper: (cb) => ipcRenderer.on('wallpaper', (_e, url) => cb(url)),
  onEditing: (cb) => ipcRenderer.on('editing', (_e, on) => cb(on)),
  command: (cmd) => ipcRenderer.send('media:command', cmd),
  editDone: () => ipcRenderer.send('edit:done'),
  resizeTo: (width, height) => ipcRenderer.send('widget:resize', { width, height }),
  openSettings: () => ipcRenderer.send('settings:open'),
  startEditing: () => ipcRenderer.send('edit:start'),
  resetBounds: () => ipcRenderer.send('bounds:reset'),
  closeFullscreen: () => ipcRenderer.send('fullscreen:close'),
});
