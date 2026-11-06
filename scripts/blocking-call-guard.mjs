// The preflight's blocking-call guard (#1556): the app's UI thread draws every frame, so a call in crates/deep-app/src
// that waits for another process to end (`.output()`, `.status()`, `.wait()`, `.wait_with_output()`) freezes the window
// for as long as that process runs, as the first Set up click did. A call that never runs on the UI thread is allowed
// with its reason, a `// blocking call: <why>` comment on its line or in the comment lines just above it. One
// `FAIL blocking call: <path>:<line>:<column>: ...` line per other call, or one `PASS blocking call` line; exit 1 on a
// finding. `--root <dir>` checks the app's source under another checkout.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripRust } from './rust-source.mjs';

const SOURCE = 'crates/deep-app/src';
/** std::process's waits: Command's output and status, and Child's wait and wait_with_output. */
const CALL = /\.\s*(output|status|wait|wait_with_output)\s*\(\s*\)/g;
const ALLOWED = /\/\/\s*blocking call:\s*\S/;

const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
  console.log('BLOCKED blocking call: --root takes a folder\n  Fix: node scripts/blocking-call-guard.mjs [--root <checkout>]');
  process.exit(2);
}
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : name.endsWith('.rs') ? [path] : [];
});

/** Whether the call on `lines[index]` carries its reason: on its line, or in the `//` lines just above it. */
function allowed(lines, index) {
  if (ALLOWED.test(lines[index])) return true;
  for (let above = index - 1; above >= 0 && /^\s*\/\//.test(lines[above]); above -= 1) if (ALLOWED.test(lines[above])) return true;
  return false;
}

const findings = [];
for (const file of files(join(root, SOURCE)).sort()) {
  const path = relative(root, file).replaceAll('\\', '/');
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  stripRust(text).split('\n').forEach((code, index) => {
    for (const match of code.matchAll(CALL)) {
      if (!allowed(lines, index)) findings.push(`FAIL blocking call: ${path}:${index + 1}:${match.index + 1}: .${match[1]}() waits for a process to end, and UI code that waits freezes the window; run it on a thread of its own and hand the UI thread its result (as setup::start does), or, if it never runs on the UI thread, say why in a // blocking call: <why> comment above it`);
    }
  });
}
for (const line of findings) console.log(line);
if (!findings.length) console.log(`PASS blocking call: no call in ${SOURCE} waits for a process on the UI thread`);
process.exitCode = findings.length ? 1 : 0;
