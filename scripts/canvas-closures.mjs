#!/usr/bin/env node
// The canvas closure rule (#200; canvas primitives: Registry and seal: registries, Registries and closed lists): every
// list the canvas documents is a registry, closed with its reason and what would reopen it, or open, declared per item
// or pack.
//   node scripts/canvas-closures.mjs closures [--root <tree>]
//     Every enum in <tree>/packages/contracts/canvas-schemas/*.json carries an x-closure: {registry: name@major}, which
//     <tree>/packages/contracts/canvas-registries.json declares; {closed: <reason>, reopens_if, mark: exhaustive |
//     extensible}, an extensible list holding `unknown`; or {open: item | pack}.
//   node scripts/canvas-closures.mjs drift [--root <tree>]
//     The table under "Registries and closed lists" in <tree>/docs/canvas-primitives.md says for each list the closure
//     <tree>/packages/contracts/canvas-closures.json holds, and lists every list that file holds.
// Output: `PASS closures: ...` or `FAIL closures: <list>: <why>` (and `drift`); exit 0, 1, or 3 when blocked.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const REASONS = ['ring', 'record', 'determinism', 'card', 'budget', 'interval_forms', 'draw_path'];
const [command, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i < 0 ? undefined : rest[i + 1]; };
const root = resolve(flag('--root') ?? REPO);
const at = (...parts) => join(root, ...parts);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);

/** Every enum in a schema, with the property path that names its list. */
function enums(node, path, out) {
  if (Array.isArray(node)) node.forEach((n, i) => enums(n, `${path}[${i}]`, out));
  else if (isObj(node)) {
    if (Array.isArray(node.enum)) out.push({ path: path || '(root)', node });
    for (const [k, v] of Object.entries(node)) {
      if (k === 'enum' || k === 'x-closure') continue;
      enums(v, k === 'properties' || k === '$defs' ? path : path ? `${path}.${k}` : k, out);
    }
  }
  return out;
}
// A list is named by its property: a path's last segment past the schema's keywords.
const listName = (path) => path.split('.').filter((p) => !['items', 'oneOf', 'anyOf'].includes(p)).pop() ?? path;

/** Why a list's closure breaks the rule, or ''. */
function closureProblem(node, registries) {
  const c = node['x-closure'];
  if (c === undefined) return 'an enum with no closure: a registry, closed with its reason, what reopens it and its mark, or open';
  if (!isObj(c)) return 'x-closure is {registry}, {closed, reopens_if, mark} or {open}';
  if ('registry' in c) {
    if (typeof c.registry !== 'string' || !/^[a-z][a-z0-9._]*@[1-9][0-9]*$/.test(c.registry)) return 'a registry closure names the registry, <name>@<major>';
    if (!registries.has(c.registry)) return `it names the registry ${c.registry}, which canvas-registries.json doesn't declare`;
    return '';
  }
  if ('open' in c) return ['item', 'pack'].includes(c.open) ? '' : 'an open list is declared per item or per pack';
  if (!REASONS.includes(c.closed)) return `closed with ${JSON.stringify(c.closed)}, not one of ${REASONS.join(', ')}`;
  if (typeof c.reopens_if !== 'string' || !c.reopens_if) return 'a closed list says what would reopen it (reopens_if)';
  if (c.mark !== 'exhaustive' && c.mark !== 'extensible') return 'a closed list says whether it is exhaustive or extensible (mark)';
  if (c.mark === 'extensible' && !node.enum.includes('unknown')) return 'an extensible list holds unknown, which a reader at an earlier minor maps a new value to';
  return '';
}

