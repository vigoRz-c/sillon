const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.send('settings:set', patch),
  onSettings: (cb) => ipcRenderer.on('settings', (_e, s) => cb(s)),
  onMedia: (cb) => ipcRenderer.on('media', (_e, m) => cb(m)),
  onEditing: (cb) => ipcRenderer.on('editing', (_e, on) => cb(on)),
  command: (cmd) => ipcRenderer.send('media:command', cmd),
  editDone: () => ipcRenderer.send('edit:done'),
  resizeTo: (width, height) => ipcRenderer.send('widget:resize', { width, height }),
  closeFullscreen: () => ipcRenderer.send('fullscreen:close'),
});
