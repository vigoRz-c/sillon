// @ts-check
// Contrat avec l'assistant natif (sillon-helper.exe) côté Node : commandes
// acceptées et codes de sortie. Source unique pour ipc-guard.js, media.js et
// app-audio.js ; le détail du protocole est documenté dans
// native/sillon-helper/src/main.rs (en tête du fichier).

// Version du protocole du mode « media » (message {"type":"ready","protocol":1}).
const PROTOCOL = 1;

// Commandes média simples (une ligne sur l'entrée de l'assistant).
const MEDIA_COMMANDS = Object.freeze(['playpause', 'play', 'pause', 'next', 'previous', 'shuffle', 'repeat']);
// Celles qui changent la lecture (rejouées si l'assistant redémarre entre-temps).
const PLAYBACK_COMMANDS = Object.freeze(['playpause', 'play', 'pause', 'next', 'previous']);
// Commandes avec un argument : « volume:50 », « prefer:spotify », « volume-target:spotify.exe ».
const PREFIXED_COMMANDS = Object.freeze(['volume:', 'prefer:', 'volume-target:']);

// Codes de sortie du mode « capture <programme.exe> ».
const EXIT = Object.freeze({
  UNSUPPORTED: 2, // capture par programme impossible sur ce Windows
  CLOSED: 3, // programme fermé
  NOT_FOUND: 4, // programme introuvable ou nom refusé
  PANIC: 5, // erreur interne (signalée par « ERR 5 » sur stderr)
  DEVICE_LOST: 7, // périphérique audio perdu (changement de sortie)
});

module.exports = { PROTOCOL, MEDIA_COMMANDS, PLAYBACK_COMMANDS, PREFIXED_COMMANDS, EXIT };
