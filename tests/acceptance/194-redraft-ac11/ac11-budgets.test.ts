// AC11 #194.60b4ab87: "Budgets, on the reference Mac in the local preflight, compared with the merge base: packing 10,000
// rows of 20 columns takes under 1 s, catalog.reach and catalog.economy over 5,000 recipes each take under 200 ms, and a
// piece that names a catalog gains no work per frame"
//
// A timed file (README: What the test does). In order:
//   1. On any machine, debug builds, everything the budgets time, each guarded so what it times is the clause's work:
//      `deep-catalog pack` packs `parts` (10,000 rows, 20 columns, CSV) and answers its `ms`; it packs `workshop`
//      (6,251 items, 5,000 recipes, a start kit and 1,250 loot rows), on which the catalog plug-in deepbuild/catalog,
//      installed from packages/checks/catalog into a real extension host, passes catalog.reach and catalog.economy and
//      reports each one's `catalog.ms`.
//   2. No work per frame, by the merge base's own counters: the piece `stores`, whose logic item names the packed
//      workshop as a catalog asset, against the same piece handed the same bytes as a plain data asset, the route the
//      merge base has, each in a deep-show process of its own (the scheduler reuses nodes across documents in one run):
//      no frame after the first runs more operators, writes more JSON values or remaps other rows; the sandbox's counts
//      don't move over its frames; every step spends the same fuel and leaves the same arrays. The planted
//      `catalog_validated_per_frame` must fail that judgement.
//   3. The record the perf lane and the budget window compare with the merge base: benchmarks/budgets.json's task
//      `catalog-budgets`, valid by the lane's validator, naming this criterion and #194; scripts/lanes.mjs times this file.
//   4. Only where the lane can judge (a reference Mac on mains power, Low Power Mode off, thermal state nominal, the load
//      under the core count; else INCONCLUSIVE before anything is timed, never a pass): release deep-catalog, a warm-up
//      and five readings of each number, judged by scripts/benchmark.mjs's judgeLimit; a FAIL fails, anything else but
//      PASS is INCONCLUSIVE.
// The wrong programs: the base (no deep-catalog, no plug-in, no record), a pack past 1 s or a reach or economy past
// 200 ms on the reference Mac, a piece whose catalog costs operators, rows, sandbox runs or fuel at frame time.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, describe, expect, it } from 'vitest';
import {
  REPO, SESSION, TIMEOUT, arr, assemble, binOf, encodeRgbaPng, errorsOf, failsNaming, framesCall, framesOf, inconclusive, isObject,
  judgeLimit, load, none, num, obj, presented, putEvidence, runShow, scenario, sha256, show, showCall, useTemp, validateBudgets,
  type JsonObject, type JsonValue, type Program,
} from '../538/helpers.ts';

const ID = '#194.60b4ab87';
const FILE = 'tests/acceptance/194-redraft-ac11/ac11-budgets.test.ts';
/** The task the perf lane and the budget window run (README: The record). */
const TASK = {
  id: 'catalog-budgets', command: ['node', 'benchmarks/canvas.mjs', 'catalog'], margin: 0.5,
  targets: { pack_10000_rows_ms: 1000, reach_5000_recipes_ms: 200, economy_5000_recipes_ms: 200, idle_work: 0 },
};
const RUNS = 5;
const DEADLINE = 3_600_000;
const temp = useTemp();
type Obj = { [key: string]: any };

// ---------------------------------------------------------------------------------------------------
// FNV-1a, 32 bits, over UTF-8: how the layout names an ID, a column and a table (Asset: tables: catalogs).

function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (const b of Buffer.from(text, 'utf8')) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h >>> 0;
}
/** A fixture's own guard: no two of `names` share a hash, so the probe has nothing to refuse. Never a finding. */
function distinct(names: string[], what: string): void {
  const seen = new Map<number, string>();
  for (const n of names) {
    const h = fnv1a(n);
    if (seen.has(h)) throw Error(`the fixture ${what} has two names hashing alike, ${seen.get(h)} and ${n}: fix the fixture`);
    seen.set(h, n);
  }
}
type Row = Record<string, string>;
/** A CSV file: its header, then a line a row; no cell here needs quotes. */
function csv(dir: string, name: string, columns: string[], rows: Row[]): string {
  const path = join(dir, `${name}.csv`);
  writeFileSync(path, [columns.join(','), ...rows.map((r) => columns.map((c) => r[c] ?? '').join(','))].join('\n') + '\n');
  return path;
}

// ---------------------------------------------------------------------------------------------------
// `parts`: 10,000 rows of 20 columns, its ID column and 19 typed columns of every type the schema writes.

