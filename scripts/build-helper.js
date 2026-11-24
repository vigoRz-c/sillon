// Builds the native helper (native/sillon-helper, in Rust).
//
//   npm run build:helper            builds if Rust is installed
//   npm run build:helper -- --strict fails if the build is impossible
//                                    (used by publishing and the CI)
//
// Run automatically before "npm start" and "npm run dist". Without Rust, a
// warning is shown: Sillon still starts, but without the current track or the
// player-only sound. Rust is installed with rustup: https://rustup.rs

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const root = path.join(__dirname, '..');
// cargo must be run from the helper's folder: that is where
// .cargo/config.toml is (+crt-static, no VC++ runtime to install for the user).
const helperDir = path.join(root, 'native', 'sillon-helper');
const exe = path.join(root, 'native', 'sillon-helper', 'target', 'release', 'sillon-helper.exe');
const strict = process.argv.includes('--strict');

// cargo is not always in the PATH right after installing rustup.
const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), '.cargo');
const env = { ...process.env, PATH: `${path.join(cargoHome, 'bin')}${path.delimiter}${process.env.PATH}` };

const r = spawnSync('cargo', ['build', '--release', '--locked', '--quiet'], {
  cwd: helperDir,
  stdio: 'inherit',
  env,
  shell: false,
});
if (r.status === 0) process.exit(0);

const why = r.error && r.error.code === 'ENOENT' ? 'Rust (cargo) is not installed' : 'the build failed';
if (strict) {
  console.error(`\n✗ Assistant natif : ${why}.`);
  process.exit(1);
}
if (fs.existsSync(exe)) {
  console.warn(`\n⚠ Native helper: ${why}, keeping the version already built.`);
} else {
  console.warn(`\n⚠ Native helper: ${why}. Sillon starts without the current track or the player-only sound.`);
  console.warn('  Install Rust (https://rustup.rs) then run "npm start" again.');
}
