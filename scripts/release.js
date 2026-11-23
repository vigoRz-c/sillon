// Publie une nouvelle version de Sillon sur GitHub (Releases).
//
//   npm run release            -> 0.1.0 -> 0.1.1
//   npm run release -- minor   -> 0.1.0 -> 0.2.0
//   npm run release -- major   -> 0.1.0 -> 1.0.0
//
// Étapes : vérifications, tests, numéro de version (commit + tag), push, puis
// construction et envoi de l'installateur sur GitHub. Les Sillon installés
// trouvent la nouvelle version tout seuls (voir src/main/updater.js).
// Il faut GitHub CLI (gh) connecté au compte du dépôt.

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', ...opts });
const out = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
const fail = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };

const bump = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(bump)) fail('Utilisation : npm run release -- [patch|minor|major]');

// ---------- Vérifications ----------
if (out('git status --porcelain')) fail('Des modifications ne sont pas commitées.');
if (out('git rev-parse --abbrev-ref HEAD') !== 'main') fail('Publie depuis la branche main.');
run('git fetch -q origin');
if (out('git rev-parse HEAD') !== out('git rev-parse origin/main')) fail('main n\'est pas à jour avec GitHub (git pull / git push d\'abord).');

const { owner, repo } = require(path.join(root, 'package.json')).build.publish[0];
let token;
try { token = out('gh auth token'); } catch { fail('GitHub CLI non connecté : lance « gh auth login ».'); }
const visibility = out(`gh api repos/${owner}/${repo} --jq .visibility`);
if (visibility !== 'public') {
  fail(`Le dépôt ${owner}/${repo} est ${visibility} : les Sillon installés ne pourront pas télécharger la mise à jour. Passe-le en public d'abord.`);
}

// ---------- Tests ----------
run('npm run verify --silent');

// ---------- Version, commit, tag, push ----------
run(`npm version ${bump} -m "Version %s"`);
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
run('git push origin main --follow-tags');

// ---------- Construction ----------
// On construit sans publier : electron-builder publie chaque cible en
// parallèle et peut créer deux Releases pour le même tag (vu en 0.1.1).
console.log(`\nConstruction de Sillon ${version}…`);
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
run('node scripts/build-helper.js --strict'); // assistant natif (Rust)
run('npx electron-builder --win --publish never');

// ---------- Publication : une seule Release, tous les fichiers ----------
const dist = path.join(root, 'dist');
const assets = [
  'latest.yml',                              // lu par les Sillon installés
  `Sillon-Setup-${version}.exe`,
  `Sillon-Setup-${version}.exe.blockmap`,    // mises à jour partielles
  `Sillon-${version}-portable.exe`,
].map((f) => path.join(dist, f));
for (const f of assets) if (!fs.existsSync(f)) fail(`Fichier attendu introuvable : ${f}`);
console.log(`\nPublication de Sillon ${version} sur GitHub…`);
run(`gh release create v${version} ${assets.map((f) => `"${f}"`).join(' ')} -R ${owner}/${repo} --title "Sillon ${version}" --generate-notes --latest`,
  { env: { ...process.env, GH_TOKEN: token } });

console.log(`\n✓ Sillon ${version} publié : https://github.com/${owner}/${repo}/releases/tag/v${version}`);
console.log('  Les versions installées le trouveront dans les 4 heures (ou via « Rechercher les mises à jour »).');
