#!/usr/bin/env node
// The canvas closure rule (#200, #2777; canvas primitives: Registry and seal: registries, Registries and closed lists):
// every list the canvas documents is a registry, closed with its reason, what would reopen it and what a document can
// do instead, or open, declared per item or pack.
//   node scripts/canvas-closures.mjs closures [--root <tree>]
//     Every enum in <tree>/packages/contracts/canvas-schemas/*.json carries an x-closure: {registry: name@major}, which
//     <tree>/packages/contracts/canvas-registries.json declares; {closed: <reason>, reopens_if, mark: exhaustive |
//     extensible}, an extensible list holding `unknown`; or {open: item | pack}.
//   node scripts/canvas-closures.mjs fields [--listing <dump>] [--base <dump>]
//     Every field list of the sealed listing (`field_lists` of a `deep-show kinds --dump` file, or of the dump of the
//     full deep-show built in this checkout's target folder) carries a closure: {registry} naming a registry the listing
//     holds, {closed: <reason>, reopens_if, instead: <text> | nothing} or {open: item | pack}. Prints one reading a run:
//     the closed lists whose instead is nothing, and which this change added, against --base or, without it, the
//     merge base's crates/deep-canvas/src/registry/fields.json. The reading is never a verdict.
//   node scripts/canvas-closures.mjs drift [--root <tree>] [--listing <dump> | --built]
//     The hand-written table under "Registries and closed lists" in <tree>/docs/canvas-primitives.md says for each list
//     the closures and the instead <tree>/packages/contracts/canvas-closures.json holds, and lists every list that file
//     holds; the generated tables after it, one under a heading for each group of field lists and read as one table,
//     say for each field list its words, closure, reopens_if and instead, as the
//     listing (--listing, or with --built the dump of the built deep-show) gives them, or without one the closures the
//     fill <tree>/crates/deep-canvas/src/registry/fields.json holds (this checkout's, for a tree that holds none).
//   node scripts/canvas-closures.mjs table [--root <tree>] [--listing <dump>]
//     Writes the generated tables into <tree>/docs/canvas-primitives.md from the listing (or the built deep-show's):
//     a field list's group is its name before its first `.` or `@`, so a new list changes one small heading's own text
//     and the section's own text stays its hand-written part (#3401; scripts/doc-ceilings.mjs).
//   node scripts/canvas-closures.mjs paths [--root <tree>]
//     The paths lane (#2776; canvas primitives: Paths: rays, finals and the web player): every holder of answers in
//     <tree>/packages/contracts/canvas-paths.json, the sealed listing (each 3D entry the full build seals, and each
//     field of one that carries its own answers), has a line in its section's Paths row in
//     <tree>/docs/canvas-primitives.md saying the listing's answer for rays, a final and the web player; a row holds
//     no line the listing doesn't give that section; and every `same` is held by a check kind or a fixture the
//     listing names. Prints each `same` with what holds it and, per path, how many holders answer with each word.
//     It reads those two files and nothing else.
// Output: `PASS <command>: ...`, `FAIL <command>: <list>: <why>`, `NOTE fields: ...`; exit 0, 1, or 3 when blocked.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const REASONS = ['ring', 'record', 'determinism', 'card', 'budget', 'interval_forms', 'draw_path'];
const NOTHING = 'nothing';
/** The core's closures of its field lists, one line a list (#2777). */
const FILL = 'crates/deep-canvas/src/registry/fields.json';
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

// ---------------------------------------------------------------------------------------------------------------------
// The sealed listing's field lists (#2777).

/**
 * The listing named by --listing, or with `built` the dump of the full deep-show built in this checkout's target folder
 * (CARGO_TARGET_DIR honored): `{dump}`, `{refused}` when that deep-show's seal refuses, or null when there is none.
 */
