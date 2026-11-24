// Registration of the IPC handlers: each one checks that the sender is one
// of our pages, allowed on this channel, and an error in a handler never
// has bad consequences.

const { ipcMain } = require('electron');
const S = require('./state');
const { isAppUrl, allowedFor } = require('./ipc-guard');

// The sender is an app page (file://, pages folder) and this
// page may use this channel (see PAGE_CHANNELS in ipc-guard.js).
function trusted(e, channel) {
  const url = e && e.senderFrame && e.senderFrame.url;
  if (!isAppUrl(url, S.RENDERER)) return false;
  if (allowedFor(url, channel)) return true;
  const msg = `channel "${channel}" refused to ${url.split('/').pop().split('?')[0]}`;
  console.error(`IPC : ${msg}`);
  require('./diagnostic').note('security', msg); // loaded here: diagnostic.js depends on modules that load ipc.js
  return false;
}

// Message without a reply.
function on(channel, fn) {
  ipcMain.on(channel, (e, ...args) => {
    if (!trusted(e, channel)) return;
    try {
      fn(e, ...args);
    } catch (err) {
      console.error(`IPC "${channel}":`, err);
    }
  });
}

// Message with a reply (null if the sender is refused or if it fails).
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trusted(e, channel)) return null;
    try {
      return await fn(e, ...args);
    } catch (err) {
      console.error(`IPC "${channel}":`, err);
      return null;
    }
  });
}

module.exports = { on, handle, trusted };