const PARTS = 10_000;
const partId = (i: number): string => `part${String(i).padStart(5, '0')}`;
type Cell = (i: number) => string;
const ref = (f: (i: number) => number): Cell => (i) => partId(f(i) % PARTS);
/** Each typed column: its schema entry and its cell in row i. All values sit in their ranges; every ref resolves. */
const PART_COLUMNS: [string, JsonObject, Cell][] = [
  ['level', { type: 'i32', range: [0, 99] }, (i) => String(i % 100)],
  ['stack', { type: 'i32', range: [1, 64] }, (i) => String(1 + (i % 64))],
  ['price', { type: 'i32', unit: 'gold', range: [0, 4990] }, (i) => String(10 * (i % 500))],
  ['tier', { type: 'i32', range: [0, 6] }, (i) => String(i % 7)],
  ['durability', { type: 'i32', range: [100, 999] }, (i) => String(100 + (i % 900))],
  ['slots', { type: 'i32', range: [0, 4] }, (i) => String(i % 5)],
  ['weight', { type: 'f64', unit: 'kg', range: [0, 125] }, (i) => String((i % 1000) / 8)],
  ['damage', { type: 'f64', range: [0, 75] }, (i) => String((i % 300) / 4)],
  ['speed', { type: 'f64', unit: 'm/s', range: [1, 3.5] }, (i) => String(1 + (i % 40) / 16)],
  ['reach', { type: 'f64', unit: 'm', range: [0.5, 2.75] }, (i) => String(0.5 + (i % 10) / 4)],
  ['crit', { type: 'f64', range: [0, 0.3] }, (i) => String((i % 20) / 64)],
  ['value', { type: 'f64', unit: 'gold', range: [0, 5000] }, (i) => String(i / 2)],
  ['stackable', { type: 'bool' }, (i) => String(i % 2 === 0)],
  ['rare', { type: 'bool' }, (i) => String(i % 97 === 0)],
  ['upgrade', { type: 'ref parts' }, ref((i) => i + 1)],
  ['salvage', { type: 'ref parts' }, ref((i) => 7 * i + 3)],
  ['components', { type: 'refs parts' }, (i) => [11, 13, 17].map((d) => partId((i + d) % PARTS)).join(';')],
  ['drops', { type: 'refs parts' }, (i) => [partId((3 * i) % PARTS), partId((5 * i + 1) % PARTS)].join(';')],
  ['name', { type: 'copy parts' }, (i) => String(1000 + i)],
];
const PART_NAMES = ['id', ...PART_COLUMNS.map(([n]) => n)];
const PARTS_SCHEMA: JsonObject = { parts: { id: 'id', columns: Object.fromEntries(PART_COLUMNS.map(([n, s]) => [n, s])) } };
function writeParts(dir: string): Record<string, string> {
  const ids = Array.from({ length: PARTS }, (_, i) => partId(i));
  distinct(ids, 'parts');
  distinct(PART_NAMES, 'parts\' columns');
  const rows = ids.map((id, i) => ({ id, ...Object.fromEntries(PART_COLUMNS.map(([n, , cell]) => [n, cell(i)])) }));
  return { parts: csv(dir, 'parts', PART_NAMES, rows) };
}

// ---------------------------------------------------------------------------------------------------
// `workshop`: 1,250 families f, each with its raw ore and wood (from the loot row chest<f>), smelt<f> (2 ore and a wood
// into an ingot) and its uncraft salvage<f>, forge0 (two ingots into blade0) or temper<f> (blade<f−1> and an ingot into
// blade<f>), and assemble<f> (a blade and a wood into tool<f>); the start kit holds the hammer, the tool every recipe but
// assemble takes. 5,000 recipes; every row reachable; each smelt and its salvage a cycle that gains nothing; each
// recipe's outputs worth what its inputs are, inside a margin of 5.

const FAMILIES = 1_250;
const RECIPES = 4 * FAMILIES;
const WORTH = { ore: 2, wood: 1, ingot: 5 } as const;
const bladeWorth = (f: number): number => 10 + 5 * f;
const toolWorth = (f: number): number => 11 + 5 * f;
/** The item the piece's program reads, and its value as items.csv holds it. */
const READ_ITEM = `tool${FAMILIES - 1}`;
const READ_VALUE = toolWorth(FAMILIES - 1);
const WORKSHOP_SCHEMA: JsonObject = {
  items: { id: 'id', columns: { value: { type: 'f64', unit: 'gold', range: [0, 100_000] } } },
  recipes: { id: 'id', columns: { inputs: { type: 'refs items' }, tools: { type: 'refs items' }, outputs: { type: 'refs items' } } },
  kits: { id: 'id', columns: { gear: { type: 'refs items' } } },
  loot: { id: 'id', columns: { drops: { type: 'refs items' } } },
};
const WORKSHOP_ROWS = { items: 1 + 5 * FAMILIES, recipes: RECIPES, kits: 1, loot: FAMILIES } as const;
const MAKES: JsonValue = [{ table: 'recipes', inputs: 'inputs', tools: 'tools', outputs: 'outputs' }];
const REACH = (catalog: string): JsonObject => ({
  catalog, roots: [{ table: 'kits', column: 'gear' }, { table: 'loot', column: 'drops' }], makes: MAKES, every: ['items', 'recipes'],
});
const ECONOMY = (catalog: string): JsonObject => ({ catalog, makes: MAKES, value: { table: 'items', column: 'value' }, margin: 5 });
function writeWorkshop(dir: string): Record<string, string> {
  const items: Row[] = [{ id: 'hammer', value: '0' }];
  const recipes: Row[] = [];
  const loot: Row[] = [];
  for (let f = 0; f < FAMILIES; f++) {
    items.push(
      { id: `ore${f}`, value: String(WORTH.ore) }, { id: `wood${f}`, value: String(WORTH.wood) }, { id: `ingot${f}`, value: String(WORTH.ingot) },
      { id: `blade${f}`, value: String(bladeWorth(f)) }, { id: `tool${f}`, value: String(toolWorth(f)) },
    );
    recipes.push(
      { id: `smelt${f}`, inputs: `ore${f};ore${f};wood${f}`, tools: 'hammer', outputs: `ingot${f}` },
      { id: `salvage${f}`, inputs: `ingot${f}`, tools: 'hammer', outputs: `ore${f};ore${f};wood${f}` },
      f === 0
        ? { id: 'forge0', inputs: 'ingot0;ingot0', tools: 'hammer', outputs: 'blade0' }
        : { id: `temper${f}`, inputs: `blade${f - 1};ingot${f}`, tools: 'hammer', outputs: `blade${f}` },
      { id: `assemble${f}`, inputs: `blade${f};wood${f}`, tools: '', outputs: `tool${f}` },
    );
    loot.push({ id: `chest${f}`, drops: `ore${f};wood${f}` });
  }
  const kits: Row[] = [{ id: 'start', gear: 'hammer' }];
  distinct([...items, ...recipes, ...kits, ...loot].map((r) => r['id']!), 'workshop');
  distinct(['items', 'recipes', 'kits', 'loot', 'id', 'value', 'inputs', 'tools', 'outputs', 'gear', 'drops'], 'workshop\'s tables and columns');
  return {
    items: csv(dir, 'items', ['id', 'value'], items), recipes: csv(dir, 'recipes', ['id', 'inputs', 'tools', 'outputs'], recipes),
    kits: csv(dir, 'kits', ['id', 'gear'], kits), loot: csv(dir, 'loot', ['id', 'drops'], loot),
  };
}

