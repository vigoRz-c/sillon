// Vérifications de l'assistant natif (native/sillon-helper, en Rust) :
// formatage, clippy (avertissements = erreurs) et tests, comme la CI.
//
//   npm run verify:rust        échoue si Rust (cargo) n'est pas installé
//   npm run verify             saute cette étape avec un message si cargo manque
//
// Les commandes tournent depuis le dossier du helper : c'est là que se trouve
// .cargo/config.toml (+crt-static). Toujours avec --locked (Cargo.lock figé).

const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');

const helperDir = path.join(__dirname, '..', 'native', 'sillon-helper');
const strict = process.argv.includes('--strict');

// Même PATH que scripts/build-helper.js : cargo n'est pas toujours dans le PATH après rustup.
const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
const env = { ...process.env, PATH: `${path.join(cargoHome, 'bin')}${path.delimiter}${process.env.PATH}` };

const cargo = (args) => spawnSync('cargo', args, { cwd: helperDir, stdio: 'inherit', env, shell: false });

const probe = spawnSync('cargo', ['--version'], { env, shell: false, stdio: 'ignore' });
if (probe.error || probe.status !== 0) {
  const msg = "Rust (cargo) n'est pas installé : vérification de l'assistant natif ignorée (https://rustup.rs).";
  if (strict) {
    console.error(`\n✗ ${msg}`);
    process.exit(1);
  }
  console.warn(`\n⚠ ${msg}`);
  process.exit(0);
}

const steps = [
  ['Formatage (cargo fmt)', ['fmt', '--check']],
  ['Clippy (avertissements = erreurs)', ['clippy', '--locked', '--', '-D', 'warnings']],
  ['Tests (cargo test)', ['test', '--locked']],
];

for (const [label, args] of steps) {
  console.log(`\n▶ ${label} : cargo ${args.join(' ')}`);
  const r = cargo(args);
  if (r.status !== 0) {
    console.error(`\n✗ ${label} : échec.`);
    process.exit(r.status || 1);
  }
}
console.log('\n✓ Assistant natif : formatage, clippy et tests OK');
