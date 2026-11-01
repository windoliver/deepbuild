// The app's surface inventory (#882): one row per panel the app's Rust source registers (`register_panel`), with
// its entry (the file and view that draw it), the look's roles it draws with (`chrome.<role>`) and any
// color literal left in it, written to crates/deep-app/inventory.json. `--check` writes nothing and fails, one
// `FAIL inventory: <panel> ...` line each, for every panel whose committed row differs from a fresh one, is missing
// or is extra; regenerate with `node scripts/app-inventory.mjs`. `--root <dir>` reads another checkout's app.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LITERAL } from './color-literal-guard.mjs';

const SOURCE = 'crates/deep-app/src';
const INVENTORY = 'crates/deep-app/inventory.json';

const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
  console.log('BLOCKED inventory: --root takes a folder\n  Fix: node scripts/app-inventory.mjs [--check] [--root <checkout>]');
  process.exit(2);
}
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];

const files = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : name.endsWith('.rs') ? [path] : [];
});
const sources = files(join(root, SOURCE)).map((file) => ({ path: relative(root, file).replaceAll('\\', '/'), lines: readFileSync(file, 'utf8').split('\n') }));
const all = sources.flatMap(({ path, lines }) => lines.map((text, i) => ({ path, line: i + 1, text })));

/** A `const NAME: &str = "...";` anywhere in the app. */
const constant = (name) => all.map(({ text }) => new RegExp(`const ${name}: &str = "([^"]+)"`).exec(text)?.[1]).find(Boolean);

/** The lines of `impl Render for <view>`'s body: from its line to the closing brace at its own indent. */
function render(view) {
  const start = all.findIndex(({ text }) => text.startsWith(`impl Render for ${view} {`));
  if (start === -1) return [];
  const end = all.findIndex(({ text, path }, i) => i > start && path === all[start].path && text === '}');
  return all.slice(start, end + 1);
}

/** For a `Shipped` view of `kind`: the render's lines before `match self.kind` and that kind's arm. */
function arm(kind) {
  const body = render('Shipped');
  const match = body.findIndex(({ text }) => text.includes('match self.kind'));
  const arms = body.map((l, i) => [i, /^(\s*)Kind::(\w+) =>/.exec(l.text)]).filter(([i, m]) => m && i > match);
  const indent = Math.min(...arms.map(([, m]) => m[1].length));
  const top = arms.filter(([, m]) => m[1].length === indent);
  const k = top.findIndex(([, m]) => m[2] === kind);
  if (k === -1) return null;
  const end = top[k + 1]?.[0] ?? body.findLastIndex(({ text }) => /^\s*}\s*$/.test(text));
  return [...body.slice(0, match), ...body.slice(top[k][0], end)];
}

/** One panel's row from the lines that draw it. */
function row(panel, entry, lines) {
  const roles = [...new Set(lines.flatMap(({ text }) => [...text.matchAll(/\bchrome\.(\w+)/g)].map((m) => m[1])))].sort();
  const literals = lines.filter(({ text }) => !/^\s*\/\//.test(text) && LITERAL.test(text)).map(({ path, line, text }) => `${path}:${line}: ${text.trim()}`);
  return { panel, entry, roles, literals };
}

/** The view a registration's closure builds: `Shipped` of a kind, or another struct. */
function rowFor(panel, closure, kind) {
  const shipped = /Shipped::new\(Kind::(\w+)/.exec(closure)?.[1] ?? (/Shipped::new\(kind\b/.test(closure) ? kind : null);
  if (shipped) {
    const lines = arm(shipped) ?? [];
    const head = lines.find(({ text }) => text.includes(`Kind::${shipped} =>`)) ?? render('Shipped')[0];
    return row(panel, `${head?.path} Shipped, Kind::${shipped}`, lines);
  }
  const view = /cx\.new\(\|cx\|\s*(\w+)\s*\{/.exec(closure)?.[1] ?? /cx\.new\(\|cx\|\s*(\w+)::/.exec(closure)?.[1];
  const lines = render(view);
  return row(panel, lines.length ? `${lines[0].path} ${view}` : `${view}`, lines);
}

/** Every registration: `register_panel(cx, <name>, <closure>)`, over `Kind::ALL` when the name is `kind.name()`. */
function inventory() {
  const panels = [];
  all.forEach(({ text }, i) => {
    const call = /register_panel\(\s*cx,\s*([^,]+),(.*)$/.exec(text);
    if (!call) return;
    const closure = [call[2], ...all.slice(i + 1, i + 6).map((l) => l.text)].join('\n');
    const name = call[1].trim();
    if (name === 'kind.name()') {
      const kinds = /pub const ALL: \[Kind; \d+\] = \[([^\]]+)\]/s.exec(all.map((l) => l.text).join('\n'))?.[1].match(/Kind::(\w+)/g) ?? [];
      for (const kind of kinds.map((k) => k.slice(6))) {
        const constName = all.map(({ text }) => new RegExp(`^\\s*Kind::${kind} => (\\w+),`).exec(text)?.[1]).find(Boolean);
        panels.push(rowFor(constant(constName) ?? kind, closure, kind));
      }
    } else panels.push(rowFor(/^"(.+)"$/.exec(name)?.[1] ?? constant(name) ?? name, closure));
  });
  return panels.sort((a, b) => a.panel.localeCompare(b.panel));
}

const fresh = inventory();
const file = join(root, INVENTORY);
if (!process.argv.includes('--check')) {
  writeFileSync(file, `${JSON.stringify({ panels: fresh }, null, 2)}\n`);
  console.log(`PASS inventory: wrote ${INVENTORY}, ${fresh.length} panels`);
} else {
  let committed = [];
  try {
    committed = JSON.parse(readFileSync(file, 'utf8')).panels ?? [];
  } catch {
    console.log(`FAIL inventory: no readable ${INVENTORY}\n  Fix: node scripts/app-inventory.mjs`);
    process.exit(1);
  }
  const names = [...new Set([...fresh, ...committed].map((p) => p.panel))].sort();
  const findings = names.flatMap((name) => {
    const [now, then] = [fresh, committed].map((list) => list.find((p) => p.panel === name));
    if (!then) return [`FAIL inventory: ${name} is registered but has no row in ${INVENTORY}`];
    if (!now) return [`FAIL inventory: ${name} has a row in ${INVENTORY} but is no longer registered`];
    return JSON.stringify(now) === JSON.stringify(then) ? [] : [`FAIL inventory: ${name}'s row differs from the app: ${JSON.stringify(now)}`];
  });
  for (const line of findings) console.log(line);
  if (findings.length) console.log('  Fix: regenerate the inventory with node scripts/app-inventory.mjs and commit it');
  else console.log(`PASS inventory: ${INVENTORY} matches the app's ${fresh.length} panels`);
  process.exitCode = findings.length ? 1 : 0;
}
