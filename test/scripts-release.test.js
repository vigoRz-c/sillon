// Logique pure de scripts/release.js : numéro de version, notes tirées du
// CHANGELOG, empreintes SHA-256 (sans git ni GitHub).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { bumpVersion, extractReleaseNotes, checksumLines, sha256File } = require('../scripts/release-lib');

test('bumpVersion : patch, minor, major', () => {
  assert.equal(bumpVersion('0.1.0', 'patch'), '0.1.1');
  assert.equal(bumpVersion('0.1.9', 'patch'), '0.1.10');
  assert.equal(bumpVersion('0.1.4', 'minor'), '0.2.0');
  assert.equal(bumpVersion('0.2.0', 'major'), '1.0.0');
  assert.equal(bumpVersion('1.12.3', 'minor'), '1.13.0');
});

test('bumpVersion : refuse les versions et types invalides', () => {
  assert.throws(() => bumpVersion('0.2', 'patch'), /Version invalide/);
  assert.throws(() => bumpVersion('0.2.0-beta', 'patch'), /Version invalide/);
  assert.throws(() => bumpVersion('0.2.0', 'micro'), /Type de version inconnu/);
});

const CHANGELOG = `# Journal

## [Non publié]

### Corrigé
- Un correctif en attente.

## [0.2.0] - 2026-11-23

### Modifié
- Mémoire réduite.

- Rust nécessaire.

## [0.1.9] - 2026-11-22

### Ajouté
- Volume du lecteur.
`;

test('extractReleaseNotes : renvoie le corps de la section, sans le titre ni la section suivante', () => {
  const notes = extractReleaseNotes(CHANGELOG, '0.2.0');
  assert.equal(notes, '### Modifié\n- Mémoire réduite.\n\n- Rust nécessaire.');
  assert.ok(!notes.includes('## ['));
  assert.ok(!notes.includes('Volume du lecteur'));
});

test('extractReleaseNotes : la dernière section va jusqu’à la fin du fichier', () => {
  assert.equal(extractReleaseNotes(CHANGELOG, '0.1.9'), '### Ajouté\n- Volume du lecteur.');
});

test('extractReleaseNotes : gère les fins de ligne CRLF', () => {
  const crlf = CHANGELOG.replace(/\n/g, '\r\n');
  assert.equal(extractReleaseNotes(crlf, '0.2.0'), '### Modifié\n- Mémoire réduite.\n\n- Rust nécessaire.');
});

test('extractReleaseNotes : refuse une section absente ou vide', () => {
  assert.throws(() => extractReleaseNotes(CHANGELOG, '0.3.0'), /absente/);
  // « 0.2.0 » ne doit pas correspondre à « 0.2.0-beta » ni à « 0.2.01 ».
  assert.throws(() => extractReleaseNotes('## [0.2.01] - x\n- a\n', '0.2.0'), /absente/);
  assert.throws(() => extractReleaseNotes('## [0.2.0] - x\n\n## [0.1.0] - y\n- a\n', '0.2.0'), /vide/);
});

test('checksumLines : format sha256sum, une ligne par fichier', () => {
  assert.equal(
    checksumLines([
      { sha256: 'aa', name: 'Sillon-Setup-0.2.0.exe' },
      { sha256: 'bb', name: 'latest.yml' },
    ]),
    'aa  Sillon-Setup-0.2.0.exe\nbb  latest.yml\n',
  );
});

test('sha256File : empreinte SHA-256 d’un fichier', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sillon-sha-'));
  try {
    const file = path.join(dir, 'abc.txt');
    fs.writeFileSync(file, 'abc');
    // SHA-256 de « abc », valeur de référence de la norme FIPS 180-2.
    assert.equal(sha256File(file), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
