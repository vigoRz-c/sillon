// Publie une nouvelle version de Sillon sur GitHub (Releases).
//
//   npm run release            -> 0.1.0 -> 0.1.1
//   npm run release -- minor   -> 0.1.0 -> 0.2.0
//   npm run release -- major   -> 0.1.0 -> 1.0.0
//
// Avant de lancer : la section « ## [x.y.z] » de CHANGELOG.md doit exister (ce
// sont les notes de la Release). Étapes :
//   1. vérifications (dépôt propre, main à jour, GitHub CLI, dépôt public, CHANGELOG) ;
//   2. tests (npm run verify) ;
//   3. numéro de version : commit et tag en local seulement ;
//   4. construction de l'installateur et de la version portable ;
//   5. SHA256SUMS.txt, puis push du commit et du tag ;
//   6. publication de la Release (une seule, avec tous les fichiers).
// Si la construction (4) ou le push (5) échoue, le commit et le tag locaux sont
// annulés : rien n'a été publié. Les Sillon installés trouvent la nouvelle
// version tout seuls (voir src/main/app/updater.js).
// Il faut GitHub CLI (gh) connecté au compte du dépôt.

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { bumpVersion, extractReleaseNotes, checksumLines, sha256File } = require('./release-lib');

const root = path.join(__dirname, '..');
const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', ...opts });
const out = (cmd) => execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

const bump = process.argv[2] || 'patch';
if (!['patch', 'minor', 'major'].includes(bump)) fail('Utilisation : npm run release -- [patch|minor|major]');

const pkgFile = path.join(root, 'package.json');
const currentVersion = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version;
const { owner, repo } = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).build.publish[0];
const version = bumpVersion(currentVersion, bump);
const tag = `v${version}`;

// ---------- Notes de version : avant tout le reste ----------
let notes;
try {
  notes = extractReleaseNotes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version);
} catch (e) {
  fail(`${e.message}. Ajoute cette section (notes de la Release) avant de publier.`);
}

// ---------- Vérifications ----------
if (out('git status --porcelain')) fail('Des modifications ne sont pas commitées.');
if (out('git rev-parse --abbrev-ref HEAD') !== 'main') fail('Publie depuis la branche main.');
run('git fetch -q origin');
if (out('git rev-parse HEAD') !== out('git rev-parse origin/main'))
  fail("main n'est pas à jour avec GitHub (git pull / git push d'abord).");

let token;
try {
  token = out('gh auth token');
} catch {
  fail('GitHub CLI non connecté : lance « gh auth login ».');
}
const visibility = out(`gh api repos/${owner}/${repo} --jq .visibility`);
if (visibility !== 'public') {
  fail(
    `Le dépôt ${owner}/${repo} est ${visibility} : les Sillon installés ne pourront pas télécharger la mise à jour. Passe-le en public d'abord.`,
  );
}

// ---------- Tests ----------
run('npm run verify --silent');

// ---------- Version : commit et tag locaux (pas encore poussés) ----------
const previousHead = out('git rev-parse HEAD');
run(`npm version ${bump} -m "Version %s"`);
if (JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version !== version) fail(`Version inattendue après npm version.`);

// Annule le commit et le tag locaux, sans toucher à rien d'autre (le dépôt était propre).
function rollback(reason) {
  console.error(`\n✗ ${reason}`);
  console.error('Annulation locale du commit et du tag de version…');
  try {
    if (out('git rev-parse HEAD~1') !== previousHead) {
      console.error(`HEAD~1 n'est pas le commit d'origine : annule à la main (git tag -d ${tag}, git reset --hard).`);
    } else {
      run(`git tag -d ${tag}`);
      // --keep : refuse d'écraser des fichiers modifiés pendant la construction.
      run('git reset --keep HEAD~1');
      console.error('Commit et tag annulés, rien n’a été publié.');
    }
  } catch (e) {
    console.error(`Annulation incomplète : ${e.message}`);
  }
  process.exit(1);
}

// ---------- Construction (sans publier) ----------
// electron-builder publie chaque cible en parallèle et peut créer deux Releases
// pour le même tag (vu en 0.1.1) : on construit sans publier, on publie ensuite.
console.log(`\nConstruction de Sillon ${version}…`);
// Plusieurs essais : l'antivirus garde parfois un .exe ouvert un instant.
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
const dist = path.join(root, 'dist');
const assets = [
  'latest.yml', // lu par les Sillon installés
  `Sillon-Setup-${version}.exe`,
  `Sillon-Setup-${version}.exe.blockmap`, // mises à jour partielles
  `Sillon-${version}-portable.exe`,
].map((f) => path.join(dist, f));

try {
  run('node scripts/build-helper.js --strict'); // assistant natif (Rust)
  run('npx electron-builder --win --publish never');
  for (const f of assets) if (!fs.existsSync(f)) throw new Error(`fichier attendu introuvable : ${f}`);
} catch (e) {
  rollback(`La construction de Sillon ${version} a échoué (${e.message}).`);
}

// ---------- Empreintes SHA-256 ----------
const sumsFile = path.join(dist, 'SHA256SUMS.txt');
fs.writeFileSync(sumsFile, checksumLines(assets.map((f) => ({ sha256: sha256File(f), name: path.basename(f) }))));
assets.push(sumsFile);

// ---------- Push : seulement maintenant ----------
try {
  run('git push origin main --follow-tags');
} catch {
  rollback('Le push vers GitHub a échoué.');
}

// ---------- Publication : une seule Release, tous les fichiers ----------
console.log(`\nPublication de Sillon ${version} sur GitHub…`);
const notesFile = path.join(os.tmpdir(), `sillon-notes-${version}-${process.pid}.md`);
fs.writeFileSync(notesFile, `${notes}\n`);
try {
  run(
    `gh release create ${tag} ${assets.map((f) => `"${f}"`).join(' ')} -R ${owner}/${repo} --title "Sillon ${version}" --notes-file "${notesFile}" --latest`,
    { env: { ...process.env, GH_TOKEN: token } },
  );
} catch {
  fail(
    `Commit et tag sont poussés, mais la Release n'a pas été créée. Relance : gh release create ${tag} <fichiers de dist/> -R ${owner}/${repo} --notes-file <notes>`,
  );
} finally {
  fs.rmSync(notesFile, { force: true });
}

console.log(`\n✓ Sillon ${version} publié : https://github.com/${owner}/${repo}/releases/tag/${tag}`);
console.log('  Les versions installées le trouveront dans les 4 heures (ou via « Rechercher les mises à jour »).');