function listingOf({ built }) {
  const named = flag('--listing');
  if (named) return existsSync(named) ? { from: named, dump: JSON.parse(readFileSync(named, 'utf8')) } : null;
  if (!built) return null;
  const show = join(process.env.CARGO_TARGET_DIR ? resolve(REPO, process.env.CARGO_TARGET_DIR) : join(REPO, 'target'), 'debug', 'deep-show');
  if (!existsSync(show)) return null;
  const dir = mkdtempSync(join(tmpdir(), 'deep-field-lists-'));
  try {
    try {
      execFileSync(show, ['kinds', '--dump', dir], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
    } catch (e) {
      return { from: show, refused: `${e.stdout ?? ''}${e.stderr ?? ''}`.trim().slice(0, 2000) || e.message };
    }
    const file = readdirSync(dir).find((f) => f.endsWith('.json'));
    return file ? { from: show, dump: JSON.parse(readFileSync(join(dir, file), 'utf8')) } : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const fieldLists = (dump) => (Array.isArray(dump?.field_lists) ? dump.field_lists.filter(isObj) : []);
const kindOf = (c) => (isObj(c) ? ['registry', 'closed', 'open'].filter((k) => k in c) : []);

/** Why a field list's closure breaks the rule, or ''. */
function fieldProblem(closure, registries) {
  const kinds = kindOf(closure);
  if (kinds.length !== 1) return closure === undefined ? 'a field list with no closure: a registry, closed with its reason, what reopens it and instead, or open' : `a closure is {registry}, {closed, reopens_if, instead} or {open}, not ${JSON.stringify(closure)}`;
  if (kinds[0] === 'registry') return registries.has(closure.registry) ? '' : `it names the registry ${closure.registry}, which the sealed listing doesn't hold`;
  if (kinds[0] === 'open') return ['item', 'pack'].includes(closure.open) ? '' : 'an open list is declared per item or per pack';
  if (!REASONS.includes(closure.closed)) return `closed with ${JSON.stringify(closure.closed)}, not one of ${REASONS.join(', ')}`;
  if (typeof closure.reopens_if !== 'string' || !closure.reopens_if.trim()) return 'a closed list says what would reopen it (reopens_if)';
  if (typeof closure.instead !== 'string' || !closure.instead.trim()) return `a closed list says what a document can do in its place, or ${NOTHING} (instead)`;
  return '';
}
const saysNothing = (lists) => lists.filter((l) => isObj(l.closure) && 'closed' in l.closure && l.closure.instead === NOTHING).map((l) => l.list).sort();

/** The lists saying instead: nothing before this change: --base's, or the merge base's fill (none before it existed). */
function baseNothing() {
  const named = flag('--base');
  if (named) return existsSync(named) ? new Set(saysNothing(fieldLists(JSON.parse(readFileSync(named, 'utf8'))))) : null;
  const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let base;
  try {
    base = git('merge-base', 'HEAD', 'origin/main').trim();
  } catch {
    return null;
  }
  let fill = [];
  try {
    fill = JSON.parse(git('show', `${base}:${FILL}`));
  } catch {}
  return new Set(fill.filter((r) => 'closed' in r && r.instead === NOTHING).map((r) => r.list));
}

function fields() {
  const listing = listingOf({ built: true });
  if (!listing) {
    console.log('BLOCKED fields: no sealed listing: build deep-show (cargo build --locked --bin deep-show) or name a dump with --listing');
    return 3;
  }
  if (listing.refused) {
    console.log(`FAIL fields: the sealed listing: ${listing.from} kinds --dump is refused: ${listing.refused}`);
    return 1;
  }
  const { dump } = listing;
  const registries = new Set((dump.registries ?? []).map((r) => r.name));
  const lists = fieldLists(dump);
  const failed = [];
  if (!Array.isArray(dump.field_lists)) failed.push('the sealed listing: it holds no field lists (field_lists)');
  const seen = new Map();
  for (const l of lists) seen.set(l.list, (seen.get(l.list) ?? 0) + 1);
  for (const [name, n] of seen) if (n > 1) failed.push(`${name}: the sealed listing names ${n} field lists so`);
  for (const l of lists) {
    if (!Array.isArray(l.words) || !l.words.length) failed.push(`${l.list}: the sealed listing gives it no words`);
    const why = fieldProblem(l.closure, registries);
    if (why) failed.push(`${l.list}: ${why}`);
  }
  for (const f of failed) console.log(`FAIL fields: ${f}`);
  const by = (k) => lists.filter((l) => kindOf(l.closure)[0] === k).length;
  if (!failed.length) console.log(`PASS fields: ${lists.length} field lists in the sealed listing, each with a closure: ${by('registry')} registry, ${by('closed')} closed, ${by('open')} open`);
  // The reading, one a run: never a verdict.
  const nothing = saysNothing(lists);
  // With no base to read against, every one is the change's.
  const base = baseNothing() ?? new Set();
  const added = nothing.filter((n) => !base.has(n));
  const named = (xs) => (xs.length ? xs.join(', ') : 'none');
  console.log(`NOTE fields: ${nothing.length} closed ${nothing.length === 1 ? 'list says' : 'lists say'} instead: nothing: ${named(nothing)}; added by this change: ${named(added)}`);
  return failed.length ? 1 : 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// The reference's tables: the hand-written one and the generated block after it.

const SECTION = '### Registries and closed lists';
const BLOCK_START = '<!-- field lists:';
const BLOCK_END = '<!-- /field lists -->';
const GENERATED_HEADER = '| Field list | Words | Closure | Reopens if | Instead |';
const NONE_CELL = '—';
/** A table row's cells: split on unescaped pipes, each trimmed, `\|` read as `|`. */
const cellsOf = (line) => line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim().replace(/\\\|/g, '|'));
const cell = (text) => text.replace(/\|/g, '\\|');
const unquote = (s) => s.trim().replace(/^`|`$/g, '').trim();

/** The section's lines: its heading's index and the index of the next heading at levels 1 to 3. */
function sectionOf(lines) {
  const start = lines.findIndex((l) => l.trim() === SECTION);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^#{1,3} /.test(lines[i])) { end = i; break; }
  return { start, end };
}
/** The generated block in the section: its marker lines, or null. */
function blockOf(lines, s) {
  const from = lines.findIndex((l, i) => i > s.start && i < s.end && l.trim().startsWith(BLOCK_START));
  if (from < 0) return null;
  const to = lines.findIndex((l, i) => i > from && i < s.end && l.trim() === BLOCK_END);
  return to < 0 ? { from, to: -1 } : { from, to };
}

/** A closure as a closure cell writes it. */
const closureCell = (c) => (!isObj(c) ? '' : 'registry' in c ? `registry ${c.registry}` : 'closed' in c ? `closed: ${c.closed}` : 'open' in c ? `open: ${c.open}` : '');
/** One field list's row of the generated table. */
function rowOf(l) {
  const c = isObj(l.closure) ? l.closure : {};
  const closed = 'closed' in c;
  return `| \`${l.list}\` | ${l.words.map((w) => `\`${w}\``).join(', ')} | ${closureCell(c)} | ${closed ? cell(c.reopens_if) : NONE_CELL} | ${closed ? cell(c.instead) : NONE_CELL} |`;
}
/** A field list's group, read from its name alone: the name before its first `.` or `@`. */
const groupOf = (name) => name.split(/[.@]/)[0];
/** The heading a group's table sits under. */
const groupHeading = (group) => `#### Field lists: \`${group}\``;
/** The generated block's lines: a table for each group under its heading, rows in name order, a group where its first row falls. */
function blockLines(lists) {
  const groups = new Map();
  for (const l of [...lists].sort((a, b) => (a.list < b.list ? -1 : a.list > b.list ? 1 : 0))) {
    const group = groupOf(l.list);
    groups.set(group, [...(groups.get(group) ?? []), rowOf(l)]);
  }
  return [
    `${BLOCK_START} generated from the sealed listing by node scripts/canvas-closures.mjs table; do not edit -->`,
    '',
    ...[...groups].flatMap(([group, rows]) => [groupHeading(group), '', GENERATED_HEADER, '|---|---|---|---|---|', ...rows, '']),
    BLOCK_END,
  ];
}

/** A closure cell of the hand-written table, as the closures it names. */
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

/** The hand-written table against canvas-closures.json: each row's closures and its instead. */
function handDrift(lines, s, block, failed) {
  const rows = [];
  const last = block ? block.from : s.end;
  for (const l of lines.slice(s.start + 1, last)) {
    if (!l.startsWith('| ') || l.startsWith('| List |') || l.startsWith('|---')) continue;
    const cells = l.split(' | ').map((c) => c.replace(/^\| ?| ?\|$/g, '').trim());
    rows.push({ list: cells[0], closures: cellClosures(cells[2] ?? ''), instead: cells[4] ?? '' });
  }
  const data = readJson(at('packages/contracts/canvas-closures.json'), []);
  if (!rows.length) failed.push('the canvas reference has no table under "Registries and closed lists"');
  for (const row of rows) {
    const held = data.find((d) => d.list === row.list);
    if (!held) { failed.push(`${row.list}: the table lists it with ${row.closures.join(' and ') || 'no closure'}, and the closure data holds no such list`); continue; }
    const want = held.closures.map(dataClosure).sort();
    if (JSON.stringify(want) !== JSON.stringify(row.closures)) failed.push(`${row.list}: the table says ${row.closures.join(' and ') || 'nothing'}, the closure data says ${want.join(' and ')}`);
    const closed = held.closures.find((c) => 'closed' in c);
    if (closed && typeof closed.instead !== 'string') failed.push(`${row.list}: the closure data closes it with no instead (a text, or ${NOTHING})`);
    const instead = closed?.instead ?? NONE_CELL;
    if (row.instead !== instead) failed.push(`${row.list}: the table says instead ${JSON.stringify(row.instead)}, the closure data says ${JSON.stringify(instead)}`);
  }
  for (const d of data) if (!rows.some((r) => r.list === d.list)) failed.push(`${d.list}: the closure data holds it, and the table doesn't list it`);
  return rows.length;
}

/** The generated tables, read as one, against the field lists (words checked when they come from a listing). */
function generatedDrift(lines, block, lists, from, failed) {
  if (!block) { failed.push(`the canvas reference has no generated table (${BLOCK_START} … ${BLOCK_END}) after the hand-written one`); return 0; }
  if (block.to < 0) { failed.push(`the generated table has no end line ${BLOCK_END}`); return 0; }
  const header = lines.findIndex((l, i) => i > block.from && i < block.to && l.startsWith('| '));
  if (header < 0 || lines[header].trim() !== GENERATED_HEADER) { failed.push(`the generated table doesn't start with the header ${GENERATED_HEADER}`); return 0; }
  const rows = [];
  for (const l of lines.slice(header + 1, block.to)) {
    if (!l.startsWith('| ') || /^\|\s*-/.test(l) || l.trim() === GENERATED_HEADER) continue;
    const c = cellsOf(l);
    rows.push({ list: unquote(c[0] ?? ''), words: (c[1] ?? '').split(',').map(unquote).filter(Boolean), closure: c[2] ?? '', reopens: c[3] ?? '', instead: c[4] ?? '' });
  }
  const byName = new Map(lists.map((l) => [l.list, l]));
  const counted = new Map();
  for (const r of rows) counted.set(r.list, (counted.get(r.list) ?? 0) + 1);
  for (const [name, n] of counted) if (n > 1) failed.push(`${name}: the generated table has ${n} rows for it`);
  for (const r of rows) {
    const l = byName.get(r.list);
    if (!l) { failed.push(`${r.list}: the generated table has a row for it, and ${from} holds no such field list`); continue; }
    const c = isObj(l.closure) ? l.closure : {};
    const closed = 'closed' in c;
    if (r.closure !== closureCell(c)) failed.push(`${r.list}: the generated table says ${r.closure || 'no closure'}, ${from} says ${closureCell(c) || 'none'}`);
    if (r.reopens !== (closed ? c.reopens_if : NONE_CELL)) failed.push(`${r.list}: the generated table says it reopens if ${JSON.stringify(r.reopens)}, ${from} says ${JSON.stringify(closed ? c.reopens_if : NONE_CELL)}`);
    if (r.instead !== (closed ? c.instead : NONE_CELL)) failed.push(`${r.list}: the generated table says instead ${JSON.stringify(r.instead)}, ${from} says ${JSON.stringify(closed ? c.instead : NONE_CELL)}`);
    if (Array.isArray(l.words) && JSON.stringify(r.words) !== JSON.stringify(l.words)) failed.push(`${r.list}: the generated table gives the words ${r.words.join(', ')}, ${from} gives ${l.words.join(', ')}`);
  }
  for (const l of lists) if (!counted.has(l.list)) failed.push(`${l.list}: ${from} holds it, and the generated table has no row for it`);
  return rows.length;
}

function drift() {
  const docPath = at('docs/canvas-primitives.md');
  const dataPath = at('packages/contracts/canvas-closures.json');
  if (!existsSync(docPath) || !existsSync(dataPath)) {
    console.log(`BLOCKED drift: ${existsSync(docPath) ? dataPath : docPath} is missing`);
    return 3;
  }
  // The field lists the generated table is held to: a listing's, or the fill's closures.
  let lists;
  let from;
  const listing = listingOf({ built: rest.includes('--built') });
  if (listing?.dump) {
    lists = fieldLists(listing.dump);
    from = 'the sealed listing';
  } else if (listing?.refused || flag('--listing') || rest.includes('--built')) {
    console.log(`BLOCKED drift: no sealed listing to hold the generated table to${listing?.refused ? `: ${listing.refused}` : ''}`);
    return 3;
  } else {
    // The tree's fill, or this checkout's for a tree that holds none.
    const fill = [at(FILL), join(REPO, FILL)].find(existsSync);
    lists = readJson(fill, []).map(({ list, ...closure }) => ({ list, closure }));
    from = `the fill (${FILL})`;
  }
  const lines = readFileSync(docPath, 'utf8').split('\n');
  const s = sectionOf(lines);
  const failed = [];
  if (!s) {
    failed.push('the canvas reference has no table under "Registries and closed lists"');
  } else {
    const block = blockOf(lines, s);
    const hand = handDrift(lines, s, block, failed);
    const generated = generatedDrift(lines, block, lists, from, failed);
    if (!failed.length) console.log(`PASS drift: the table's ${hand} lists say the closures the closure data holds, and the generated tables' ${generated} field lists say what ${from} holds`);
  }
  for (const f of failed) console.log(`FAIL drift: ${f}`);
  return failed.length ? 1 : 0;
}

/** Writes the generated block into the reference, after the hand-written table, from the listing. */
function table() {
  const listing = listingOf({ built: true });
  if (!listing?.dump) {
    console.log(`BLOCKED table: no sealed listing${listing?.refused ? `: ${listing.refused}` : ': build deep-show or name a dump with --listing'}`);
    return 3;
  }
  const docPath = at('docs/canvas-primitives.md');
  const lines = readFileSync(docPath, 'utf8').split('\n');
  const s = sectionOf(lines);
  if (!s) { console.log(`BLOCKED table: ${docPath} has no heading ${SECTION}`); return 3; }
  const lists = fieldLists(listing.dump);
  const fresh = blockLines(lists);
  const block = blockOf(lines, s);
  if (block && block.to >= 0) lines.splice(block.from, block.to - block.from + 1, ...fresh);
  else {
    // After the hand-written table: the last table row before the section's end.
    let last = s.start;
    for (let i = s.start + 1; i < s.end; i++) if (lines[i].startsWith('|')) last = i;
    lines.splice(last + 1, 0, '', ...fresh);
  }
  writeFileSync(docPath, lines.join('\n'));
  console.log(`PASS table: ${lists.length} field lists written to ${docPath}`);
  return 0;
}

const PATHS = ['rays', 'final', 'web'];
const WORDS = ['same', 'stand_in', 'refused', 'not_applicable'];
/** A holder's name in a Paths row: `<entry>[.<field>]`, `<registry>/` before an entry of a registry but kind@1. */
const holderName = (h) => `${h.registry === 'kind@1' ? '' : `${h.registry}/`}${h.entry}${h.field ? `.${h.field}` : ''}`;
/** One answer cell, as JSON tagged by `answer`, or null when it can't be read. */
function cellAnswer(text) {
  const cell = text.trim();
  let m;
  if ((m = /^`same`(?:, held by `([^`]+)`)?$/.exec(cell))) return m[1] ? { answer: 'same', held_by: m[1] } : { answer: 'same' };
  if ((m = /^`refused` `([^`]+)`(?: \((#\d+)\))?$/.exec(cell))) return m[2] ? { answer: 'refused', code: m[1], task: m[2] } : { answer: 'refused', code: m[1] };
  if ((m = /^`not_applicable`: (.+)$/.exec(cell))) return { answer: 'not_applicable', why: m[1] };
  if ((m = /^`stand_in`: (.+)$/.exec(cell)) && m[1].endsWith(')')) {
    const at = m[1].lastIndexOf(' (receipt: ');
    if (at > 0) return { answer: 'stand_in', draws: m[1].slice(0, at), receipt: m[1].slice(at + ' (receipt: '.length, -1) };
  }
  return null;
}
/** Each section of the reference with a Paths row: heading text → {lines: Map(holder → cells)}, or null with no row. */
function pathsRows(text) {
  const lines = text.split('\n');
  const rows = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#### ')) continue;
    const section = lines[i].slice(5).trimEnd();
    let end = i + 1;
    while (end < lines.length && !/^#{1,4} /.test(lines[end])) end++;
    const label = lines.slice(i + 1, end).findIndex((l) => l.trim() === '**Paths**');
    let row = null;
    if (label >= 0) {
      row = { lines: new Map(), unread: [] };
      let k = i + 1 + label + 1;
      while (k < end && lines[k].trim() === '') k++;
      const table = [];
      while (k < end && lines[k].trim().startsWith('|')) table.push(lines[k++].trim());
      const cells = (l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
      if (table[0] !== '| Entry | rays | final | web |' || !/^\|(?:\s*-+\s*\|){4}$/.test(table[1] ?? '')) row.unread.push('the Paths row is not a table headed | Entry | rays | final | web |');
      for (const l of table.slice(2)) {
        const c = cells(l);
        const name = /^`([^`]+)`$/.exec(c[0] ?? '')?.[1];
        if (!name || c.length !== 4) row.unread.push(`the line ${l} names no holder in one code span, with three answers`);
        else row.lines.set(name, c.slice(1));
      }
    }
    rows.set(section, row);
    i = end - 1;
  }
  return rows;
}
const sameAnswer = (a, b) => {
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  return [...keys].every((k) => a?.[k] === b?.[k]);
};
const shownAnswer = (a) => (a ? JSON.stringify(a) : 'nothing');

function paths() {
  const docPath = at('docs/canvas-primitives.md');
  const dataPath = at('packages/contracts/canvas-paths.json');
  for (const p of [docPath, dataPath]) {
    if (!existsSync(p)) {
      console.log(`BLOCKED paths: ${p} is missing`);
      return 3;
    }
  }
  const listing = JSON.parse(readFileSync(dataPath, 'utf8'));
  const rows = pathsRows(readFileSync(docPath, 'utf8'));
  const holders = Array.isArray(listing.entries) ? listing.entries : [];
  const holds = new Set([...(listing.checks ?? []), ...(listing.fixtures ?? [])]);
  const failed = [];
  const fail = (...parts) => failed.push(parts.join(': '));
  const given = new Map();
  for (const h of holders) {
    const name = holderName(h);
    if (!given.has(h.section)) given.set(h.section, new Set());
    given.get(h.section).add(name);
    for (const p of PATHS) {
      const a = h.paths?.[p];
      if (a?.answer === 'same' && !holds.has(a.held_by)) {
        fail(h.section, name, p, a.held_by ? `same, held by ${a.held_by}, which is no check kind or fixture the sealed listing names` : 'same, with nothing named that holds it');
      }
    }
    if (!rows.has(h.section)) { fail(h.section, name, 'the reference has no section of this heading'); continue; }
    const row = rows.get(h.section);
    if (!row) { fail(h.section, `${name} draws in 3D and the section has no Paths row`); continue; }
    const cells = row.lines.get(name);
    if (!cells) { fail(h.section, name, 'the section\'s Paths row has no line for it'); continue; }
    PATHS.forEach((p, k) => {
      const said = cellAnswer(cells[k]);
      if (!said) fail(h.section, name, p, `the cell ${cells[k]} can't be read as same, stand_in, refused or not_applicable`);
      else if (!sameAnswer(said, h.paths?.[p])) fail(h.section, name, p, `the row says ${shownAnswer(said)}, the sealed listing ${shownAnswer(h.paths?.[p])}`);
    });
  }
  for (const [section, row] of rows) {
    if (!row) continue;
    for (const why of row.unread) fail(section, why);
    for (const name of row.lines.keys()) {
      if (!given.get(section)?.has(name)) fail(section, name, 'a line the sealed listing doesn\'t give this section');
    }
  }
  for (const h of holders) {
    for (const p of PATHS) {
      const a = h.paths?.[p];
      if (a?.answer === 'same' && holds.has(a.held_by)) console.log(`same paths: ${p}: ${holderName(h)}: held by ${a.held_by}`);
    }
  }
  for (const p of PATHS) {
    const n = Object.fromEntries(WORDS.map((w) => [w, holders.filter((h) => h.paths?.[p]?.answer === w).length]));
    const undefinedRefusals = holders.filter((h) => h.paths?.[p]?.answer === 'refused' && h.paths[p].code === 'path_undefined').length;
    console.log(`count paths: ${p}: same ${n.same}, stand_in ${n.stand_in}, refused ${n.refused} (path_undefined ${undefinedRefusals}), not_applicable ${n.not_applicable}`);
  }
  for (const f of failed) console.log(`FAIL paths: ${f}`);
  if (!failed.length) console.log(`PASS paths: the reference's Paths rows say what the sealed listing holds for its ${holders.length} holders, each in its section, and every same is held`);
  return failed.length ? 1 : 0;
}

if (command === 'closures') process.exitCode = closures();
else if (command === 'drift') process.exitCode = drift();
else if (command === 'fields') process.exitCode = fields();
else if (command === 'table') process.exitCode = table();
else if (command === 'paths') process.exitCode = paths();
else {
  console.log('BLOCKED closures: usage: canvas-closures.mjs closures|drift|fields|table|paths [--root <tree>] [--listing <dump>] [--base <dump>] [--built]');
  process.exitCode = 3;
}
