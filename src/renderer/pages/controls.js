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
  $('shuffle').onclick = () => bridge.command('shuffle');
  $('repeat').onclick = () => bridge.command('repeat');
  $('hide').onclick = () => bridge.setSettings({ sceneHidden: true });

  // Icônes vectorielles : les symboles texte ⏮ ⏭ s'affichent en emoji sous Windows.
  const icon = (d) =>
    `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
  const PLAY = icon('M7 4v16l13-8z');
  const PAUSE = icon('M6 4h4v16H6zM14 4h4v16h-4z');
  $('play').innerHTML = PLAY;
  const volume = window.SillonVolume($('volume'));
  bridge.onMedia((m) => {
    volume.update(m);
    $('play').innerHTML = m && m.status === 'Playing' ? PAUSE : PLAY;
    $('shuffle').classList.toggle('on', !!(m && m.shuffle));
    $('repeat').classList.toggle('on', !!(m && m.repeat && m.repeat !== 'None'));
    $('repeatOne').classList.toggle('hidden', !(m && m.repeat === 'Track'));
    // Sans compte Spotify connecté, Spotify ignore ces deux commandes : masquées.
    const can = !!(m && m.canShuffle);
    $('shuffle').classList.toggle('hidden', !can);
    $('repeat').classList.toggle('hidden', !can);
    // Grisés quand Spotify les interdit pour le moment (ça change en cours de lecture).
    $('shuffle').classList.toggle('blocked', !!(m && m.shuffleAllowed === false));
    $('repeat').classList.toggle('blocked', !!(m && m.repeatAllowed === false));
    $('shuffle').title =
      m && m.shuffleAllowed === false ? 'Lecture aléatoire (indisponible pour le moment)' : 'Lecture aléatoire';
    $('repeat').title = m && m.repeatAllowed === false ? 'Répéter (indisponible pour le moment)' : 'Répéter';
  });
})();
