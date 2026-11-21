// Test-side tools for the #194 acceptance tests (README: The surface under test). They build the probe `deep-catalog`
// on this Mac and, through Docker, for Linux x86_64; write this suite's tables as CSV or JSON lines files and pack them
// with `deep-catalog pack`; read packed bytes by table.layout@1's documented layout (crates/deep-canvas-sandbox/src/
// layouts.rs) to compare them with the fixtures; open an extension host with the catalog plug-in installed from
// packages/checks/catalog and run its kinds through `runCheck`; and load its conformance kit. Nothing here stands in for
// the probe, the plug-in, the host or the kit: every byte, hash, record, result and refusal read here is the
// implementation's own; the expected values come from the issue's text, the design and this suite's fixtures.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';
import type { CheckResult } from '../../../packages/conformance/src/index.ts';
import { GOALS, TURNS, csvText, jsonlText, messageCopy, type Cell, type ColumnSchema, type Copy, type Row, type Schema, type Tables } from './fixtures.ts';

export type Obj = { [key: string]: any };
export type { CheckResult };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/194 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH); rust-toolchain.toml picks the release. */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
const MIB = 1024 * 1024;

/** Each criterion's ID (scripts/proof-change.mjs's criterionId: `#194.` and the first 8 hex of SHA-256 of its text, white space collapsed). */
export const AC = {
  1: '#194.a290ef32', 2: '#194.55eeae36', 3: '#194.3e12aff1', 4: '#194.d88ec4fa', 5: '#194.eeff314c', 6: '#194.248f0bd0', 7: '#194.f1f3b867',
  8: '#194.d265d3bd', 9: '#194.04da1020', 10: '#194.bdc9544a', 11: '#194.60b4ab87', 12: '#194.2ec78bb6', 13: '#194.c61ec22d',
} as const;

/** Every test passes this timeout: a first build of deep-show takes long on a loaded shared machine. */
export const TIMEOUT = 3_600_000;
export const BUILD_TIMEOUT = 7_200_000;
/** A precondition that isn't the criterion (a tool, Docker, a fixture's own truth): never a pass (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };
/** A machine that can't judge the criterion: never a pass. */
export const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}; this is not a pass`); };

export const show = (v: unknown, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** `word` stands as a whole name in `text`, not inside a longer name (a dot, a bracket, a space or a quote may join it). */
export const names = (text: string, word: string | number): boolean =>
  new RegExp(`(^|[^A-Za-z0-9_])${String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z0-9_]|$)`).test(text);
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A wrong program is caught: this suite's judge fails it, and some failure names every one of `words`. */
export function failsNaming(failures: readonly string[], words: (string | number)[], what: string): void {
  expect(failures.length, `${what}: this criterion's judge fails the planted program`).toBeGreaterThan(0);
  expect(failures.some((f) => words.every((w) => names(f, w))), `${what}: a failure names ${words.join(', ')}; the failures:\n  ${failures.slice(0, 12).join('\n  ')}`).toBe(true);
}
/** JSON with every object's keys sorted, to compare two values parsed apart. */
export const canon = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

/** FNV-1a 32 over the UTF-8 bytes of `text`, as an unsigned 32-bit number: the hash table.layout@1 names IDs, columns and tables by. */
export function fnv32a(text: string): number {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(text, 'utf8')) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h >>> 0;
}
/** A u32 as the signed i32 with the same bits (a WebAssembly i32.const). */
export const i32 = (u: number): number => u | 0;

// ---------------------------------------------------------------------------------------------------
// Folders: each under the OS temp folder, deleted after the file.

