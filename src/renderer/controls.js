/* Boutons du panneau de la scène : fenêtre posée au-dessus du bureau. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const bridge = window.bridge;
  if (!bridge) return;

  $('prev').onclick = () => bridge.command('previous');
  $('play').onclick = () => bridge.command('playpause');
  $('next').onclick = () => bridge.command('next');
  $('settings').onclick = () => bridge.openSettings();

  // Icônes vectorielles : les symboles texte ⏮ ⏭ s'affichent en emoji sous Windows.
  const icon = (d) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
  const PLAY = icon('M7 4v16l13-8z');
  const PAUSE = icon('M6 4h4v16H6zM14 4h4v16h-4z');
  $('play').innerHTML = PLAY;
  bridge.onMedia((m) => {
    $('play').innerHTML = m && m.status === 'Playing' ? PAUSE : PLAY;
  });
})();
