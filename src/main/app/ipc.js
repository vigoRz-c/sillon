// Enregistrement des handlers IPC : chacun vérifie que l'expéditeur est une
// de nos pages, et une erreur dans un handler n'a jamais de suite fâcheuse.

const { ipcMain } = require('electron');
const S = require('./state');
const { isAppUrl } = require('./ipc-guard');

// Les pages de l'app (file://), ou les écrans noirs de la veille (data:).
function trusted(e) {
  const frame = e && e.senderFrame;
  if (frame && isAppUrl(frame.url, S.RENDERER)) return true;
  return !!e && S.veilleWins.some((w) => !w.isDestroyed() && w.webContents === e.sender);
}

// Message sans réponse.
function on(channel, fn) {
  ipcMain.on(channel, (e, ...args) => {
    if (!trusted(e)) return;
    try {
      fn(e, ...args);
    } catch (err) {
      console.error(`IPC « ${channel} » :`, err);
    }
  });
}

// Message avec réponse (null si l'expéditeur est refusé ou si ça échoue).
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trusted(e)) return null;
    try {
      return await fn(e, ...args);
    } catch (err) {
      console.error(`IPC « ${channel} » :`, err);
      return null;
    }
  });
}

module.exports = { on, handle, trusted };
