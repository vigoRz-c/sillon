// Compile l'assistant natif (native/sillon-helper, en Rust).
//
//   npm run build:helper            compile si Rust est installé
//   npm run build:helper -- --strict échoue si la compilation est impossible
//                                    (utilisé par la publication et la CI)
//
// Lancé automatiquement avant « npm start » et « npm run dist ». Sans Rust, on
// prévient : Sillon démarre quand même, mais sans morceau en cours ni son du
// lecteur seul. Rust s'installe avec rustup : https://rustup.rs

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = path.join(__dirname, '..');
const manifest = path.join(root, 'native', 'sillon-helper', 'Cargo.toml');
const exe = path.join(root, 'native', 'sillon-helper', 'target', 'release', 'sillon-helper.exe');
const strict = process.argv.includes('--strict');

// cargo n'est pas toujours dans le PATH juste après l'installation de rustup.
const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
const env = { ...process.env, PATH: `${path.join(cargoHome, 'bin')}${path.delimiter}${process.env.PATH}` };

const r = spawnSync('cargo', ['build', '--release', '--quiet', '--manifest-path', manifest], {
  stdio: 'inherit',
  env,
  shell: false,
});
if (r.status === 0) process.exit(0);

const why = r.error && r.error.code === 'ENOENT' ? "Rust (cargo) n'est pas installé" : 'la compilation a échoué';
if (strict) {
  console.error(`\n✗ Assistant natif : ${why}.`);
  process.exit(1);
}
if (fs.existsSync(exe)) {
  console.warn(`\n⚠ Assistant natif : ${why}, on garde la version déjà compilée.`);
} else {
  console.warn(`\n⚠ Assistant natif : ${why}. Sillon démarre sans morceau en cours ni son du lecteur seul.`);
  console.warn('  Installe Rust (https://rustup.rs) puis relance « npm start ».');
}