// ---------------------------------------------------------------------------------------------------
// deep-catalog: `cargo build --locked [--release] --bin deep-catalog`, copied out of the target folder; `pack` takes one
// JSON line on stdin and answers one line (Asset: tables: catalogs `table.layout@1`, As built).

const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
let binDir = '';
const built = new Map<boolean, { bin: string; error: string }>();
function catalogBin(release: boolean): { bin: string; error: string } {
  const known = built.get(release);
  if (known) return known;
  const args = ['build', '--locked', ...(release ? ['--release'] : []), '--bin', 'deep-catalog'];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 2 ** 20, env: { ...process.env, ...CARGO_ENV } });
  let error = '';
  if (run.error) error = `cargo could not run: ${run.error.message}`;
  else if (run.status !== 0) {
    const kept = run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking|^warning|^\s*(\||=|-->)|^\s*\d+ \|/.test(l));
    error = `\`cargo ${args.join(' ')}\` failed: ${kept.join(' ').trim().slice(-1500)}`;
  }
  let bin = '';
  if (!error) {
    if (!binDir) binDir = mkdtempSync(join(tmpdir(), 'deep-194-ac11-bins-'));
    bin = join(binDir, `deep-catalog-${release ? 'release' : 'debug'}`);
    copyFileSync(join(TARGET, release ? 'release' : 'debug', 'deep-catalog'), bin);
  }
  const out = { bin, error };
  built.set(release, out);
  return out;
}
afterAll(() => { if (binDir) rmSync(binDir, { recursive: true, force: true }); binDir = ''; });

