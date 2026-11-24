// Checks of the native helper (native/sillon-helper, in Rust):
// formatting, clippy (warnings = errors) and tests, like the CI.
//
//   npm run verify:rust        fails if Rust (cargo) is not installed
//   npm run verify             skips this step with a message if cargo is missing
//
// The commands run from the helper's folder: that is where
// .cargo/config.toml is (+crt-static). Always with --locked (frozen Cargo.lock).

const { spawnSync } = require('child_process');
const path = require('path');
const os = require('os');

const helperDir = path.join(__dirname, '..', 'native', 'sillon-helper');
const strict = process.argv.includes('--strict');

// Same PATH as scripts/build-helper.js: cargo is not always in the PATH after rustup.
const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
const env = { ...process.env, PATH: `${path.join(cargoHome, 'bin')}${path.delimiter}${process.env.PATH}` };

const cargo = (args) => spawnSync('cargo', args, { cwd: helperDir, stdio: 'inherit', env, shell: false });

const probe = spawnSync('cargo', ['--version'], { env, shell: false, stdio: 'ignore' });
if (probe.error || probe.status !== 0) {
  const msg = 'Rust (cargo) is not installed: native helper check skipped (https://rustup.rs).';
  if (strict) {
    console.error(`\n✗ ${msg}`);
    process.exit(1);
  }
  console.warn(`\n⚠ ${msg}`);
  process.exit(0);
}

const steps = [
  ['Formatting (cargo fmt)', ['fmt', '--check']],
  ['Clippy (warnings = errors)', ['clippy', '--locked', '--', '-D', 'warnings']],
  ['Tests (cargo test)', ['test', '--locked']],
];

for (const [label, args] of steps) {
  console.log(`\n▶ ${label} : cargo ${args.join(' ')}`);
  const r = cargo(args);
  if (r.status !== 0) {
    console.error(`\n✗ ${label}: failed.`);
    process.exit(r.status || 1);
  }
}
console.log('\n✓ Native helper: formatting, clippy and tests OK');
