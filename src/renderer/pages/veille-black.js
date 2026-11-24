// Écran noir de la veille sur les écrans secondaires : le premier clic, la
// première touche ou la molette la quitte (comme sur l'écran principal).
// Délai d'1,5 s : le mouvement qui a lancé la veille ne la referme pas aussitôt.
setTimeout(() => {
  for (const type of ['mousedown', 'keydown', 'wheel']) addEventListener(type, () => window.bridge.veilleExit());
}, 1500);
