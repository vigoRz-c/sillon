// @ts-check
// Contract with the native helper (sillon-helper.exe) on the Node side: accepted
// commands and exit codes. Single source for ipc-guard.js, media.js and
// app-audio.js; the protocol details are documented in
// native/sillon-helper/src/main.rs (at the top of the file).

// Protocol version of the "media" mode (message {"type":"ready","protocol":1}).
const PROTOCOL = 1;

// Simple media commands (one line on the helper's input).
const MEDIA_COMMANDS = Object.freeze(['playpause', 'play', 'pause', 'next', 'previous', 'shuffle', 'repeat']);
// Those that change playback (replayed if the helper restarts in the meantime).
const PLAYBACK_COMMANDS = Object.freeze(['playpause', 'play', 'pause', 'next', 'previous']);
// Commands with an argument: "volume:50", "prefer:spotify", "volume-target:spotify.exe".
const PREFIXED_COMMANDS = Object.freeze(['volume:', 'prefer:', 'volume-target:']);

// Exit codes of the "capture <program.exe>" mode.
const EXIT = Object.freeze({
  UNSUPPORTED: 2, // per-program capture impossible on this Windows
  CLOSED: 3, // program closed
  NOT_FOUND: 4, // program not found or name refused
  PANIC: 5, // internal error (reported by "ERR 5" on stderr)
  DEVICE_LOST: 7, // audio device lost (output change)
});

module.exports = { PROTOCOL, MEDIA_COMMANDS, PLAYBACK_COMMANDS, PREFIXED_COMMANDS, EXIT };
