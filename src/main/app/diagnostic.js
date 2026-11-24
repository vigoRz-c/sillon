// Diagnostic to copy and paste (Settings → Diagnostic).
//
// Helps understand a problem on someone else's PC: Windows version,
// screens, state of the scene and of the buttons, Windows' answers to the
// commands, Spotify connection, and the latest noted events.
// No token or identifier is in it; neither is the track title.

const { app, screen } = require('electron');
const os = require('os');
const S = require('./state');
const SceneLayout = require('../../renderer/shared/scene-layout');
const { windowAt, hwndOf } = require('../windows/wallpaper');

const LOG_MAX = 40;
const log = [];

// Notes an event (click received, Windows answer, error…).
function note(kind, text) {
  const t = new Date().toTimeString().slice(0, 8);
  log.push(`${t} [${kind}] ${String(text).split('\n')[0].slice(0, 200)}`);
  if (log.length > LOG_MAX) log.shift();
}

const yes = (v) => (v ? 'yes' : 'no');
const rect = (r) => (r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` : '—');

// Does a click at the center of the buttons really land on their window?
function controlsHitTest() {
  const win = S.controlsWin;
  if (!S.alive(win)) return 'buttons window missing';
  const b = win.getBounds();
  const p = screen.dipToScreenPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const hit = windowAt(p);
  if (!hit) return 'test impossible';
  if (hit.root === hwndOf(win)) return 'OK (the click lands on the buttons)';
  // The desktop itself comes in front: a real window order problem.
  if (
    /^(Progman|WorkerW|SHELLDLL_DefView|SysListView32)$/.test(hit.rootCls) ||
    /^(SHELLDLL_DefView|SysListView32)$/.test(hit.cls)
  ) {
    return `BLOCKED BY THE DESKTOP: "${hit.cls}" (root "${hit.rootCls}") is above the buttons`;
  }
  if (S.alive(S.widget) && hit.root === hwndOf(S.widget)) return "BLOCKED BY Sillon's SCENE";
  if (S.alive(S.settingsWin) && hit.root === hwndOf(S.settingsWin))
    return 'the settings window is in front: move it and copy again';
  return `another window is in front ("${hit.rootCls}"): minimize your apps and copy the diagnostic again`;
}

function collect() {
  const L = [];
  const s = S.settings.get();
  L.push(`Sillon ${app.getVersion()} (${app.isPackaged ? 'installed' : 'development'})`);
  L.push(`Windows ${os.release()} · ${process.getSystemVersion()} · ${os.arch()}`);
  L.push(`Electron ${process.versions.electron}`);

  L.push('', '— Screens');
  const primary = screen.getPrimaryDisplay().id;
  for (const d of screen.getAllDisplays()) {
    L.push(
      `${d.id === primary ? '* primary' : '  other  '} ${rect(d.bounds)} area ${rect(d.workArea)} scale ${d.scaleFactor}`,
    );
  }

  L.push('', '— Scene');
  L.push(`layout ${s.layout} · mode ${s.mode} · screen ${s.sceneScreen} · hidden ${yes(s.sceneHidden)}`);
  const lay = SceneLayout.fromSettings(s);
  L.push(
    `elements: ${SceneLayout.ORDER.map((id) => `${id} ${lay[id].visible ? 'yes' : 'no'}`).join(' · ')}${s.sceneLayout ? '' : ' (original layout)'}`,
  );
  const w = S.widget;
  L.push(`window: ${S.alive(w) ? `${rect(w.getBounds())} visible ${yes(w.isVisible())}` : 'missing'}`);
  const host = S.attacher && S.attacher.host;
  L.push(`wallpaper: ${host ? `attached (${host.layout})` : 'not attached'}`);

  L.push('', '— Buttons');
  L.push(`requested area: ${rect(S.controlsRect)}`);
  const c = S.controlsWin;
  L.push(`window: ${S.alive(c) ? `${rect(c.getBounds())} visible ${yes(c.isVisible())}` : 'missing'}`);
  L.push(`click test: ${controlsHitTest()}`);

  L.push('', '— Playback (Windows)');
  const m = S.lastMedia || {};
  L.push(`session: ${m.active ? `${m.app} · ${m.status} · title ${yes(m.title)}` : 'none'}`);
  L.push(`app followed first: ${s.preferApp || 'the active session'}`);

  L.push('', '— Analyzed sound');
  const au = S.actions.audioStatus ? S.actions.audioStatus() : {};
  L.push(
    `setting: ${s.audioSource === 'system' ? 'whole PC' : 'only the player'} · now: ${au.mode === 'app' ? `player (${au.exe}${au.running ? '' : ', waiting'})` : 'whole PC'}${au.reason ? ` · ${au.reason}` : ''}`,
  );
  L.push(`player volume: ${S.appVolume == null ? 'unknown (no sound open in Windows)' : `${S.appVolume} %`}`);

  L.push('', '— Spotify');
  const st = S.spotify ? S.spotify.status() : {};
  L.push(
    `connected ${yes(st.connected)} · app ${st.builtIn ? 'built-in' : 'own'}${st.error ? ` · error: ${st.error}` : ''}`,
  );
  const q = S.lastQueue || {};
  L.push(`queue: ${(q.items || []).length} track(s) received`);

  L.push('', '— Latest events');
  L.push(...(log.length ? log : ['(none)']));
  return L.join('\n');
}

module.exports = { note, collect };
