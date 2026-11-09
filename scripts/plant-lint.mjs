// The plant lint (#1457): a plant or test door that the environment selects is never read by a shipped build. Under
// crates/deep-app/src, each `env::var` / `env::var_os` read of `DEEP_*_PLANT` or `DEEP_APP_NOTIFICATION_SETTING` must sit
// under a `#[cfg(feature = ...)]`, `#[cfg(debug_assertions)]` or `#[cfg(test)]`, on the statement or on a block around it,
// so a release build compiles none. One `FAIL plant: <path>:<line>: ...` line per read, or one `PASS plant` line; exit 1
// on a finding. `--root <dir>` checks the app's source under another checkout.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'crates/deep-app/src';
const READ = /\benv::var(?:_os)?\s*\(\s*"(DEEP_\w*PLANT|DEEP_APP_NOTIFICATION_SETTING)"/;
const GATE = /#\[cfg\((?:all\()?(?:feature\s*=|debug_assertions|test\b)/;

const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
  console.log('BLOCKED plant: --root takes a folder\n  Fix: node scripts/plant-lint.mjs [--root <checkout>]');
  process.exit(2);
}
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : name.endsWith('.rs') ? [path] : [];
});

/** A line with its comment gone and its strings emptied, so neither counts as a brace or an attribute. */
const code = (line) => line.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/\/\/.*$/, '');

let failed = false;
for (const path of files(join(root, SOURCE))) {
  const lines = readFileSync(path, 'utf8').split('\n');
  // Each open brace's gate; an attribute gates the statement after it and every block that statement opens.
  const stack = [lines.some((l) => /^#!\[cfg\((?:all\()?(?:feature\s*=|test\b)/.test(l))];
  let pending = false;
  let statement = false;
  for (let i = 0; i < lines.length; i++) {
    const text = code(lines[i]).trim();
    if (!text) continue;
    if (GATE.test(text) && text.startsWith('#[')) { pending = true; continue; }
    if (text.startsWith('#[')) continue;
    const gated = stack[stack.length - 1] || pending || statement;
    if (READ.test(lines[i].replace(/\/\/.*$/, '')) && !gated) {
      failed = true;
      console.log(`FAIL plant: ${relative(root, path)}:${i + 1}: an environment read selects a plant in a shipped build; put it under a cargo feature`);
    }
    for (const c of text) {
      if (c === '{') stack.push(gated);
      else if (c === '}' && stack.length > 1) stack.pop();
    }
    // A gated statement that runs over several lines stays gated until it ends.
    statement = gated && !/[;{}]$/.test(text);
    pending = false;
  }
}
if (failed) {
  console.log('  Fix: read the plant only in a build with its cargo feature (#[cfg(feature = "...")]), never in a release build (#1457).');
  process.exit(1);
}
console.log('PASS plant');
