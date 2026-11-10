// The selection lint (#1460): what is open lives in one selection state, and one `open` opens every page. Under
// crates/deep-app/src it fails a `thread_local!` static that holds the selection (named OPENED, POPPED, DOCK,
// NEXT_EXTENSION, SLOT, SELECTED, SELECTION or CURRENT, or typed with an Address, a DockArea or an Option<Kind>), and
// under crates/deep-app/src and crates/deep-replica/src each call that selects a page in the dock or presents an
// ask's card outside crates/deep-app/src/open.rs (`.select_panel(`, `.add_panel(`, `present_ask(`), naming the
// function it is in. One `FAIL selection: <path>:<line>: ...` line per finding, or one `PASS selection` line; exit 1 on a
// finding. `--root <dir>` checks another checkout.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCES = ['crates/deep-app/src', 'crates/deep-replica/src'];
const OPEN = 'crates/deep-app/src/open.rs';
const NAMES = /^(OPENED|POPPED|DOCK|NEXT_EXTENSION|SLOT|SELECTED|SELECTION|CURRENT)$/;
const TYPES = /\bAddress\b|\bDockArea\b|Option<\s*Kind\s*>/;
const ROUTES = /\.select_panel\s*\(|\.add_panel\s*\(|\bpresent_ask\s*\(/;

const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
  console.log('BLOCKED selection: --root takes a folder\n  Fix: node scripts/selection-lint.mjs [--root <checkout>]');
  process.exit(2);
}
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : name.endsWith('.rs') ? [path] : [];
});

/** A line with its comment and the insides of its strings gone, so neither counts as code. */
const code = (line) => line.replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/\/\/.*$/, '');

let failed = false;
const fail = (path, line, why) => {
  failed = true;
  console.log(`FAIL selection: ${relative(root, path)}:${line + 1}: ${why}`);
};

for (const source of SOURCES) {
  let found;
  try { found = files(join(root, source)); } catch { continue; }
  for (const path of found) {
    const name = relative(root, path);
    const lines = readFileSync(path, 'utf8').split('\n').map(code);
    let local = false;
    let fn = '';
    for (let i = 0; i < lines.length; i++) {
      const text = lines[i];
      const named = /\bfn\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(text);
      if (named) fn = named[1];
      if (/\bthread_local!\s*\{/.test(text)) local = true;
      if (local) {
        const field = /\bstatic\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(text);
        if (field && source === SOURCES[0] && (NAMES.test(field[1]) || TYPES.test(field[2]))) {
          fail(path, i, `${field[1]} keeps what is open in a thread local; it belongs in the one selection state (crates/deep-app/src/open.rs)`);
        }
        if (/^\s*\}\s*$/.test(text)) local = false;
      }
      if (name !== OPEN && ROUTES.test(text) && !/\bpub\s+fn\s+present_ask\b/.test(text)) {
        fail(path, i, `fn ${fn} opens a page without open; call crate::open::open with its address`);
      }
    }
  }
}
if (failed) {
  console.log('  Fix: keep the selection in crate::open::Selection, and open every page through crate::open::open (#1460).');
  process.exit(1);
}
console.log('PASS selection');
