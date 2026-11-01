// #882 AC4's wrong inventories share this one; each wrong/inventory-*.mjs runs it with one fault switched on, and
// inventory-control.mjs with none. A row per `register_panel(cx, "<name>", ...)` in the app's source, with the file
// it is in as its entry. Faults: `alwaysPass`, `fixedList` (the five shipped panels, whatever the source says),
// `unnamed` (a FAIL line that names no panel), `ignoresRoot` (reads the app from its own checkout), `countOnly` (compares row counts).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = 'crates/deep-app/inventory.json';
const SHIPPED = ['deepbuild/sidebar', 'deepbuild/home', 'deepbuild/needs-you', 'deepbuild/session', 'deepbuild/line'];

function fresh(root, faults) {
  const src = join(root, 'crates/deep-app/src');
  const files = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : name.endsWith('.rs') ? [path] : [];
  });
  const panels = faults.fixedList
    ? SHIPPED.map((panel) => ({ panel, entry: 'crates/deep-app/src/views.rs', roles: [], literals: [] }))
    : files(src).flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/register_panel\(\s*cx,\s*"([^"]+)"/g)]
      .map(([, panel]) => ({ panel, entry: relative(root, file).replaceAll('\\', '/'), roles: [], literals: [] })));
  return { panels: panels.sort((a, b) => a.panel.localeCompare(b.panel)) };
}

export function inventory(faults = {}) {
  const at = process.argv.indexOf('--root');
  const own = fileURLToPath(new URL('../../../../', import.meta.url));
  const root = at === -1 ? own : process.argv[at + 1];
  // ignoresRoot reads the app from its own checkout; it still writes and compares under --root, never in the repo.
  const now = fresh(faults.ignoresRoot ? own : root, faults);
  if (!process.argv.includes('--check')) {
    writeFileSync(join(root, FILE), `${JSON.stringify(now, null, 2)}\n`);
    return;
  }
  if (faults.alwaysPass) return;
  const committed = existsSync(join(root, FILE)) ? JSON.parse(readFileSync(join(root, FILE), 'utf8')) : { panels: [] };
  let differs;
  if (faults.countOnly) differs = committed.panels.length === now.panels.length ? [] : ['(rows)'];
  else {
    const key = (rows) => new Map(rows.map((row) => [row.panel, JSON.stringify(row)]));
    const [was, is] = [key(committed.panels), key(now.panels)];
    differs = [...new Set([...was.keys(), ...is.keys()])].filter((panel) => was.get(panel) !== is.get(panel));
  }
  for (const panel of differs) console.log(faults.unnamed || faults.countOnly ? 'FAIL inventory: the inventory is stale' : `FAIL inventory: ${panel}: its row differs from a fresh inventory; run node scripts/app-inventory.mjs`);
  process.exitCode = differs.length ? 1 : 0;
}
