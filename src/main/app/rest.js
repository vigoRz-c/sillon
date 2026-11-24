// @ts-check
// Repos : la scène dort quand aucune musique ne joue depuis un moment.
// Même règle que la page de la scène (widget.js, updateRest), pour que le
// processus principal sache quand couper la capture du son.

// Vrai si la scène doit dormir : pas de musique depuis plus de `minutes`.
function isAsleep({ playing, silentSince, now, minutes }) {
  const m = Number(minutes);
  if (playing || !(m > 0)) return false;
  return now - silentSince > m * 60000;
}

module.exports = { isAsleep };
