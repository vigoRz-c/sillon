/* Fenêtre de paramètres : chaque changement est appliqué tout de suite. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const bridge = window.bridge;

  const selects = ['layout', 'style', 'theme', 'mode', 'preferApp', 'fps', 'veilleDelay'];
  const checks = ['showNowPlaying', 'showLyrics', 'showPanel', 'launchAtLogin', 'veilleOnlyPlaying', 'veilleLock'];
  const ranges = { sensitivity: (v) => `× ${v.toFixed(1)}`, opacity: (v) => `${Math.round(v * 100)} %` };

  function fill(s) {
    for (const k of selects) if (document.activeElement !== $(k)) $(k).value = String(s[k] ?? (k === 'layout' ? 'scene' : ''));
    $('showNowPlaying').checked = s.showNowPlaying !== false;
    $('showLyrics').checked = s.showLyrics !== false;
    $('showPanel').checked = s.showPanel !== false;
    $('launchAtLogin').checked = !!s.launchAtLogin;
    if (document.activeElement !== $('spotifyClientId')) $('spotifyClientId').value = s.spotifyClientId || '';
    $('veilleOnlyPlaying').checked = s.veilleOnlyPlaying !== false;
    $('veilleLock').checked = s.veilleLock !== false;
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
      bridge.setSettings({ [k]: k === 'fps' || k === 'veilleDelay' ? Number(v) : v });
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
  $('spotifyLogin').onclick = () => {
    bridge.setSettings({ spotifyClientId: $('spotifyClientId').value.trim() });
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

  bridge.onSettings(fill);
  bridge.getSettings().then(fill);
})();
