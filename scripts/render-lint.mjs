// The render lint (#1454): the replica draws the app's tree, so no view's `render` reads whether a fixture is loaded. It
// checks every `fn render` of an `impl Render for …` under crates/deep-app/src, and fails each read there of
// `current_state()`, the fixture's state, or of a variable named `decorations`, as the views held it. Issue #1457: it
// fails each file-system call there too (`exists()`, `fs::`, `read_to_string`, `read_dir`, `metadata()`, `is_file()`,
// `is_dir()`, `File::open`), since a frame reads what a tick kept, never the disk. One `FAIL render: <path>:<line>: ...`
// line per read, or one `PASS render` line; exit 1 on a finding. `--root <dir>` checks the app's source under another
// checkout.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'crates/deep-app/src';
const READS = /\bcurrent_state\s*\(|\bdecorations\b/;
const DISK = /\.exists\s*\(\s*\)|\bfs::|\bread_to_string\b|\bread_dir\b|\.metadata\s*\(|\.is_file\s*\(\s*\)|\.is_dir\s*\(\s*\)|\bFile::open\b/;

const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
  console.log('BLOCKED render: --root takes a folder\n  Fix: node scripts/render-lint.mjs [--root <checkout>]');
  process.exit(2);
}
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : name.endsWith('.rs') ? [path] : [];
});

/** A line with its comment and the insides of its strings gone, so neither counts as code or as a brace. */
const code = (line) => line.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/\/\/.*$/, '');

/** The lines, from 1, of every `fn render` body inside an `impl Render for`. */
function renderLines(lines) {
  const inside = [];
  let view = false;
  for (let i = 0; i < lines.length; i++) {
    if (/\bimpl\b.*\bRender\s+for\b/.test(code(lines[i]))) view = true;
    if (!view || !/\bfn\s+render\b/.test(code(lines[i]))) continue;
    view = false;
    let depth = 0;
    let opened = false;
    for (let j = i; j < lines.length; j++) {
      for (const c of code(lines[j])) {
        if (c === '{') { depth++; opened = true; } else if (c === '}') depth--;
      }
      inside.push(j);
      if (opened && depth === 0) break;
    }
  }
  return inside;
}

let failed = false;
for (const path of files(join(root, SOURCE))) {
  const lines = readFileSync(path, 'utf8').split('\n');
  for (const line of renderLines(lines)) {
    const text = code(lines[line]);
    if (READS.test(text)) {
      failed = true;
      console.log(`FAIL render: ${relative(root, path)}:${line + 1}: a view's render reads fixture state; a fixture supplies the record and nothing else`);
    }
    if (DISK.test(text)) {
      failed = true;
      console.log(`FAIL render: ${relative(root, path)}:${line + 1}: a view's render calls the file system; a frame reads what a tick kept (#1457)`);
    }
  }
}
if (failed) {
  console.log('  Fix: draw from the one record reader, and let the replica supply the record alone (#1454); read the disk on a tick, off the frame, and draw what it kept (#1457).');
  process.exit(1);
}
console.log('PASS render');