const made: string[] = [];
afterAll(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
/** A fresh folder, its real path (Docker mounts it by that path), deleted after the file. */
export function scratch(tag: string): string {
  const d = realpathSync(mkdtempSync(join(tmpdir(), `dc194-${tag}-`)));
  made.push(d);
  return d;
}
/** Writes each table of `t` as `<dir>/<table>.<csv|jsonl>`; the pack call's tables. */
export function writeTables(dir: string, t: Tables, format: 'csv' | 'jsonl'): Record<string, { path: string }> {
  mkdirSync(dir, { recursive: true });
  return Object.fromEntries(Object.entries(t).map(([name, table]) => {
    const path = join(dir, `${name}.${format}`);
    writeFileSync(path, format === 'csv' ? csvText(table) : jsonlText(table));
    return [name, { path }];
  }));
}

// ---------------------------------------------------------------------------------------------------
// Builds: `cargo build --locked -p deep-catalog --bin deep-catalog`, debug or release, once per file, copied out.

function cargo(args: string[], cwd = REPO): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV } });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ENOENT') blocked(`cargo isn't on this machine (looked on PATH and in ${RUSTUP_BIN})`);
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|^warning|^\s*(\||=|-->)|^\s*\d+ \|/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
export type Profile = 'debug' | 'release';
const catalogArgs = (p: Profile): string[] => ['build', '--locked', ...(p === 'release' ? ['--release'] : []), '-p', 'deep-catalog', '--bin', 'deep-catalog'];
let binDir = '';
const built = new Map<Profile, { bin: string; error: string }>();
afterAll(() => { if (binDir) rmSync(binDir, { recursive: true, force: true }); binDir = ''; built.clear(); });
function buildCatalog(p: Profile): { bin: string; error: string } {
  const known = built.get(p);
  if (known) return known;
  if (!binDir) binDir = realpathSync(mkdtempSync(join(tmpdir(), 'dc194-bin-')));
  const bin = join(binDir, `deep-catalog-${p}`);
  const error = cargo(catalogArgs(p));
  if (error === '') copyFileSync(join(TARGET, p, 'deep-catalog'), bin);
  const out = { bin, error };
  built.set(p, out);
  return out;
}
/** Builds the probe before a file's tests (the slow part), so each test's own time is its own. */
export function prebuildCatalog(profiles: Profile[] = ['debug']): void {
  beforeAll(() => { for (const p of profiles) { try { buildCatalog(p); } catch { /* each test reports it */ } } }, BUILD_TIMEOUT);
}
/** The built probe; a test that uses a build that failed fails here, naming cargo's error. */
export function catalogBin(p: Profile = 'debug'): string {
  const out = buildCatalog(p);
  expect(out.error, `the probe builds: cargo ${catalogArgs(p).join(' ')}`).toBe('');
  return out.bin;
}

// ---------------------------------------------------------------------------------------------------
// `deep-catalog pack`: JSON lines in, one line out per line (Asset: tables: catalogs, As built).

export interface PackCall { op: 'pack'; tables: Record<string, { path: string; format?: 'csv' | 'jsonl' }>; schema: Schema; out?: string; planted?: string }
function replies(status: number | null, stdout: string, stderr: string, calls: PackCall[], what: string): Obj[] {
  expect(status, `${what} exits 0; stdout: ${stdout.slice(0, 800)}; stderr: ${stderr.slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one line out per line in; stdout: ${stdout.slice(0, 800)}`).toBe(calls.length);
  return lines.map((l, i) => {
    let v: unknown;
    try { v = JSON.parse(l); } catch { v = l; }
    expect(v !== null && typeof v === 'object' && !Array.isArray(v), `${what}: line ${i} is a JSON object: ${l.slice(0, 300)}`).toBe(true);
    return v as Obj;
  });
}
/** Runs `calls` through one `deep-catalog pack` process (the debug build unless `bin`). */
export function runPack(calls: PackCall[], bin = catalogBin()): Obj[] {
  const r = spawnSync(bin, ['pack'], { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  if ((r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') expect.fail('deep-catalog pack did not finish within its timeout');
  if (r.error && (r.error as NodeJS.ErrnoException).code !== 'EPIPE') throw Error(`deep-catalog pack: ${r.error.message}`);
  return replies(r.status, r.stdout ?? '', r.stderr ?? '', calls, 'deep-catalog pack');
}
/** A pack the probe answered `ok`: its reply's fields and the bytes it wrote to `out`. */
export interface Packed { sha256: string; size: number; ms: number; record: Obj; bytes: Buffer; reply: Obj }
export function packedOf(reply: Obj, out: string, what: string): Packed {
  expect(reply['ok'], `${what} packs (ok: true): ${show(reply)}`).toBe(true);
  expect(typeof reply['sha256'] === 'string' && /^[0-9a-f]{64}$/.test(reply['sha256']), `${what}: its sha256 is 64 hex: ${show(reply['sha256'])}`).toBe(true);
  expect(existsSync(out), `${what}: the bytes are written to out (${out})`).toBe(true);
  const bytes = readFileSync(out);
  expect(sha256(bytes), `${what}: the bytes written hash to the reply's sha256`).toBe(reply['sha256']);
  expect(reply['size'], `${what}: size is the bytes' length`).toBe(bytes.length);
  expect(typeof reply['ms'] === 'number' && reply['ms'] >= 0, `${what}: ms is the pack's own wall time: ${show(reply['ms'])}`).toBe(true);
  const record = reply['record'] as Obj;
  expect(record && typeof record === 'object', `${what}: the reply carries its record: ${show(reply)}`).toBe(true);
  expect([record['layout'], record['sha256'], record['size']], `${what}: the record names the layout, the bytes' sha256 and size`).toEqual(['table.layout@1', reply['sha256'], bytes.length]);
  return { sha256: reply['sha256'], size: bytes.length, ms: reply['ms'], record, bytes, reply };
}
let packs = 0;
/** One call per catalog: each catalog's tables written in `format` under `dir`, packed to `<dir>/<n>.bin`. */
export function packCall(dir: string, t: Tables, schema: Schema, format: 'csv' | 'jsonl' = 'csv', planted?: string): PackCall {
  const n = packs++;
  const tables = writeTables(join(dir, `tables-${n}`), t, format);
  return { op: 'pack', tables, schema, out: join(dir, `pack-${n}.bin`), ...(planted ? { planted } : {}) };
}
/** Packs each call in one process; each must answer ok. */
export function packAll(calls: PackCall[], what: string, bin?: string): Packed[] {
  return runPack(calls, bin).map((r, i) => packedOf(r, calls[i]!.out!, `${what} #${i}`));
}

