// @ts-check
// Rest: the scene sleeps when no music has been playing for a while.
// Same rule as the scene page (widget.js, updateRest), so that the
// main process knows when to stop the sound capture.

// True if the scene must sleep: no music for more than `minutes`.
function isAsleep({ playing, silentSince, now, minutes }) {
  const m = Number(minutes);
  if (playing || !(m > 0)) return false;
  return now - silentSince > m * 60000;
}

module.exports = { isAsleep };
