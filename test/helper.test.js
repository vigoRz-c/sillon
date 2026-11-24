// helper.js : l'assistant empaqueté (resources/) est préféré à celui du dépôt.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { helperExe } = require('../src/main/audio/helper');

const devPath = path.join(__dirname, '..', 'native', 'sillon-helper', 'target', 'release', 'sillon-helper.exe');

test('helperExe : version empaquetée si elle existe', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sillon-res-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'sillon-helper.exe'), '');
  const old = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  Object.defineProperty(process, 'resourcesPath', { value: dir, configurable: true });
  t.after(() => (old ? Object.defineProperty(process, 'resourcesPath', old) : delete process.resourcesPath));
  assert.equal(helperExe(), path.join(dir, 'sillon-helper.exe'));
});

test('helperExe : sinon celle compilée dans le dépôt (développement)', (t) => {
  const old = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  Object.defineProperty(process, 'resourcesPath', { value: path.join(os.tmpdir(), 'absent-xyz'), configurable: true });
  t.after(() => (old ? Object.defineProperty(process, 'resourcesPath', old) : delete process.resourcesPath));
  assert.equal(helperExe(), devPath);
  delete process.resourcesPath;
  assert.equal(helperExe(), devPath);
});