// ---------------------------------------------------------------------------------------------------
// Reading packed bytes by table.layout@1's doc: a header (magic TBLE, version 1, table_count, pool_at, pool_count), a
// directory per table (name hash, row count, column count, then each column's name hash, type, at, target), each
// column's values at `at`, and the u32 pool of `refs` columns. Every read is bounds-checked: a bad layout fails here.

export const TYPES = ['i32', 'f64', 'bool', 'ref', 'refs', 'copy'] as const;
export type TypeName = (typeof TYPES)[number];
export const width = (type: number): number => (type === 1 || type === 4 ? 8 : type === 2 ? 1 : 4);
export interface DirColumn { hash: number; type: number; at: number; target: number }
export interface DirTable { hash: number; rows: number; columns: DirColumn[] }
export interface Layout { magic: string; version: number; poolAt: number; poolCount: number; tables: DirTable[]; directoryEnd: number }
export type Value = number | boolean | number[];
export function layoutOf(b: Buffer, what: string): Layout {
  expect(b.length >= 20, `${what}: the bytes hold a header`).toBe(true);
  const tc = b.readUInt32LE(8);
  expect(tc <= 256, `${what}: table_count ${tc} is at most 256`).toBe(true);
  let p = 20;
  const tables: DirTable[] = [];
  for (let i = 0; i < tc; i++) {
    expect(p + 12 <= b.length, `${what}: table ${i}'s directory entry lies inside the bytes`).toBe(true);
    const cc = b.readUInt32LE(p + 8);
    const t: DirTable = { hash: b.readUInt32LE(p), rows: b.readUInt32LE(p + 4), columns: [] };
    p += 12;
    expect(p + 16 * cc <= b.length, `${what}: table ${i}'s columns lie inside the bytes`).toBe(true);
    for (let j = 0; j < cc; j++, p += 16) t.columns.push({ hash: b.readUInt32LE(p), type: b.readUInt32LE(p + 4), at: b.readUInt32LE(p + 8), target: b.readUInt32LE(p + 12) });
    tables.push(t);
  }
  return { magic: b.subarray(0, 4).toString('latin1'), version: b.readUInt32LE(4), poolAt: b.readUInt32LE(12), poolCount: b.readUInt32LE(16), tables, directoryEnd: p };
}
/** Column `c`'s value in row `r` (packed order): a number, a bool, or a refs cell's u32 row indices from the pool. */
export function valueAt(b: Buffer, l: Layout, c: DirColumn, r: number): Value {
  const q = c.at + r * width(c.type);
  expect(q + width(c.type) <= b.length, `the value at ${q} lies inside the bytes`).toBe(true);
  switch (c.type) {
    case 0: case 5: return b.readInt32LE(q);
    case 1: return b.readDoubleLE(q);
    case 2: return b[q] === 1;
    case 3: return b.readUInt32LE(q);
    case 4: {
      const [off, n] = [b.readUInt32LE(q), b.readUInt32LE(q + 4)];
      expect(off + n <= l.poolCount, `a refs cell's slice [${off}, ${off + n}) lies inside the pool of ${l.poolCount}`).toBe(true);
      return Array.from({ length: n }, (_, k) => b.readUInt32LE(l.poolAt + 4 * (off + k)));
    }
    default: return expect.fail(`a column of type ${c.type}, none of table.layout@1's six`);
  }
}
/** The directory's table named `name` (by its hash), and its column named `column`. */
export function tableNamed(l: Layout, name: string): DirTable {
  const t = l.tables.find((x) => x.hash === fnv32a(name));
  expect(t, `the directory holds table ${name} (hash ${fnv32a(name)}): ${show(l.tables.map((x) => x.hash))}`).toBeDefined();
  return t!;
}
export function columnNamed(t: DirTable, name: string): DirColumn {
  const c = t.columns.find((x) => x.hash === fnv32a(name));
  expect(c, `the table holds column ${name} (hash ${fnv32a(name)})`).toBeDefined();
  return c!;
}
/** The packed row holding ID `id`: found by the ID column (named `idColumn`) holding the ID's hash. */
export function rowOf(b: Buffer, t: DirTable, idColumn: string, id: string): number {
  const c = columnNamed(t, idColumn);
  for (let r = 0; r < t.rows; r++) if (b.readUInt32LE(c.at + 4 * r) === fnv32a(id)) return r;
  return expect.fail(`no row of the table holds ID ${id} (hash ${fnv32a(id)})`);
}
/** Every packed column's value in the row holding `id`, by column name, the ID column left out. */
export function rowValues(b: Buffer, l: Layout, table: string, schema: Schema, id: string): Record<string, Value> {
  const t = tableNamed(l, table);
  const s = schema[table]!;
  const r = rowOf(b, t, s.id, id);
  return Object.fromEntries(Object.keys(s.columns).map((c) => [c, valueAt(b, l, columnNamed(t, c), r)]));
}

