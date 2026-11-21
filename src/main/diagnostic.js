// Diagnostic à copier-coller (Paramètres → Diagnostic).
//
// Sert à comprendre un souci sur le PC de quelqu'un d'autre : version de
// Windows, écrans, état de la scène et des boutons, réponses de Windows aux
// commandes, connexion Spotify, et les derniers événements notés.
// Aucun jeton ni identifiant n'y figure ; le titre du morceau non plus.

const { app, screen } = require('electron');
const os = require('os');
const S = require('./state');
const { windowAt, hwndOf } = require('./wallpaper');

const LOG_MAX = 40;
const log = [];

// Note un événement (clic reçu, réponse de Windows, erreur…).
function note(kind, text) {
  const t = new Date().toTimeString().slice(0, 8);
  log.push(`${t} [${kind}] ${String(text).split('\n')[0].slice(0, 200)}`);
  if (log.length > LOG_MAX) log.shift();
}

const yes = (v) => (v ? 'oui' : 'non');
const rect = (r) => (r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` : '—');

// Un clic au centre des boutons arrive-t-il bien sur leur fenêtre ?
function controlsHitTest() {
  const win = S.controlsWin;
  if (!S.alive(win)) return 'fenêtre des boutons absente';
  const b = win.getBounds();
  const p = screen.dipToScreenPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const hit = windowAt(p);
  if (!hit) return 'test impossible';
  if (hit.root === hwndOf(win)) return 'OK (le clic arrive sur les boutons)';
  // Le bureau lui-même passe devant : vrai problème d'ordre des fenêtres.
  if (/^(Progman|WorkerW|SHELLDLL_DefView|SysListView32)$/.test(hit.rootCls) || /^(SHELLDLL_DefView|SysListView32)$/.test(hit.cls)) {
    return `BLOQUÉ PAR LE BUREAU : « ${hit.cls} » (racine « ${hit.rootCls} ») est au-dessus des boutons`;
  }
  if (S.alive(S.widget) && hit.root === hwndOf(S.widget)) return 'BLOQUÉ PAR LA SCÈNE de Sillon';
  if (S.alive(S.settingsWin) && hit.root === hwndOf(S.settingsWin)) return 'la fenêtre des paramètres est devant : déplace-la et recopie';
  return `une autre fenêtre est devant (« ${hit.rootCls} ») : réduis tes applis et recopie le diagnostic`;
}

function collect() {
  const L = [];
  const s = S.settings.get();
  L.push(`Sillon ${app.getVersion()} (${app.isPackaged ? 'installé' : 'développement'})`);
  L.push(`Windows ${os.release()} · ${process.getSystemVersion()} · ${os.arch()}`);
  L.push(`Electron ${process.versions.electron}`);

  L.push('', '— Écrans');
  const primary = screen.getPrimaryDisplay().id;
  for (const d of screen.getAllDisplays()) {
    L.push(`${d.id === primary ? '* principal' : '  autre    '} ${rect(d.bounds)} zone ${rect(d.workArea)} échelle ${d.scaleFactor}`);
  }

  L.push('', '— Scène');
  L.push(`disposition ${s.layout} · mode ${s.mode} · écran ${s.sceneScreen} · masquée ${yes(s.sceneHidden)} · panneau ${yes(s.showPanel !== false)}`);
  const w = S.widget;
  L.push(`fenêtre : ${S.alive(w) ? `${rect(w.getBounds())} visible ${yes(w.isVisible())}` : 'absente'}`);
  const host = S.attacher && S.attacher.host;
  L.push(`fond d'écran : ${host ? `accrochée (${host.layout})` : 'non accrochée'}`);

  L.push('', '— Boutons');
  L.push(`zone demandée : ${rect(S.controlsRect)}`);
  const c = S.controlsWin;
  L.push(`fenêtre : ${S.alive(c) ? `${rect(c.getBounds())} visible ${yes(c.isVisible())}` : 'absente'}`);
  L.push(`test du clic : ${controlsHitTest()}`);

  L.push('', '— Lecture (Windows)');
  const m = S.lastMedia || {};
  L.push(`session : ${m.active ? `${m.app} · ${m.status} · titre ${yes(m.title)}` : 'aucune'}`);
  L.push(`app suivie en priorité : ${s.preferApp || 'la session active'}`);

  L.push('', '— Spotify');
  const st = S.spotify ? S.spotify.status() : {};
  L.push(`connecté ${yes(st.connected)} · app ${st.builtIn ? 'intégrée' : 'personnelle'}${st.error ? ` · erreur : ${st.error}` : ''}`);
  const q = S.lastQueue || {};
  L.push(`file d'attente : ${(q.items || []).length} morceau(x) reçu(s)`);

  L.push('', '— Derniers événements');
  L.push(...(log.length ? log : ['(aucun)']));
  return L.join('\n');
}

module.exports = { note, collect };
