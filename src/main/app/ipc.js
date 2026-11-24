// Enregistrement des handlers IPC : chacun vérifie que l'expéditeur est une
// de nos pages, autorisée sur ce canal, et une erreur dans un handler n'a
// jamais de suite fâcheuse.

const { ipcMain } = require('electron');
const S = require('./state');
const { isAppUrl, allowedFor } = require('./ipc-guard');

// L'expéditeur est une page de l'app (file://, dossier des pages) et cette
// page a le droit d'utiliser ce canal (voir PAGE_CHANNELS dans ipc-guard.js).
function trusted(e, channel) {
  const url = e && e.senderFrame && e.senderFrame.url;
  if (!isAppUrl(url, S.RENDERER)) return false;
  if (allowedFor(url, channel)) return true;
  const msg = `canal « ${channel} » refusé à ${url.split('/').pop().split('?')[0]}`;
  console.error(`IPC : ${msg}`);
  require('./diagnostic').note('sécurité', msg); // chargé ici : diagnostic.js dépend de modules qui chargent ipc.js
  return false;
}

// Message sans réponse.
function on(channel, fn) {
  ipcMain.on(channel, (e, ...args) => {
    if (!trusted(e, channel)) return;
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
    if (!trusted(e, channel)) return null;
    try {
      return await fn(e, ...args);
    } catch (err) {
      console.error(`IPC « ${channel} » :`, err);
      return null;
    }
  });
}

module.exports = { on, handle, trusted };