/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB194D${String(n).padStart(18, '0')}`;

/** A table's rows with inheritance resolved: an empty cell of a row whose inherit cell names another takes that row's value. */
const empty = (v: Cell | undefined): boolean => v === null || v === undefined || v === '';
export function resolved(t: Tables, schema: Schema): Tables {
  const out: Tables = {};
  for (const [name, table] of Object.entries(t)) {
    const s = schema[name];
    const byId = new Map(table.rows.map((r) => [String(r[s?.id ?? 'id']), r]));
    const full = (r: Row, seen: string[]): Row => {
      const parent = s?.inherit && !empty(r[s.inherit]) ? byId.get(String(r[s.inherit])) : undefined;
      if (!parent || seen.includes(String(parent[s!.id]))) return r;
      const p = full(parent, [...seen, String(r[s!.id])]);
      return Object.fromEntries(table.columns.map((c) => [c, empty(r[c]) && c !== s!.inherit ? (p[c] ?? null) : (r[c] ?? null)]));
    };
    out[name] = { columns: table.columns, rows: table.rows.map((r) => full(r, [])) };
  }
  return out;
}
const TYPE_CODE: Record<TypeName, number> = { i32: 0, f64: 1, bool: 2, ref: 3, refs: 4, copy: 5 };
const typeOf = (c: ColumnSchema): { base: TypeName; of: string | null } => {
  const [base, of] = c.type.split(/\s+/) as [TypeName, string | undefined];
  return { base, of: of ?? null };
};
const listOf = (v: Cell | undefined): string[] => (empty(v) ? [] : Array.isArray(v) ? v : String(v).split(';'));
/**
 * This suite's judge of packed bytes and their record against the tables they were packed from (Asset: tables:
 * catalogs, the layout's doc and As built): inheritance resolved, tables in the directory by their name hashes and
 * columns by theirs, the ID column an i32 column of its own name holding each row's ID hash, the inherit column not
 * packed, rows sorted by ID hash (unsigned), each column's values after the directory in directory order with no
 * padding, the refs pool last; each value as the cell gives it (an empty cell 0, 0.0, false, 0xFFFFFFFF or []); a ref
 * to an ID no row holds 0xFFFFFFFF and listed in the record's `missing`. Each difference is one line naming where.
 */
export function judgeLayout(b: Buffer, record: Obj, given: Tables, schema: Schema): string[] {
  const out: string[] = [];
  const t = resolved(given, schema);
  const names = Object.keys(schema).sort((x, y) => fnv32a(x) - fnv32a(y));
  const order = new Map(names.map((n) => {
    const s = schema[n]!;
    const ids = (t[n]?.rows ?? []).map((r) => String(r[s.id])).sort((x, y) => fnv32a(x) - fnv32a(y));
    return [n, ids];
  }));
  const l = layoutOf(b, 'the packed bytes');
  if (l.magic !== 'TBLE' || l.version !== 1) out.push(`header: magic ${JSON.stringify(l.magic)} version ${l.version}, not TBLE 1`);
  if (l.tables.length !== names.length) return [...out, `header: ${l.tables.length} tables, not ${names.length}`];
  let cursor = 20 + names.reduce((n, name) => n + 12 + 16 * (Object.keys(schema[name]!.columns).length + 1), 0);
  if (l.directoryEnd !== cursor) out.push(`the directory ends at ${l.directoryEnd}, not ${cursor}`);
  let pool = 0;
  const missing: Obj[] = [];
  const recTables = Array.isArray(record['tables']) ? (record['tables'] as Obj[]) : [];
  if (recTables.length !== names.length) out.push(`record: ${recTables.length} tables, not ${names.length}`);
  names.forEach((name, ti) => {
    const s = schema[name]!;
    const ids = order.get(name)!;
    const rows = new Map((t[name]?.rows ?? []).map((r) => [String(r[s.id]), r]));
    const dt = l.tables[ti]!;
    const rt = recTables[ti] ?? {};
    if (dt.hash !== fnv32a(name)) out.push(`directory table ${ti}: name hash ${dt.hash}, not ${name}'s ${fnv32a(name)} (tables by their name hashes)`);
    if (dt.rows !== ids.length) out.push(`${name}: ${dt.rows} rows, not ${ids.length}`);
    for (const [k, want] of Object.entries({ name, hash: fnv32a(name), id: s.id, rows: ids.length })) if (rt[k] !== want) out.push(`record ${name}.${k}: ${show(rt[k])}, not ${show(want)}`);
    if (canon(rt['ids']) !== canon(ids)) out.push(`record ${name}.ids: not the IDs in packed (hash) order: ${show(rt['ids'], 300)}`);
    const cols: [string, ColumnSchema | null][] = [[s.id, null], ...Object.entries(s.columns)];
    cols.sort(([x], [y]) => fnv32a(x) - fnv32a(y));
    if (dt.columns.length !== cols.length) { out.push(`${name}: ${dt.columns.length} columns, not ${cols.length} (the ID column and the schema's, the inherit column left out)`); return; }
    const recCols = Array.isArray(rt['columns']) ? (rt['columns'] as Obj[]) : [];
    cols.forEach(([cname, cs], ci) => {
      const dc = dt.columns[ci]!;
      const ty = cs ? typeOf(cs) : { base: 'i32' as TypeName, of: null };
      const code = TYPE_CODE[ty.base];
      const target = (ty.base === 'ref' || ty.base === 'refs') ? names.indexOf(ty.of!) : 0;
      const where = `${name}.${cname}`;
      if (dc.hash !== fnv32a(cname)) out.push(`${name} column ${ci}: name hash ${dc.hash}, not ${cname}'s ${fnv32a(cname)} (columns by their name hashes)`);
      if (dc.type !== code) out.push(`${where}: type ${dc.type}, not ${code} (${ty.base})`);
      if (dc.target !== target) out.push(`${where}: target ${dc.target}, not ${target}`);
      if (dc.at !== cursor) out.push(`${where}: values at ${dc.at}, not ${cursor} (after the one before, no padding)`);
      const rc = recCols[ci] ?? {};
      const wantRec: Obj = { name: cname, hash: fnv32a(cname), type: ty.base, at: cursor };
      if (ty.base === 'ref' || ty.base === 'refs') wantRec['target'] = ty.of;
      if (ty.base === 'copy') wantRec['copy'] = ty.of;
      if (cs?.unit !== undefined) wantRec['unit'] = cs.unit;
      if (cs?.range !== undefined) wantRec['range'] = cs.range;
      if (!cs) wantRec['id'] = true;
      for (const [k, want] of Object.entries(wantRec)) if (canon(rc[k]) !== canon(want)) out.push(`record ${where}.${k}: ${show(rc[k])}, not ${show(want)}`);
      cursor += ids.length * width(code);
      ids.forEach((id, r) => {
        const cell = rows.get(id)![cname];
        const got = valueAt(b, l, dc, r);
        let want: Value;
        if (!cs) want = fnv32a(id) | 0;
        else if (ty.base === 'i32' || ty.base === 'copy') want = empty(cell) ? 0 : Number(cell);
        else if (ty.base === 'f64') want = empty(cell) ? 0 : Number(cell);
        else if (ty.base === 'bool') want = cell === true || cell === 'true';
        else {
          const target = order.get(ty.of!) ?? [];
          const list = listOf(cell).map((ref) => {
            const k = target.indexOf(ref);
            if (k < 0) missing.push({ table: name, id, column: cname, ref });
            return k < 0 ? 0xffffffff : k;
          });
          if (ty.base === 'refs') { want = list; pool += list.length; } else want = list[0] ?? 0xffffffff;
        }
        if (canon(got) !== canon(want)) out.push(`${where} of ${id} (packed row ${r}): ${show(got)}, not ${show(want)}`);
      });
    });
  });
  if (pool > 0 && l.poolAt !== cursor) out.push(`pool_at ${l.poolAt}, not ${cursor} (the pool last)`);
  if (l.poolCount !== pool) out.push(`pool_count ${l.poolCount}, not ${pool}`);
  if (b.length !== cursor + 4 * pool) out.push(`${b.length} bytes, not ${cursor + 4 * pool}`);
  const key = (m: Obj): string => canon({ table: m['table'], id: m['id'], column: m['column'], ref: m['ref'] });
  const got = (Array.isArray(record['missing']) ? (record['missing'] as Obj[]) : []).map(key).sort();
  if (canon(got) !== canon(missing.map(key).sort())) out.push(`record missing: ${show(got, 600)}, not ${show(missing.map(key).sort(), 600)}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Linux x86_64: the probe built for linux/amd64 in Docker with the rust image of rust-toolchain.toml's channel, its
// caches under target/acceptance-194-linux/; nothing is pulled: no Docker or no amd64 image is BLOCKED.

const LINUX = join(TARGET, 'acceptance-194-linux');
function linuxImage(): string {
  const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!channel) return blocked('rust-toolchain.toml names no channel');
  return `rust:${channel}-slim-bookworm`;
}
function docker(args: string[], input?: string, timeoutMs = 600_000): { status: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  if (r.error && !timedOut) return { status: null, stdout: '', stderr: r.error.message, timedOut };
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut };
}
/** The image's linux/amd64 variant is here (the tag may resolve to arm64 on this Mac while the index holds amd64 too). */
function hasAmd64(image: string): boolean {
  const per = docker(['image', 'inspect', '--platform', 'linux/amd64', '--format', '{{.Architecture}}', image], undefined, 30_000);
  if (per.status === 0 && per.stdout.trim() === 'amd64') return true;
  return docker(['image', 'inspect', '--format', '{{.Architecture}}', image], undefined, 30_000).stdout.trim() === 'amd64';
}
let linuxBuilt: string | undefined;
/** Runs `calls` through `deep-catalog pack` built for linux/amd64, each folder in `folders` mounted at its own path. */
export function packOnLinux(calls: PackCall[], folders: string[]): Obj[] {
  const image = linuxImage();
  if (linuxBuilt === undefined) {
    const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
    if (info.status !== 0) blocked(`Docker is unreachable (docker info: ${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); Linux x86_64 runs in a linux/amd64 container`);
    if (!hasAmd64(image)) blocked(`Docker has no linux/amd64 image ${image} here and this suite pulls nothing; run: docker pull --platform linux/amd64 ${image}`);
    for (const d of ['target', 'registry', 'git']) mkdirSync(join(LINUX, d), { recursive: true });
    const b = docker([
      'run', '--rm', '--platform', 'linux/amd64',
      '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target`,
      '-v', `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(LINUX, 'git')}:/usr/local/cargo/git`,
      '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${image.replace(/^rust:/, '').replace(/-slim-bookworm$/, '')}`,
      '-e', `CARGO_INCREMENTAL=${CARGO_ENV['CARGO_INCREMENTAL'] ?? '0'}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV['CARGO_PROFILE_DEV_DEBUG'] ?? '0'}`,
      image, 'cargo', ...catalogArgs('debug'),
    ], undefined, TIMEOUT * 2);
    linuxBuilt = b.status === 0 ? '' : `cargo ${catalogArgs('debug').join(' ')} in ${image} (linux/amd64) failed${b.timedOut ? ' (timed out)' : ''}:\n${b.stderr.slice(-4000)}`;
  }
  expect(linuxBuilt, 'the probe builds for Linux x86_64').toBe('');
  const mounts = folders.flatMap((f) => ['-v', `${f}:${f}`]);
  const r = docker(['run', '--rm', '-i', '--platform', 'linux/amd64', '-v', `${join(LINUX, 'target')}:/target:ro`, ...mounts, image, '/target/debug/deep-catalog', 'pack'],
    `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, 1_800_000);
  if (r.status === null && !r.timedOut) blocked(`docker run could not start: ${r.stderr.slice(-600)}`);
  return replies(r.status, r.stdout, r.stderr, calls, 'deep-catalog pack on linux/amd64');
}

// ---------------------------------------------------------------------------------------------------
// The catalog plug-in (Check input: catalog kinds, As built): `deepbuild/catalog` at packages/checks/catalog, installed
// into a fresh extension host from its folder and loaded in the hub; its kinds through `runCheck`.

export const CATALOG_DIR = join(REPO, 'packages', 'checks', 'catalog');
export const CATALOG_ID = 'deepbuild/catalog';
export const KINDS = ['catalog.refs', 'catalog.reach', 'catalog.economy', 'catalog.bounds', 'catalog.copy', 'scenario.reach'] as const;
export type Kind = (typeof KINDS)[number];
export const CODES = ['catalog.ref_missing', 'catalog.unreachable', 'catalog.gain_cycle', 'catalog.out_of_range', 'catalog.copy_missing', 'scenario.unreachable'];
/** The spec's field each kind's input rides in. */
export const FIELD: Record<Kind, string> = {
  'catalog.refs': 'refs', 'catalog.reach': 'reach', 'catalog.economy': 'economy', 'catalog.bounds': 'bounds', 'catalog.copy': 'copy', 'scenario.reach': 'scenario',
};
/** The plug-in's entry, for its named exports (catalogSource); a path, so the suite type-checks at the base. */
export const catalogEntry = async (): Promise<Obj> => (await import(join(CATALOG_DIR, 'index.ts'))) as Obj;
const kitModule = async (): Promise<Obj> => (await import(join(CATALOG_DIR, 'kit.ts'))) as Obj;

export interface Hub { host: Obj }
const closers: (() => Promise<void>)[] = [];
afterAll(async () => { for (const close of closers.splice(0)) await close().catch(() => undefined); }, 120_000);
/** A fresh extension host with the catalog plug-in installed from its folder (its digest the folder's packageDigest), checked and loaded in the hub. */
export async function openHub(): Promise<Hub> {
  const hostEntry = await import('../../../packages/extension-host/src/index.ts');
  const { openRecord } = await import('../../../packages/record/src/index.ts');
  const { openAsks } = await import('../../../packages/asks/src/index.ts');
  const { openSupervisor } = await import('../../../packages/supervisor/src/index.ts');
  expect(existsSync(join(CATALOG_DIR, 'deepbuild.json')), 'the catalog plug-in is a first-party package at packages/checks/catalog').toBe(true);
  const m = JSON.parse(readFileSync(join(CATALOG_DIR, 'deepbuild.json'), 'utf8')) as Obj;
  expect(m['id'], 'its manifest names it deepbuild/catalog').toBe(CATALOG_ID);
  expect(m['checks'], `its manifest lists the six kinds: ${show(m['checks'])}`).toEqual(expect.arrayContaining([...KINDS]));
  expect(m['codes'], `its manifest lists the six codes: ${show(m['codes'])}`).toEqual(expect.arrayContaining(CODES));
  const dir = scratch('hub');
  const home = join(dir, 'deepbuild');
  mkdirSync(home, { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await hostEntry.openTrust({ record, now: Date.now });
  const release = [{ id: CATALOG_ID, version: String(m['version']), digest: hostEntry.packageDigest(CATALOG_DIR) }];
  const host = await hostEntry.openExtensionHost({ record, asks, supervisor: sup, trust, home, release, now: Date.now } as unknown as Parameters<typeof hostEntry.openExtensionHost>[0]) as unknown as Obj;
  closers.push(async () => { await host['close']().catch(() => undefined); await sup.close().catch(() => undefined); await record.close().catch(() => undefined); });
  await host['ready']();
  const installed = await host['install']({ from: CATALOG_DIR, builtBy: null });
  const conformance = await host['check'](installed);
  expect(conformance.passed, `${CATALOG_ID} passes conformance: ${show(conformance)}`).toBe(true);
  const load = await host['load'](installed);
  expect(load.status === 'loaded' && load.place, `${CATALOG_ID} loads in the hub: ${show(load)}`).toBe('hub');
  return { host };
}

const base = { runner: 'deepbuild/catalog', inputs: [], depth: 'journey', oracle: 'code', contract: null };
/** A check's spec: its kind's input in its own field, and every catalog it names inline, as the hub fills them from the evidence store. */
export function specOf(kind: Kind, input: Obj, catalogs: Packed[]): Obj {
  return { kind, ...base, [FIELD[kind]]: input, catalogs: Object.fromEntries(catalogs.map((c) => [c.sha256, { bytes: c.bytes.toString('base64'), record: c.record }])) };
}
export interface Found { code: string; [key: string]: unknown }
export type Result = CheckResult & { catalog?: { kind: string; ms: number; found: Found[] } };
export async function runCheck(hub: Hub, spec: Obj): Promise<Result> {
  return (await hub.host['runCheck'](String(spec['kind']), spec, { checkout: scratch('checkout'), deadline: TIMEOUT })) as Result;
}
export const shown = (r: Result): string =>
  `${r.outcome}, testsRun ${r.testsRun}; failures: ${r.failures.map((f) => `[${f.test}] ${f.message}`).join(' | ').slice(0, 3000) || '(none)'}; found: ${show(r.catalog?.found ?? null, 1500)}`;
/** The failures whose message starts with `code`. */
export const failuresOf = (r: Result, code: string): CheckResult['failures'] => r.failures.filter((f) => f.message.startsWith(code));
/** The result's own report, `catalog: {kind, ms, found}`, checked for its shape. */
export function catalogOf(r: Result, kind: Kind): { kind: string; ms: number; found: Found[] } {
  const c = r.catalog;
  expect(c && typeof c === 'object', `the result carries catalog: {kind, ms, found}: ${shown(r)}`).toBe(true);
  expect(c!.kind, 'catalog.kind names the check\'s kind').toBe(kind);
  expect(typeof c!.ms === 'number' && c!.ms >= 0, `catalog.ms is the check's own wall time: ${show(c!.ms)}`).toBe(true);
  expect(Array.isArray(c!.found), 'catalog.found lists its findings').toBe(true);
  return c!;
}
/** A passing result: no failure, rows judged, the catalog's asset ID as its evidence. */
export function passes(r: Result, kind: Kind, c: Packed, what: string): void {
  expect(r.outcome, `${what} passes: ${shown(r)}`).toBe('passed');
  expect(r.testsRun, `${what}: it counts the rows it judged`).toBeGreaterThan(0);
  expect(r.evidence, `${what}: its evidence is the catalog's asset ID`).toContain(c.sha256);
  expect(catalogOf(r, kind).found, `${what}: it finds nothing`).toEqual([]);
}
/** scenario.reach over trigger table `triggers` of the scenario catalog, its goals and turns the brief's (fixtures.ts), its copy `data`. */
export const scenario = (c: Packed, triggers: string, data: Copy = messageCopy()): Obj =>
  specOf('scenario.reach', { catalog: c.sha256, triggers, map: 'map', goals: GOALS[triggers], turns: TURNS, copy: data, locales: ['en'] }, [c]);
