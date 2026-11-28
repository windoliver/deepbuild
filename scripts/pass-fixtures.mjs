import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripRust } from './rust-source.mjs';

const TWO_CRATES = ['crates/deep-effects-render', 'crates/deep-gpu-layer'];
const TABLE = 'crates/deep-gpu-layer/fixtures/passes.json';
const FIXTURES = 'crates/deep-gpu-layer/src/passes/';
const ENTRY_POINT = /@(?:vertex|fragment|compute)(?:\s+@workgroup_size\([^)]*\))?\s+fn\s/;
const FIX = `Fix: give the pass a row in ${TABLE} with its analytic fixture (expected values written by hand) and its planted twin, run by deep-gpu's pass_fixture call; a scene pass names its oracle under "oracles"`;

const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
  console.log('BLOCKED pass-fixtures: --root takes a folder\n  Fix: node scripts/pass-fixtures.mjs [--root <checkout>]');
  process.exit(2);
}
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];
const posix = (path) => relative(root, path).split(sep).join('/');

const walk = (dir, keep) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === 'target' || name === 'node_modules' || name.startsWith('.')) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path, keep) : keep(name) ? [posix(path)] : [];
  });
};

const ESCAPES = { n: '\n', t: '\t', r: '\r', '0': '\0', '\\': '\\', '"': '"', "'": "'" };
const decode = (literal) => {
  const raw = /^b?r(#*)"/.exec(literal);
  if (raw) return literal.slice(raw[0].length, literal.length - 1 - raw[1].length);
  const body = literal.slice(literal.indexOf('"') + 1, -1);
  return body.replace(/\\\n\s*/g, '').replace(/\\(.)/g, (_, c) => ESCAPES[c] ?? c);
};
const holdsWgsl = (path) => {
  const text = readFileSync(join(root, path), 'utf8');
  if (!/@(?:vertex|fragment|compute)/.test(text)) return false;
  const literals = [];
  stripRust(text, { keepComments: true, literals });
  return literals.some(([start, end]) => ENTRY_POINT.test(decode(text.slice(start, end))));
};

const passes = [
  ...TWO_CRATES.flatMap((crate) => walk(join(root, crate), (name) => name.endsWith('.wgsl'))),
  ...walk(join(root, 'crates'), (name) => name.endsWith('.rs')).filter((path) => !path.startsWith(FIXTURES) && holdsWgsl(path)),
].sort();

let table;
try {
  table = JSON.parse(readFileSync(join(root, TABLE), 'utf8'));
} catch (e) {
  console.log(`BLOCKED pass-fixtures: ${TABLE} can't be read: ${e.message}\n  ${FIX}`);
  process.exit(2);
}
const rows = table.passes ?? [];
const oracles = new Map((table.oracles ?? []).map((o) => [o.file, o.oracle]));

const findings = [];
const fail = (file, why) => findings.push(`FAIL pass-fixtures: ${file}: ${why}`);
for (const file of passes) {
  const own = rows.filter((r) => r.file === file);
  if (oracles.has(file)) {
    if (own.length) fail(file, 'is both a fixture row and a scene pass with its own oracle');
    else if (typeof oracles.get(file) !== 'string' || !oracles.get(file).trim()) fail(file, 'is a scene pass that names no oracle');
    continue;
  }
  if (!own.length) {
    fail(file, 'holds a WGSL pass with no analytic fixture and no planted twin');
    continue;
  }
  for (const r of own) {
    if (!r.pass || !r.twin) fail(file, `row ${r.pass ?? '?'} names no pass or no planted twin`);
    else if (r.fixture !== `crates/deep-gpu-layer/fixtures/passes/${r.pass}.json` || !existsSync(join(root, r.fixture))) fail(file, `pass ${r.pass}: its analytic fixture ${r.fixture} is not crates/deep-gpu-layer/fixtures/passes/${r.pass}.json in the checkout`);
    const shared = rows.find((o) => o.file !== file && o.twin === r.twin);
    if (shared) fail(file, `pass ${r.pass}: its planted twin ${r.twin} is also ${shared.file}'s`);
  }
}
const found = new Set(passes);
for (const file of new Set([...rows.map((r) => r.file), ...oracles.keys()])) {
  if (!found.has(file)) fail(file, `is named in ${TABLE} but holds no WGSL pass the lane finds`);
}
const names = rows.map((r) => r.pass);
for (const name of new Set(names.filter((n, i) => names.indexOf(n) !== i))) fail(rows.find((r) => r.pass === name).file, `pass ${name} has more than one row`);

if (findings.length) {
  for (const line of findings) console.log(line);
  console.log(`  ${FIX}`);
  process.exit(1);
}
console.log(`PASS pass-fixtures: ${passes.length} files hold WGSL passes, ${rows.length} with analytic fixtures and planted twins, ${oracles.size} scene passes with their own oracles`);
