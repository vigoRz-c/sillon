// Sillon's system helper (sillon-helper.exe, written in Rust).
//
// Small native program that reads the current track (Windows media
// controls), sets the player's volume and captures its sound alone. It replaces
// the old PowerShell scripts: about 5 MB of memory instead of 70 to
// 90 MB each, and immediate startup. Sources: native/sillon-helper.
//
// In a build: copied into resources/ (see extraResources in package.json).
// In development: built by "npm run build:helper".

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..', '..');

function helperExe() {
  const packaged = process.resourcesPath && path.join(process.resourcesPath, 'sillon-helper.exe');
  if (packaged && fs.existsSync(packaged)) return packaged;
  return path.join(ROOT, 'native', 'sillon-helper', 'target', 'release', 'sillon-helper.exe');
}

module.exports = { helperExe };
