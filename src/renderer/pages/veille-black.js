// Black screen of the screen saver on secondary displays: the first click,
// key press or wheel turn leaves it (as on the main display).
// 1.5 s delay: the movement that started the screen saver does not close it right away.
setTimeout(() => {
  for (const type of ['mousedown', 'keydown', 'wheel']) addEventListener(type, () => window.bridge.veilleExit());
}, 1500);
