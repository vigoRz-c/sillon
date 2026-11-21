/* Fenêtre de paramètres : chaque changement est appliqué tout de suite. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const bridge = window.bridge;

  const selects = ['style', 'theme', 'mode', 'preferApp', 'fps'];
  const checks = ['showNowPlaying', 'launchAtLogin'];
  const ranges = { sensitivity: (v) => `× ${v.toFixed(1)}`, opacity: (v) => `${Math.round(v * 100)} %` };

  function fill(s) {
    for (const k of selects) if (document.activeElement !== $(k)) $(k).value = String(s[k] ?? '');
    $('showNowPlaying').checked = s.showNowPlaying !== false;
    $('launchAtLogin').checked = !!s.launchAtLogin;
    for (const [k, f] of Object.entries(ranges)) {
      if (document.activeElement !== $(k)) $(k).value = s[k];
      $(`${k}Out`).textContent = f(Number(s[k]));
    }
  }

  for (const k of selects) {
    $(k).addEventListener('change', () => {
      const v = $(k).value;
      bridge.setSettings({ [k]: k === 'fps' ? Number(v) : v });
    });
  }
  for (const k of checks) $(k).addEventListener('change', () => bridge.setSettings({ [k]: $(k).checked }));
  for (const [k, f] of Object.entries(ranges)) {
    $(k).addEventListener('input', () => {
      const v = Number($(k).value);
      $(`${k}Out`).textContent = f(v);
      bridge.setSettings({ [k]: v });
    });
  }

  $('edit').onclick = () => bridge.startEditing();
  $('resetBounds').onclick = () => bridge.resetBounds();
  $('close').onclick = () => window.close();
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

  bridge.onSettings(fill);
  bridge.getSettings().then(fill);
})();