/** The result's findings of `code`. */
export const foundOf = (r: Result, kind: Kind, code: string): Found[] => catalogOf(r, kind).found.filter((f) => f.code === code);

/** The plug-in's conformance kit (README: The surface): `catalogKit()` from its kit.ts. */
export async function catalogKit(): Promise<Obj> {
  const m = await kitModule();
  expect(typeof m['catalogKit'], 'the plug-in\'s kit.ts exports catalogKit(): check.kind@1\'s kit for its six kinds').toBe('function');
  return m['catalogKit']() as Obj;
}
/** A fill of the kit: its reference (`clean`), or the planted fill of that name. */
export function fillOf(kit: Obj, name: string): Obj {
  if (name === 'clean') {
    const cleans = kit['clean']() as Obj[];
    expect(cleans.length, 'the kit has a reference fill').toBeGreaterThan(0);
    return cleans[0]!;
  }
  const p = (kit['planted'] as Obj[]).find((x) => x['name'] === name);
  expect(p, `the kit plants a runner named ${name}: ${show((kit['planted'] as Obj[]).map((x) => x['name']))}`).toBeDefined();
  return p!['fill'] as Obj;
}
/** A kit fill's check.kind@1 `run(spec, ctx)`: the kind its spec names. */
export async function runFill(fill: Obj, spec: Obj): Promise<Result> {
  return (await fill['run'](spec, { checkout: scratch('fill'), deadline: TIMEOUT, now: Date.now })) as Result;
}
