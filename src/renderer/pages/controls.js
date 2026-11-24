/* Buttons of the scene's panel: a window laid over the desktop. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const bridge = window.bridge;
  if (!bridge) return;
  const I18n = window.SillonI18n;
  const t = I18n.t;

  $('prev').onclick = () => bridge.command('previous');
  $('play').onclick = () => bridge.command('playpause');
  $('next').onclick = () => bridge.command('next');
  $('settings').onclick = () => bridge.openSettings();
  $('shuffle').onclick = () => bridge.command('shuffle');
  $('repeat').onclick = () => bridge.command('repeat');
  $('hide').onclick = () => bridge.setSettings({ sceneHidden: true });

  // Vector icons: the text symbols ⏮ ⏭ show up as emoji on Windows.
  const icon = (d) =>
    `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>`;
  const PLAY = icon('M7 4v16l13-8z');
  const PAUSE = icon('M6 4h4v16H6zM14 4h4v16h-4z');
  $('play').innerHTML = PLAY;
  const volume = window.SillonVolume($('volume'));
  let lastMedia = null;
  function render(m) {
    lastMedia = m;
    volume.update(m);
    const playing = !!(m && m.status === 'Playing');
    $('play').innerHTML = playing ? PAUSE : PLAY;
    // The name announces the possible action: "Pause" while playing, "Play" otherwise.
    $('play').setAttribute('aria-label', playing ? t('common.pause') : t('common.play'));
    const shuffleOn = !!(m && m.shuffle);
    const repeatOn = !!(m && m.repeat && m.repeat !== 'None');
    $('shuffle').classList.toggle('on', shuffleOn);
    $('repeat').classList.toggle('on', repeatOn);
    $('shuffle').setAttribute('aria-pressed', String(shuffleOn));
    $('repeat').setAttribute('aria-pressed', String(repeatOn));
    $('repeatOne').classList.toggle('hidden', !(m && m.repeat === 'Track'));
    // Without a connected Spotify account, Spotify ignores these two commands: hidden.
    const can = !!(m && m.canShuffle);
    $('shuffle').classList.toggle('hidden', !can);
    $('repeat').classList.toggle('hidden', !can);
    // Grayed out while Spotify forbids them (this changes during playback).
    $('shuffle').classList.toggle('blocked', !!(m && m.shuffleAllowed === false));
    $('repeat').classList.toggle('blocked', !!(m && m.repeatAllowed === false));
    $('shuffle').setAttribute('aria-disabled', String(!!(m && m.shuffleAllowed === false)));
    $('repeat').setAttribute('aria-disabled', String(!!(m && m.repeatAllowed === false)));
    const unavailable = (label) => t('controls.unavailable', { label });
    const shuffleBase = t('controls.shuffle');
    const shuffleLabel = m && m.shuffleAllowed === false ? unavailable(shuffleBase) : shuffleBase;
    const repeatBase = m && m.repeat === 'Track' ? t('controls.repeatTrack') : t('controls.repeat');
    const repeatLabel = m && m.repeatAllowed === false ? unavailable(repeatBase) : repeatBase;
    $('shuffle').title = shuffleLabel;
    $('shuffle').setAttribute('aria-label', shuffleLabel);
    $('repeat').title = repeatLabel;
    $('repeat').setAttribute('aria-label', repeatLabel);
  }
  bridge.onMedia(render);
  // Labels written by render() follow the language too.
  I18n.onChange(() => render(lastMedia));
  I18n.start(bridge);
})();
