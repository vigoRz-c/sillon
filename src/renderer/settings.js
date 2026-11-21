/* Fenêtre de paramètres : chaque changement est appliqué tout de suite. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const bridge = window.bridge;

  const selects = ['layout', 'style', 'theme', 'mode', 'preferApp', 'fps', 'veilleDelay', 'sceneScreen', 'sleepAfter'];
  const checks = ['showNowPlaying', 'showLyrics', 'showPanel', 'launchAtLogin', 'veilleOnlyPlaying', 'veilleLock', 'gameMode', 'dimOnPause', 'autoUpdate'];
  const numeric = new Set(['fps', 'veilleDelay', 'sleepAfter']);
  const pct = (v) => `${Math.round(v * 100)} %`;
  const ranges = {
    sensitivity: (v) => `× ${v.toFixed(1)}`, opacity: pct,
    discIntensity: (v) => `× ${v.toFixed(1)}`, discSize: pct, discX: pct, discY: pct,
  };

  function fill(s) {
    const defaults = { layout: 'scene', sceneScreen: 'primary', sleepAfter: 5 };
    for (const k of selects) if (document.activeElement !== $(k)) $(k).value = String(s[k] ?? defaults[k] ?? '');
    $('showNowPlaying').checked = s.showNowPlaying !== false;
    $('showLyrics').checked = s.showLyrics !== false;
    $('showPanel').checked = s.showPanel !== false;
    $('launchAtLogin').checked = !!s.launchAtLogin;
    if (document.activeElement !== $('spotifyClientId')) $('spotifyClientId').value = s.spotifyClientId || '';
    $('spotifyCustomClientId').checked = !!s.spotifyCustomClientId;
    $('customClient').classList.toggle('hidden', !s.spotifyCustomClientId);
    $('builtinHelp').classList.toggle('hidden', !!s.spotifyCustomClientId);
    $('veilleOnlyPlaying').checked = s.veilleOnlyPlaying !== false;
    $('veilleLock').checked = s.veilleLock !== false;
    $('gameMode').checked = s.gameMode !== false;
    $('autoUpdate').checked = s.autoUpdate !== false;
    $('dimOnPause').checked = s.dimOnPause !== false;
    // La scène occupe tout le bureau : rien à déplacer.
    $('editRow').classList.toggle('hidden', (s.layout || 'scene') !== 'strip' && s.mode === 'wallpaper');
    for (const [k, f] of Object.entries(ranges)) {
      if (document.activeElement !== $(k)) $(k).value = s[k];
      $(`${k}Out`).textContent = f(Number(s[k]));
    }
  }

  for (const k of selects) {
    $(k).addEventListener('change', () => {
      const v = $(k).value;
      bridge.setSettings({ [k]: numeric.has(k) ? Number(v) : v });
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
  $('veilleNow').onclick = () => bridge.startVeille();
  $('close').onclick = () => window.close();
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.close(); });

  // ----- Compte Spotify -----
  $('spotifyClientId').addEventListener('change', () => bridge.setSettings({ spotifyClientId: $('spotifyClientId').value.trim() }));
  $('spotifyCustomClientId').addEventListener('change', () => {
    bridge.setSettings({ spotifyCustomClientId: $('spotifyCustomClientId').checked });
    setTimeout(() => bridge.spotifyStatus().then(showSpotify), 150);
  });
  $('spotifyLogin').onclick = () => {
    if ($('spotifyCustomClientId').checked) bridge.setSettings({ spotifyClientId: $('spotifyClientId').value.trim() });
    $('spotifyState').textContent = 'Connexion en cours dans ton navigateur…';
    $('spotifyState').className = 'state';
    setTimeout(() => bridge.spotifyLogin(), 200);
  };
  $('spotifyLogout').onclick = () => bridge.spotifyLogout();
  $('dashboard').onclick = (e) => { e.preventDefault(); bridge.openSpotifyDashboard(); };
  $('copyRedirect').onclick = async () => {
    await navigator.clipboard.writeText($('redirectUri').textContent);
    $('copyRedirect').textContent = 'Copié';
    setTimeout(() => { $('copyRedirect').textContent = 'Copier'; }, 1500);
  };
  function showSpotify(st) {
    if (!st) return;
    if (st.redirectUri) $('redirectUri').textContent = st.redirectUri;
    $('spotifyLogin').textContent = st.connected ? 'Se reconnecter' : 'Se connecter à Spotify';
    $('spotifyLogout').classList.toggle('hidden', !st.connected);
    const el = $('spotifyState');
    el.textContent = st.error ? st.error : st.connected ? 'Connecté : la file d\'attente s\'affiche sous le panneau.' : 'Non connecté.';
    el.className = `state${st.error ? ' error' : st.connected ? ' ok' : ''}`;
  }
  bridge.onSpotifyStatus(showSpotify);
  bridge.spotifyStatus().then(showSpotify);

  // ----- Mises à jour -----
  function showUpdate(u) {
    if (!u) return;
    const el = $('updateState');
    const v = `Version installée : ${u.current}. `;
    const text = {
      dev: 'Mode développement (npm start) : pas de mise à jour automatique.',
      idle: `${v}`,
      checking: `${v}Recherche en cours…`,
      uptodate: `${v}Sillon est à jour.`,
      downloading: `${v}Téléchargement de la version ${u.version}… ${u.progress} %`,
      ready: `Version ${u.version} prête : elle s'installera à la fermeture, ou maintenant.`,
      error: `${v}${u.error}`,
    }[u.state] || v;
    el.textContent = text;
    el.className = `state${u.state === 'error' ? ' error' : u.state === 'ready' || u.state === 'uptodate' ? ' ok' : ''}`;
    $('checkUpdates').disabled = !u.enabled;
    $('autoUpdate').disabled = !u.enabled;
    $('installUpdate').classList.toggle('hidden', u.state !== 'ready');
  }
  $('checkUpdates').onclick = () => bridge.checkUpdates();
  $('installUpdate').onclick = () => bridge.installUpdate();
  bridge.onUpdateStatus(showUpdate);
  bridge.updateStatus().then(showUpdate);

  // ----- Diagnostic -----
  $('copyDiagnostic').onclick = async () => {
    const el = $('diagnosticState');
    try {
      await bridge.copyDiagnostic();
      el.textContent = 'Copié dans le presse-papiers : colle-le (Ctrl+V) dans ton message.';
      el.className = 'state ok';
    } catch (e) {
      el.textContent = `Impossible de copier : ${e.message}`;
      el.className = 'state error';
    }
  };

  bridge.onSettings(fill);
  bridge.getSettings().then(fill);
})();