interface Packed { sha: string; bytes: Buffer; record: JsonObject; ms: number; wall: number }
/** `deep-catalog pack` of `tables` (CSV, by path) under `schema`, written to `out`: ok, its bytes by sha256, its record. */
function pack(bin: string, tables: Record<string, string>, schema: JsonObject, out: string, what: string): Packed {
  const line = JSON.stringify({ op: 'pack', tables: Object.fromEntries(Object.entries(tables).map(([t, path]) => [t, { path }])), schema, out });
  const at = performance.now();
  const r = spawnSync(bin, ['pack'], { input: `${line}\n`, encoding: 'utf8', maxBuffer: 1024 * 2 ** 20, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const wall = performance.now() - at;
  expect(r.status, `${what}: deep-catalog pack exits 0; stderr: ${(r.stderr ?? '').slice(-1200)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l.trim() !== '');
  expect(lines.length, `${what}: one line out for the one line in: ${(r.stdout ?? '').slice(0, 600)}`).toBe(1);
  const reply = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the reply`);
  expect(reply['ok'], `${what}: the pack answers ok: ${show(reply, 1200)}`).toBe(true);
  expect(existsSync(out), `${what}: the packed bytes are written to out`).toBe(true);
  const bytes = readFileSync(out);
  const sha = sha256(bytes);
  const record = obj(reply['record'], `${what}: record`);
  expect([reply['sha256'], record['sha256'], reply['size'], record['size'], record['layout']], `${what}: the reply and its record name the bytes written, by SHA-256 and size, in table.layout@1`)
    .toEqual([sha, sha, bytes.length, bytes.length, 'table.layout@1']);
  const ms = num(reply['ms'], `${what}: ms, the pack's own wall time`);
  expect(ms >= 0 && ms <= wall, `${what}: ms ${ms} is the pack's own time, inside the call's ${wall.toFixed(1)} ms`).toBe(true);
  expect(record['missing'], `${what}: every ref names a row its table holds`).toEqual([]);
  return { sha, bytes, record, ms, wall };
}
/** The record's tables by name: each one's rows and its columns' names. */
function tablesOf(record: JsonObject, what: string): Record<string, { rows: number; columns: string[]; ids: number }> {
  return Object.fromEntries(arr(record['tables'], `${what}: record.tables`).map((t, i) => {
    const o = obj(t, `${what}: record.tables[${i}]`);
    const columns = arr(o['columns'], `${what}: record.tables[${i}].columns`).map((c, j) => String(obj(c, `${what}: column ${j}`)['name']));
    return [String(o['name']), { rows: num(o['rows'], `${what}: rows`), columns, ids: arr(o['ids'], `${what}: ids`).length }];
  }));
}

/** packing 10,000 rows of 20 columns: the reply's `ms`, with the record showing those rows and columns packed. */
let packs = 0;
function packParts(bin: string, files: Record<string, string>, dir: string, what: string): Packed {
  const p = pack(bin, files, PARTS_SCHEMA, join(dir, `parts-${++packs}.tbl`), what);
  const t = tablesOf(p.record, what);
  expect(Object.keys(t), `${what}: one table, parts`).toEqual(['parts']);
  expect({ rows: t['parts']!.rows, ids: t['parts']!.ids, columns: [...t['parts']!.columns].sort() }, `${what}: 10,000 rows of the 20 columns, its ID column among them`)
    .toEqual({ rows: PARTS, ids: PARTS, columns: [...PART_NAMES].sort() });
  return p;
}

// ---------------------------------------------------------------------------------------------------
// The catalog plug-in in a real extension host: installed from its folder as a release package, its conformance
// checked, loaded; its kinds run through runCheck (Check input: catalog kinds, As built). No replica: the kinds never
// run the piece.

const CATALOG_DIR = join(REPO, 'packages', 'checks', 'catalog');
const CATALOG_ID = 'deepbuild/catalog';
interface Host { runCheck(kind: string, spec: Obj, ctx: { checkout: string; deadline: number }): Promise<Obj> }
const closers: (() => Promise<void>)[] = [];
afterAll(async () => { for (const close of closers.splice(0)) await close().catch(() => undefined); }, 120_000);
async function openCatalogHost(): Promise<Host> {
  const hostEntry = await import('../../../packages/extension-host/src/index.ts');
  const { openRecord } = await import('../../../packages/record/src/index.ts');
  const { openAsks } = await import('../../../packages/asks/src/index.ts');
  const { openSupervisor } = await import('../../../packages/supervisor/src/index.ts');
  const dir = temp();
  const home = join(dir, 'deepbuild');
  mkdirSync(home, { recursive: true });
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
  const trust = await hostEntry.openTrust({ record, now: Date.now });
  const m = JSON.parse(readFileSync(join(CATALOG_DIR, 'deepbuild.json'), 'utf8')) as Obj;
  expect(m['id'], 'packages/checks/catalog/deepbuild.json names the plug-in deepbuild/catalog').toBe(CATALOG_ID);
  const release = [{ id: CATALOG_ID, version: String(m['version']), digest: hostEntry.packageDigest(CATALOG_DIR) }];
  const host = await hostEntry.openExtensionHost({ record, asks, supervisor: sup, trust, home, release, now: Date.now } as unknown as Parameters<typeof hostEntry.openExtensionHost>[0]) as unknown as Obj;
  closers.push(async () => { await host['close']().catch(() => undefined); await sup.close().catch(() => undefined); await record.close().catch(() => undefined); });
  await host['ready']();
  const installed = await host['install']({ from: CATALOG_DIR, builtBy: null });
  const conformance = await host['check'](installed);
  expect(conformance.passed, `${CATALOG_ID} passes conformance: ${show(conformance)}`).toBe(true);
  const loaded = await host['load'](installed);
  expect(loaded.status, `${CATALOG_ID} loads: ${show(loaded)}`).toBe('loaded');
  return host as unknown as Host;
}
/** One run of `kind` over the workshop, its input in the spec's field `field`, the catalog inlined as the hub fills it. */
async function runKind(host: Host, kind: string, field: string, input: JsonObject, cat: Packed, what: string): Promise<number> {
  const spec: Obj = {
    kind, runner: CATALOG_ID, inputs: [], depth: 'unit', oracle: 'code', contract: null, [field]: input,
    catalogs: { [cat.sha]: { bytes: cat.bytes.toString('base64'), record: cat.record } },
  };
  const at = performance.now();
  const r = await host.runCheck(kind, spec, { checkout: temp(), deadline: DEADLINE });
  const wall = performance.now() - at;
  const failures = (Array.isArray(r['failures']) ? r['failures'] : []).map((f: Obj) => `[${f['test']}] ${f['message']}`);
  expect({ outcome: r['outcome'], failures: failures.slice(0, 8) }, `${what}: ${kind} passes over the 5,000 recipes`).toEqual({ outcome: 'passed', failures: [] });
  expect(Number(r['testsRun']) >= RECIPES, `${what}: it judged at least the 5,000 recipes (testsRun ${show(r['testsRun'])})`).toBe(true);
  expect(r['evidence'], `${what}: its evidence is the catalog's asset ID`).toContain(cat.sha);
  const c = obj(r['catalog'] as JsonValue, `${what}: the result's catalog`);
  expect([c['kind'], c['found']], `${what}: catalog.kind is ${kind}, and it found nothing`).toEqual([kind, []]);
  const ms = num(c['ms'], `${what}: catalog.ms, the wall time of the check's own work`);
  expect(ms >= 0 && ms <= wall, `${what}: catalog.ms ${ms} inside the run's ${wall.toFixed(1)} ms`).toBe(true);
  return ms;
}

// ---------------------------------------------------------------------------------------------------
// The piece: `stores`, a 40 × 16 film over 1 s at 60 Hz, its logic item `qm` naming the workshop in `assets`, and `strip`,
// four atlas tiles from `qm.tiles`. `qm` (WebAssembly text, #544's assembler) at init finds `items` by its name's hash in
// the directory, its `id` and `value` columns by theirs, and tool1249's row by a binary search on its ID's hash, and
// keeps that value; each step writes it to `value` and (k + i) mod 8 to tiles[i]. Without an asset it keeps −1.

const ASSETS_AT = 65_536;
const WRITES_AT = 4096;
const i32 = (u: number): number => u | 0;
const qmProgram = (): Program => assemble('qm194', `
(module
  (memory (export "memory") 32 32)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global (export "assets_at") i32 (i32.const ${ASSETS_AT}))
  (global $v (mut f64) (f64.const -1))
  (func (export "init") (param $seed i64)
    (local $base i32) (local $tc i32) (local $p i32) (local $i i32) (local $cc i32) (local $rows i32) (local $q i32)
    (local $j i32) (local $idAt i32) (local $valAt i32) (local $lo i32) (local $hi i32) (local $mid i32) (local $h i32)
    (if (i32.eqz (i32.load (i32.const ${ASSETS_AT}))) (then (return)))
    (local.set $base (i32.const ${ASSETS_AT + 4}))
    (local.set $tc (i32.load offset=8 (local.get $base)))
    (local.set $p (i32.add (local.get $base) (i32.const 20)))
    (local.set $idAt (i32.const -1))
    (local.set $valAt (i32.const -1))
    (block $found
      (loop $tables
        (br_if $found (i32.ge_u (local.get $i) (local.get $tc)))
        (local.set $rows (i32.load offset=4 (local.get $p)))
        (local.set $cc (i32.load offset=8 (local.get $p)))
        (if (i32.eq (i32.load (local.get $p)) (i32.const ${i32(fnv1a('items'))}))
          (then
            (local.set $q (i32.add (local.get $p) (i32.const 12)))
            (block $cols_done (loop $cols
              (br_if $cols_done (i32.ge_u (local.get $j) (local.get $cc)))
              (if (i32.eq (i32.load (local.get $q)) (i32.const ${i32(fnv1a('id'))})) (then (local.set $idAt (i32.load offset=8 (local.get $q)))))
              (if (i32.eq (i32.load (local.get $q)) (i32.const ${i32(fnv1a('value'))})) (then (local.set $valAt (i32.load offset=8 (local.get $q)))))
              (local.set $q (i32.add (local.get $q) (i32.const 16)))
              (local.set $j (i32.add (local.get $j) (i32.const 1)))
              (br $cols)))
            (br $found)))
        (local.set $p (i32.add (local.get $p) (i32.add (i32.const 12) (i32.shl (local.get $cc) (i32.const 4)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $tables)))
    (if (i32.or (i32.eq (local.get $idAt) (i32.const -1)) (i32.eq (local.get $valAt) (i32.const -1))) (then (return)))
    (local.set $hi (local.get $rows))
    (block $done (loop $search
      (br_if $done (i32.ge_u (local.get $lo) (local.get $hi)))
      (local.set $mid (i32.shr_u (i32.add (local.get $lo) (local.get $hi)) (i32.const 1)))
      (local.set $h (i32.load (i32.add (i32.add (local.get $base) (local.get $idAt)) (i32.shl (local.get $mid) (i32.const 2)))))
      (if (i32.eq (local.get $h) (i32.const ${i32(fnv1a(READ_ITEM))}))
        (then
          (global.set $v (f64.load (i32.add (i32.add (local.get $base) (local.get $valAt)) (i32.shl (local.get $mid) (i32.const 3)))))
          (br $done)))
      (if (i32.lt_u (local.get $h) (i32.const ${i32(fnv1a(READ_ITEM))}))
        (then (local.set $lo (i32.add (local.get $mid) (i32.const 1))))
        (else (local.set $hi (local.get $mid))))
      (br $search))))
  (func (export "step") (param $k i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const ${WRITES_AT}) (i32.shl (local.get $i) (i32.const 2)))
        (i32.and (i32.add (i32.wrap_i64 (local.get $k)) (local.get $i)) (i32.const 7)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const 4))))
    (f64.store (i32.const ${WRITES_AT + 16}) (global.get $v))))`);
const STEPS = 60;
const FRAMES = 30;
const SEEK = 10;
const SANDBOX = ['checks', 'links', 'rewrites', 'runs'] as const;
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #194 acceptance tests.' };
const EIGHT: [number, number, number][] = [[230, 25, 75], [60, 180, 75], [255, 225, 25], [0, 130, 200], [245, 130, 48], [145, 30, 180], [70, 240, 240], [240, 50, 230]];
const stripAtlas = (): Buffer => encodeRgbaPng(32, 4, (x) => [...EIGHT[Math.floor(x / 4)]!, 255] as [number, number, number, number]);
const DOC = (n: number): string => `01JB194D${String(n).padStart(18, '0')}`;
/** `stores`, its logic item naming the workshop: as a catalog asset when `typed`, else as a plain data asset. */
function storesDoc(qm: Program, atlas: string, catalog: string, typed: boolean): JsonObject {
  const size = [40, 16];
  return {
    format: 1, id: 'stores', profile: 'film', title: '#194 stores', description: 'The #194 budget test\'s piece that names a catalog.', size, seed: 194,
    camera: 'cam', transport: { span: '1s', frame_rate: [60, 1] },
    items: {
      cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [20, 8, 0], view_width: 40 } },
      qm: {
        id: 'qm', kind: 'logic@1', name: 'Logic qm', order: 'a9',
        params: { program: qm.sha, step_rate: 60, writes: { tiles: { type: 'i32', count: 4 }, value: { type: 'f64', count: 1 } }, assets: [catalog] },
      },
      strip: {
        id: 'strip', kind: 'marks@1', name: 'Strip', order: 'a1', at: { pos: [4, 4, 0] },
        params: { mark: 'image', atlas: { asset: atlas, cell: [4, 4], padding: 1 }, grid: { shape: 'square', cell: [8, 8], size: [4, 1] }, columns: { tile: { array: 'qm.tiles', as: 'u16' } } },
      },
    },
    assets: {
      qm_program: { sha256: qm.sha, license: LICENSE }, strip_atlas: { sha256: atlas, license: LICENSE },
      workshop: { sha256: catalog, ...(typed ? { kind: 'catalog', layout: 'table.layout@1' } : {}), license: LICENSE },
    },
  };
}
interface Played { ran: number[]; json: number[]; remaps: string[]; before: JsonObject; after: JsonObject; fuel: JsonValue[]; arrays: string[]; values: JsonValue[] }
/** One deep-show process: present `doc`, read the sandbox's counts, 30 frames from 0 and 10 from 5f, the counts again, and
 * deep_query's bake of qm over the 60 steps. */
