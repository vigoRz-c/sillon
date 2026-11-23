// Vérification rapide : syntaxe de tous les fichiers JS du projet.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    // target : sorties de cargo (native/sillon-helper/target), sans JS à vérifier.
    if (f === 'node_modules' || f === 'target' || f.startsWith('.') || f === 'dist') continue;
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.js')) files.push(p);
  }
})(root);

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error(`✗ ${path.relative(root, f)}\n${e.stderr}`);
  }
}
console.log(failed ? `${failed} fichier(s) en erreur` : `✓ ${files.length} fichiers JS OK`);
process.exit(failed ? 1 : 0);
