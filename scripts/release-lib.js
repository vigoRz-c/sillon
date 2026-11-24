// Pure functions and helpers of scripts/release.js (tested in
// test/scripts-release.test.js). Nothing here touches git or GitHub.

const crypto = require('crypto');
const fs = require('fs');

// "0.2.0" + "minor" -> "0.3.0". Only X.Y.Z versions are accepted.
function bumpVersion(current, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) throw new Error(`Invalid version in package.json: "${current}"`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown version type: "${kind}" (patch, minor or major)`);
}

// Content of the "## [version]" section of the CHANGELOG, without the title.
// Throws if the section is missing or empty: no publishing without notes.
function extractReleaseNotes(changelog, version) {
  const lines = String(changelog).split(/\r?\n/);
  const heading = `## [${version}]`;
  const start = lines.findIndex((l) => l === heading || l.startsWith(`${heading} `));
  if (start === -1) throw new Error(`Section "## [${version}]" missing from CHANGELOG.md`);
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end === -1) end = lines.length;
  const body = lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
  if (!body) throw new Error(`The "## [${version}]" section of CHANGELOG.md is empty`);
  return body;
}

// Lines in sha256sum format: "<checksum>  <name>" (two spaces).
function checksumLines(entries) {
  return entries.map(({ sha256, name }) => `${sha256}  ${name}`).join('\n') + '\n';
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

module.exports = { bumpVersion, extractReleaseNotes, checksumLines, sha256File };