function play(document: JsonObject, bytes: Buffer[], doc: string, what: string, planted?: string): Played {
  const ev = temp();
  for (const b of bytes) putEvidence(ev, b);
  const steps = Array.from({ length: STEPS }, (_, k) => k);
  const calls: JsonObject[] = [
    showCall(doc, document), { call: 'sandbox' }, framesCall(doc, FRAMES), framesCall(doc, SEEK, { from: '5f' }), { call: 'sandbox' },
    { call: 'deep_query', session: SESSION, doc, what: 'logic', items: ['qm'], steps },
  ];
  const r = runShow(binOf(), scenario(ev, [doc], calls, planted as never), what);
  presented(r[0]!, what);
  none(errorsOf(r[0]!).map((i) => show(i, 400)), `${what}: presented with no error`);
  const frames = [...framesOf(r[2]!, FRAMES, `${what}: frames from 0`), ...framesOf(r[3]!, SEEK, `${what}: frames from 5f`)];
  const q = obj(obj(r[5]!['logic'], `${what}: deep_query's logic (${show(r[5], 600)})`)['qm'], `${what}: logic.qm`);
  const baked = arr(q['steps'], `${what}: logic.qm.steps`).map((s, k) => obj(s, `${what}: step ${k}`));
  expect(baked.map((s) => s['step']), `${what}: one answer per step asked`).toEqual(steps);
  return {
    ran: frames.map((f, i) => num(f['ran'], `${what}: frame ${i}: ran`)),
    json: frames.map((f, i) => num(f['json_values'], `${what}: frame ${i}: json_values`)),
    remaps: frames.map((f) => JSON.stringify(f['remaps'] ?? null)),
    before: r[1]!, after: r[4]!,
    fuel: baked.map((s) => s['fuel'] ?? null),
    arrays: baked.map((s) => JSON.stringify(s['arrays'] ?? null)),
    values: baked.map((s) => (isObject(s['arrays']) && Array.isArray(s['arrays']['qm.value']) ? s['arrays']['qm.value'][0] ?? null : null)),
  };
}
const frameName = (i: number): string => (i < FRAMES ? `frame ${i}` : `frame ${i - FRAMES} after the seek to 5f`);
/** What the piece naming the catalog does per frame and per step that the same piece with a plain data asset doesn't. */
function gained(piece: Played, blob: Played, catalog: string): string[] {
  const out: string[] = [];
  for (let i = 1; i < piece.ran.length; i++) {
    if (piece.ran[i]! > blob.ran[i]!) out.push(`${frameName(i)}: the piece that names catalog ${catalog} runs ${piece.ran[i]} operators, the same piece with the bytes as a plain data asset ${blob.ran[i]}`);
    if (piece.json[i]! > blob.json[i]!) out.push(`${frameName(i)}: it writes ${piece.json[i]} JSON values, the plain asset's piece ${blob.json[i]}`);
    if (piece.remaps[i] !== blob.remaps[i]) out.push(`${frameName(i)}: it remaps ${piece.remaps[i]}, the plain asset's piece ${blob.remaps[i]}`);
  }
  for (const k of SANDBOX) {
    if (piece.after[k] !== piece.before[k]) out.push(`the sandbox's ${k} went from ${show(piece.before[k])} to ${show(piece.after[k])} over the piece's ${FRAMES + SEEK} frames: check-time work on catalog ${catalog} at frame time`);
  }
  piece.fuel.forEach((f, k) => { if (f !== blob.fuel[k]) out.push(`step ${k}: qm spends ${show(f)} fuel, the plain asset's piece ${show(blob.fuel[k])}`); });
  piece.arrays.forEach((a, k) => { if (a !== blob.arrays[k]) out.push(`step ${k}: qm leaves ${a}, the plain asset's piece ${blob.arrays[k]}`); });
  return out;
}
/** The piece, its plain-asset twin and the planted per-frame validation: what each frame gains. */
function frameGaps(workshop: Packed): string[] {
  const qm = qmProgram();
  const atlas = stripAtlas();
  const atlasSha = sha256(atlas);
  const bytes = [qm.bytes, atlas, workshop.bytes];
  const piece = play(storesDoc(qm, atlasSha, workshop.sha, true), bytes, DOC(1), 'stores, naming the workshop as a catalog');
  const blob = play(storesDoc(qm, atlasSha, workshop.sha, false), bytes, DOC(2), 'stores, with the same bytes as a plain data asset');
  const gaps: string[] = [];
  for (const [p, which] of [[piece, 'the catalog'], [blob, 'the plain asset']] as const) {
    const off = p.values.map((v, k) => [k, v] as const).filter(([, v]) => v !== READ_VALUE);
    if (off.length) gaps.push(`with ${which}, qm's value isn't ${READ_VALUE}, ${READ_ITEM}'s value read by hash from the bytes in its memory, at step ${off[0]![0]} (${show(off[0]![1])}): the piece read no catalog`);
  }
  const fuel = piece.fuel.filter((f) => typeof f !== 'number' || f <= 0);
  if (fuel.length) gaps.push(`deep_query's bake of qm reports no fuel spent for ${fuel.length} of its ${STEPS} steps, so its steps' work can't be compared`);
  gaps.push(...gained(piece, blob, workshop.sha));
  // The wrong program the clause names: the same judgement must fail it, naming the sandbox's runs and the catalog.
  try {
    const planted = play(storesDoc(qm, atlasSha, workshop.sha, true), bytes, DOC(3), 'stores, planted catalog_validated_per_frame', 'catalog_validated_per_frame');
    failsNaming(gained(planted, blob, workshop.sha), [/sandbox/, /runs/, new RegExp(workshop.sha)], 'catalog_validated_per_frame, the catalog validated again at every frame');
  } catch (e) {
    gaps.push(`the planted catalog_validated_per_frame: ${(e as Error).message.split('\n').filter((l) => l.trim() !== '').slice(0, 8).join(' | ')}`);
  }
  return gaps;
}

