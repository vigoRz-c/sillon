// Quick check: syntax of every JS file of the project.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    // target: cargo outputs (native/sillon-helper/target), no JS to check.
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
console.log(failed ? `${failed} file(s) with errors` : `✓ ${files.length} JS files OK`);
process.exit(failed ? 1 : 0);
