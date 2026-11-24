// Publishes a new version of Sillon on GitHub (Releases).
//
//   npm run release            -> 0.1.0 -> 0.1.1
//   npm run release -- minor   -> 0.1.0 -> 0.2.0
//   npm run release -- major   -> 0.1.0 -> 1.0.0
//
// Before running: the "## [x.y.z]" section of CHANGELOG.md must exist (it
// holds the Release notes). Steps:
//   1. checks (clean repository, main up to date, GitHub CLI, public repository, CHANGELOG);
//   2. tests (npm run verify);
//   3. version number: commit and tag locally only;
//   4. build of the installer and of the portable version;
//   5. SHA256SUMS.txt, then push of the commit and the tag;
//   6. publishing of the Release (a single one, with every file).
// If the build (4) or the push (5) fails, the local commit and tag are
// undone: nothing was published. Installed copies of Sillon find the new
// version on their own (see src/main/app/updater.js).
// GitHub CLI (gh) signed in to the repository's account is needed.

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
if (!['patch', 'minor', 'major'].includes(bump)) fail('Usage: npm run release -- [patch|minor|major]');

const pkgFile = path.join(root, 'package.json');
const currentVersion = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version;
const { owner, repo } = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).build.publish[0];
const version = bumpVersion(currentVersion, bump);
const tag = `v${version}`;

// ---------- Release notes: before everything else ----------
let notes;
try {
  notes = extractReleaseNotes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version);
} catch (e) {
  fail(`${e.message}. Add this section (Release notes) before publishing.`);
}

// ---------- Checks ----------
if (out('git status --porcelain')) fail('Some changes are not committed.');
if (out('git rev-parse --abbrev-ref HEAD') !== 'main') fail('Publish from the main branch.');
run('git fetch -q origin');
if (out('git rev-parse HEAD') !== out('git rev-parse origin/main'))
  fail('main is not up to date with GitHub (git pull / git push first).');

let token;
try {
  token = out('gh auth token');
} catch {
  fail('GitHub CLI not signed in: run "gh auth login".');
}
const visibility = out(`gh api repos/${owner}/${repo} --jq .visibility`);
if (visibility !== 'public') {
  fail(
    `The repository ${owner}/${repo} is ${visibility}: installed copies of Sillon will not be able to download the update. Make it public first.`,
  );
}

// ---------- Tests ----------
run('npm run verify --silent');

// ---------- Version: local commit and tag (not pushed yet) ----------
const previousHead = out('git rev-parse HEAD');
run(`npm version ${bump} -m "Version %s"`);
if (JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version !== version) fail(`Unexpected version after npm version.`);

// Undoes the local commit and tag, without touching anything else (the repository was clean).
function rollback(reason) {
  console.error(`\n✗ ${reason}`);
  console.error('Undoing the local version commit and tag…');
  try {
    if (out('git rev-parse HEAD~1') !== previousHead) {
      console.error(`HEAD~1 is not the original commit: undo by hand (git tag -d ${tag}, git reset --hard).`);
    } else {
      run(`git tag -d ${tag}`);
      // --keep: refuses to overwrite files changed during the build.
      run('git reset --keep HEAD~1');
      console.error('Commit and tag undone, nothing was published.');
    }
  } catch (e) {
    console.error(`Incomplete undo: ${e.message}`);
  }
  process.exit(1);
}

// ---------- Build (without publishing) ----------
// electron-builder publishes each target in parallel and may create two Releases
// for the same tag (seen in 0.1.1): build without publishing, publish afterwards.
console.log(`\nConstruction de Sillon ${version}…`);
// Several attempts: the antivirus sometimes keeps an .exe open for a moment.
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
const dist = path.join(root, 'dist');
const assets = [
  'latest.yml', // read by installed copies of Sillon
  `Sillon-Setup-${version}.exe`,
  `Sillon-Setup-${version}.exe.blockmap`, // partial updates
  `Sillon-${version}-portable.exe`,
].map((f) => path.join(dist, f));

try {
  run('node scripts/build-helper.js --strict'); // assistant natif (Rust)
  run('npx electron-builder --win --publish never');
  for (const f of assets) if (!fs.existsSync(f)) throw new Error(`fichier attendu introuvable : ${f}`);
} catch (e) {
  rollback(`The build of Sillon ${version} failed (${e.message}).`);
}

// ---------- SHA-256 checksums ----------
const sumsFile = path.join(dist, 'SHA256SUMS.txt');
fs.writeFileSync(sumsFile, checksumLines(assets.map((f) => ({ sha256: sha256File(f), name: path.basename(f) }))));
assets.push(sumsFile);

// ---------- Push: only now ----------
try {
  run('git push origin main --follow-tags');
} catch {
  rollback('The push to GitHub failed.');
}

// ---------- Publishing: a single Release, every file ----------
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
    `Commit and tag are pushed, but the Release was not created. Run again: gh release create ${tag} <files of dist/> -R ${owner}/${repo} --notes-file <notes>`,
  );
} finally {
  fs.rmSync(notesFile, { force: true });
}

console.log(`\n✓ Sillon ${version} published: https://github.com/${owner}/${repo}/releases/tag/${tag}`);
console.log('  Installed versions will find it within 4 hours (or with "Check for updates").');
