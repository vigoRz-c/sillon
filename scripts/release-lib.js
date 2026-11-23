// Fonctions pures et utilitaires de scripts/release.js (testées dans
// test/scripts-release.test.js). Rien ici ne touche à git ni à GitHub.

const crypto = require('crypto');
const fs = require('fs');

// « 0.2.0 » + « minor » -> « 0.3.0 ». Seules les versions X.Y.Z sont acceptées.
function bumpVersion(current, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) throw new Error(`Version invalide dans package.json : « ${current} »`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Type de version inconnu : « ${kind} » (patch, minor ou major)`);
}

// Contenu de la section « ## [version] » du CHANGELOG, sans le titre.
// Lève une erreur si la section est absente ou vide : on ne publie pas sans notes.
function extractReleaseNotes(changelog, version) {
  const lines = String(changelog).split(/\r?\n/);
  const heading = `## [${version}]`;
  const start = lines.findIndex((l) => l === heading || l.startsWith(`${heading} `));
  if (start === -1) throw new Error(`Section « ## [${version}] » absente du CHANGELOG.md`);
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end === -1) end = lines.length;
  const body = lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
  if (!body) throw new Error(`La section « ## [${version}] » du CHANGELOG.md est vide`);
  return body;
}

// Lignes au format de sha256sum : « <empreinte>  <nom> » (deux espaces).
function checksumLines(entries) {
  return entries.map(({ sha256, name }) => `${sha256}  ${name}`).join('\n') + '\n';
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

module.exports = { bumpVersion, extractReleaseNotes, checksumLines, sha256File };