function closures() {
  const dir = at('packages/contracts/canvas-schemas');
  const registries = new Set(readJson(at('packages/contracts/canvas-registries.json'), []).map((r) => r.registry));
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
  const failed = [];
  let count = 0;
  for (const file of files) {
    const schema = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    for (const { path, node } of enums(schema, '', [])) {
      count++;
      const why = closureProblem(node, registries);
      if (why) failed.push(`${listName(path)}: ${why} (${file.slice(0, -5)} ${path})`);
    }
  }
  for (const f of failed) console.log(`FAIL closures: ${f}`);
  if (!failed.length) console.log(`PASS closures: ${count} lists in ${files.length} canvas schemas each carry a closure`);
  return failed.length ? 1 : 0;
}

/** A closure cell of the reference's table, as the closures it names. */
function cellClosures(cell) {
  const out = new Set();
  for (const m of cell.matchAll(/hub slot\s*(`([^`]+)`)?/g)) out.add(`slot ${m[2] ?? ''}`.trim());
  for (const m of cell.matchAll(/registr(?:y|ies)\s+((?:`[^`]+`[^`]*?)+?)(?=,? (?:declared|filled|each)|;|$)/g)) {
    for (const n of m[1].matchAll(/`([a-z][a-z0-9._]*@[0-9]+)`/g)) out.add(`registry ${n[1]}`);
  }
  for (const m of cell.matchAll(/closed:\s*([a-z][a-z ]*?)(?=\s*(?:$|[;,.(]|each\b))/g)) out.add(`closed: ${m[1].trim().replace(/ /g, '_')}`);
  for (const m of cell.matchAll(/open:\s*declared per (?:[a-z]+ )?(item|pack)/g)) out.add(`open: ${m[1]}`);
  return [...out].sort();
}
/** A closure as the closure data holds it: {registry}, {closed}, {open} or {slot}. */
const dataClosure = (c) => ('registry' in c ? `registry ${c.registry}` : 'closed' in c ? `closed: ${c.closed}` : 'open' in c ? `open: ${c.open}` : `slot ${c.slot ?? ''}`.trim());

function drift() {
  const docPath = at('docs/canvas-primitives.md');
  const dataPath = at('packages/contracts/canvas-closures.json');
  if (!existsSync(docPath) || !existsSync(dataPath)) {
    console.log(`BLOCKED drift: ${existsSync(docPath) ? dataPath : docPath} is missing`);
    return 3;
  }
  const lines = readFileSync(docPath, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.trim() === '### Registries and closed lists');
  const rows = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,3} /.test(l)) break;
    if (!l.startsWith('| ') || l.startsWith('| List |') || l.startsWith('|---')) continue;
    const cells = l.split(' | ').map((c) => c.replace(/^\| ?| ?\|$/g, '').trim());
    rows.push({ list: cells[0], closures: cellClosures(cells[2] ?? '') });
  }
  const data = readJson(dataPath, []);
  const failed = [];
  if (start < 0 || !rows.length) failed.push('the canvas reference has no table under "Registries and closed lists"');
  for (const row of rows) {
    const held = data.find((d) => d.list === row.list);
    if (!held) { failed.push(`${row.list}: the table lists it with ${row.closures.join(' and ') || 'no closure'}, and the closure data holds no such list`); continue; }
    const want = held.closures.map(dataClosure).sort();
    if (JSON.stringify(want) !== JSON.stringify(row.closures)) failed.push(`${row.list}: the table says ${row.closures.join(' and ') || 'nothing'}, the closure data says ${want.join(' and ')}`);
  }
  for (const d of data) if (!rows.some((r) => r.list === d.list)) failed.push(`${d.list}: the closure data holds it, and the table doesn't list it`);
  for (const f of failed) console.log(`FAIL drift: ${f}`);
  if (!failed.length) console.log(`PASS drift: the table's ${rows.length} lists say the closures the closure data holds`);
  return failed.length ? 1 : 0;
}

if (command === 'closures') process.exitCode = closures();
else if (command === 'drift') process.exitCode = drift();
else {
  console.log('BLOCKED closures: usage: canvas-closures.mjs closures|drift [--root <tree>]');
  process.exitCode = 3;
}
