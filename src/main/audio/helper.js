// Assistant système de Sillon (sillon-helper.exe, écrit en Rust).
//
// Petit programme natif qui lit le morceau en cours (contrôles média de
// Windows), règle le volume du lecteur et capture son seul son. Il remplace
// les anciens scripts PowerShell : environ 5 Mo de mémoire au lieu de 70 à
// 90 Mo chacun, et démarrage immédiat. Sources : native/sillon-helper.
//
// En build : copié dans resources/ (voir extraResources de package.json).
// En développement : compilé par « npm run build:helper ».

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..', '..', '..');

function helperExe() {
  const packaged = process.resourcesPath && path.join(process.resourcesPath, 'sillon-helper.exe');
  if (packaged && fs.existsSync(packaged)) return packaged;
  return path.join(ROOT, 'native', 'sillon-helper', 'target', 'release', 'sillon-helper.exe');
}

module.exports = { helperExe };
