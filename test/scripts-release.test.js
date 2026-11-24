// Pure logic of scripts/release.js: version number, notes taken from the
// CHANGELOG, SHA-256 checksums (without git or GitHub).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { bumpVersion, extractReleaseNotes, checksumLines, sha256File } = require('../scripts/release-lib');

test('bumpVersion: patch, minor, major', () => {
  assert.equal(bumpVersion('0.1.0', 'patch'), '0.1.1');
  assert.equal(bumpVersion('0.1.9', 'patch'), '0.1.10');
  assert.equal(bumpVersion('0.1.4', 'minor'), '0.2.0');
  assert.equal(bumpVersion('0.2.0', 'major'), '1.0.0');
  assert.equal(bumpVersion('1.12.3', 'minor'), '1.13.0');
});

test('bumpVersion: refuses invalid versions and types', () => {
  assert.throws(() => bumpVersion('0.2', 'patch'), /Invalid version/);
  assert.throws(() => bumpVersion('0.2.0-beta', 'patch'), /Invalid version/);
  assert.throws(() => bumpVersion('0.2.0', 'micro'), /Unknown version type/);
});

const CHANGELOG = `# Changelog

## [Unreleased]

### Fixed
- A pending fix.

## [0.2.0] - 2026-11-23

### Changed
- Lower memory.

- Rust required.

## [0.1.9] - 2026-11-22

### Added
- Player volume.
`;

test('extractReleaseNotes: returns the body of the section, without the title or the next section', () => {
  const notes = extractReleaseNotes(CHANGELOG, '0.2.0');
  assert.equal(notes, '### Changed\n- Lower memory.\n\n- Rust required.');
  assert.ok(!notes.includes('## ['));
  assert.ok(!notes.includes('Volume du lecteur'));
});

test('extractReleaseNotes: the last section goes to the end of the file', () => {
  assert.equal(extractReleaseNotes(CHANGELOG, '0.1.9'), '### Added\n- Player volume.');
});

test('extractReleaseNotes: handles CRLF line endings', () => {
  const crlf = CHANGELOG.replace(/\n/g, '\r\n');
  assert.equal(extractReleaseNotes(crlf, '0.2.0'), '### Changed\n- Lower memory.\n\n- Rust required.');
});

test('extractReleaseNotes: refuses a missing or empty section', () => {
  assert.throws(() => extractReleaseNotes(CHANGELOG, '0.3.0'), /missing/);
  // "0.2.0" must not match "0.2.0-beta" or "0.2.01".
  assert.throws(() => extractReleaseNotes('## [0.2.01] - x\n- a\n', '0.2.0'), /missing/);
  assert.throws(() => extractReleaseNotes('## [0.2.0] - x\n\n## [0.1.0] - y\n- a\n', '0.2.0'), /is empty/);
});

test('checksumLines: sha256sum format, one line per file', () => {
  assert.equal(
    checksumLines([
      { sha256: 'aa', name: 'Sillon-Setup-0.2.0.exe' },
      { sha256: 'bb', name: 'latest.yml' },
    ]),
    'aa  Sillon-Setup-0.2.0.exe\nbb  latest.yml\n',
  );
});

test('sha256File: SHA-256 checksum of a file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sillon-sha-'));
  try {
    const file = path.join(dir, 'abc.txt');
    fs.writeFileSync(file, 'abc');
    // SHA-256 of "abc", reference value of the FIPS 180-2 standard.
    assert.equal(sha256File(file), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