// ---------------------------------------------------------------------------------------------------
// The record, and the leg runner.

async function recordGaps(): Promise<string[]> {
  const gaps: string[] = [];
  const budgets = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as JsonObject;
  const found = arr(budgets['tasks'], 'budgets.json: tasks').filter(isObject).find((t) => t['id'] === TASK.id);
  if (!found) gaps.push(`benchmarks/budgets.json has no task ${TASK.id} for the perf lane and the budget window to compare with the merge base`);
  else {
    for (const k of ['command', 'margin', 'targets'] as const) if (!isDeepStrictEqual(found[k], TASK[k])) gaps.push(`${TASK.id}.${k} is ${show(found[k])}, not ${show(TASK[k])}`);
    if (!(Array.isArray(found['criteria']) && found['criteria'].includes(ID))) gaps.push(`${TASK.id}.criteria doesn't name ${ID}`);
    if (!/#194\b/.test(String(found['initialReason'] ?? ''))) gaps.push(`${TASK.id}.initialReason doesn't name #194`);
  }
  try { await validateBudgets(budgets, { tasks: [] }); } catch (e) { gaps.push(`the lane's validator refuses benchmarks/budgets.json: ${(e as Error).message}`); }
  const lanes = (await import(join(REPO, 'scripts', 'lanes.mjs'))) as { timed: string[] };
  if (!lanes.timed.includes(FILE)) gaps.push(`scripts/lanes.mjs doesn't run ${FILE} as a timed file`);
  return gaps;
}
/** A leg's result, or its failure as a gap, so one run names everything missing. */
async function leg<T>(gaps: string[], what: string, run: () => T | Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (e) {
    gaps.push(`${what}: ${(e as Error).message.split('\n').filter((l) => l.trim() !== '').slice(0, 14).join(' | ')}`);
    return undefined;
  }
}
/** A warm-up, then five readings, each with the load at its start and end. */
async function readings(read: () => number | Promise<number>): Promise<{ runs: number[]; loads: { start: number; end: number }[] }> {
  await read();
  const runs: number[] = [];
  const loads: { start: number; end: number }[] = [];
  for (let n = 0; n < RUNS; n++) {
    const start = load();
    runs.push(await read());
    loads.push({ start, end: load() });
  }
  return { runs, loads };
}

describe(`AC11 ${ID} the budgets: packing, catalog.reach and catalog.economy, and no work per frame`, () => {
  it(`AC11 ${ID} what each budget times, no work per frame for a piece that names a catalog, the record; on a reference Mac at rest, packing 10,000 rows of 20 columns under 1 s and catalog.reach and catalog.economy over 5,000 recipes each under 200 ms`, async () => {
    const gaps: string[] = [];
    const dir = temp();
    const debug = catalogBin(false);
    if (debug.error) gaps.push(`deep-catalog doesn't build, so nothing is packed: ${debug.error}`);
    const plugin = existsSync(join(CATALOG_DIR, 'deepbuild.json'));
    if (!plugin) gaps.push(`the catalog plug-in ${CATALOG_ID} isn't at packages/checks/catalog (no deepbuild.json), so catalog.reach and catalog.economy can't run`);
    const partsFiles = writeParts(dir);
    const workshopFiles = writeWorkshop(dir);
    let workshop: Packed | undefined;
    let host: Host | undefined;
    if (!debug.error) {
      await leg(gaps, 'packing 10,000 rows of 20 columns (debug)', () => packParts(debug.bin, partsFiles, dir, 'parts'));
      workshop = await leg(gaps, 'packing the 5,000-recipe workshop (debug)', () => {
        const p = pack(debug.bin, workshopFiles, WORKSHOP_SCHEMA, join(dir, 'workshop.tbl'), 'workshop');
        const t = tablesOf(p.record, 'workshop');
        expect(Object.fromEntries(Object.entries(t).map(([n, x]) => [n, x.rows])), 'workshop: the four tables with their rows').toEqual(WORKSHOP_ROWS);
        return p;
      });
    }
    if (workshop && plugin) {
      host = await leg(gaps, `${CATALOG_ID} in an extension host`, () => openCatalogHost());
      if (host) {
        const h = host;
        const w = workshop;
        await leg(gaps, 'catalog.reach over 5,000 recipes', () => runKind(h, 'catalog.reach', 'reach', REACH(w.sha), w, 'catalog.reach'));
        await leg(gaps, 'catalog.economy over 5,000 recipes', () => runKind(h, 'catalog.economy', 'economy', ECONOMY(w.sha), w, 'catalog.economy'));
      }
    }
    if (workshop) {
      const w = workshop;
      const perFrame = await leg(gaps, 'a piece that names a catalog', () => frameGaps(w));
      if (perFrame) gaps.push(...perFrame);
    }
    gaps.push(...(await recordGaps()));
    none(gaps, `${ID}: what the budgets time, no work per frame, and the record`);

    // The timings, only where the lane can judge them.
    const gate = await judgeLimit(1, Array.from({ length: RUNS }, () => 0), Array.from({ length: RUNS }, () => ({ start: load(), end: load() })));
    if (gate['status'] !== 'PASS') inconclusive(`the budgets are judged only on a reference Mac at rest: ${String(gate['reason'])}`);
    const release = catalogBin(true);
    expect(release.error, 'deep-catalog builds for release').toBe('');
    const h = host!;
    const w = workshop!;
    const judged: [string, number, JsonObject][] = [];
    const pk = await readings(() => packParts(release.bin, partsFiles, dir, 'parts (release)').ms);
    judged.push(['packing 10,000 rows of 20 columns (ms)', TASK.targets.pack_10000_rows_ms, await judgeLimit(TASK.targets.pack_10000_rows_ms, pk.runs, pk.loads)]);
    const rc = await readings(() => runKind(h, 'catalog.reach', 'reach', REACH(w.sha), w, 'catalog.reach (timed)'));
    judged.push(['catalog.reach over 5,000 recipes (ms)', TASK.targets.reach_5000_recipes_ms, await judgeLimit(TASK.targets.reach_5000_recipes_ms, rc.runs, rc.loads)]);
    const ec = await readings(() => runKind(h, 'catalog.economy', 'economy', ECONOMY(w.sha), w, 'catalog.economy (timed)'));
    judged.push(['catalog.economy over 5,000 recipes (ms)', TASK.targets.economy_5000_recipes_ms, await judgeLimit(TASK.targets.economy_5000_recipes_ms, ec.runs, ec.loads)]);
    for (const [what, limit, j] of judged) {
      console.log(`${ID} ${what}: ${show(j['runs'])} against ${limit} → ${String(j['status'])}`);
      expect(j['status'], `${what} within ${limit}: ${show(j)}`).not.toBe('FAIL');
    }
    const open = judged.filter(([, , j]) => j['status'] !== 'PASS');
    if (open.length) inconclusive(open.map(([what, , j]) => `${what}: ${show(j)}`).join('; '));
  }, 4 * TIMEOUT);
});
