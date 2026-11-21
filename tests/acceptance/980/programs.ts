// This suite's logic programs, as an agent would write them, in WebAssembly text: relocatable objects (#190's README:
// Relocatable objects) that import process@1's exports through the interface (`lib:process@1`, #416) or by a library's
// own name (`lib:<name>`, #190), assembled by #416's arrangement of #190's assembler (../416/interfaces/wat.ts), as
// #981's suite assembles its own. Each one writes the header (README: The header), builds its scene's model at init in
// the scene's order (README: Exports), and at each step makes the scene's release calls, then calls `stats` once, which
// writes process@1's arrays at the start of its write region (README: Arrays). The warehouse program then writes its own
// drawing arrays after them, from them.

import type { Layout, Program } from '../190/helpers.ts';
import { entryAt } from '../190/helpers.ts';
import { assemble } from '../416/interfaces/wat.ts';
import { WAREHOUSE_ST, shape, stationCount, type Build, type Scene } from './scenes.ts';

/** A program's memory (README: Memory): 0 reads, 4096 writes, 256 KiB its variables, 320 KiB its data (the libraries' after it), 1 MiB the process state (at most 4 MiB); 8 MiB in all. */
export const WRITES_AT = 4096, VARS_AT = 256 * 1024, DATA_AT = 320 * 1024, STATE_AT = 1 << 20, PAGES = 128;
export const MEMORY_MIB = 8;

type WriteType = 'bool' | 'i32' | 'f64';
export type Writes = Record<string, { type: WriteType; count: number }>;
/**
 * process@1's arrays for a scene, in the order and types the library writes them (README: Arrays), then `more`. A
 * model with no resource writes one, never busy, of capacity 0 (README: Arrays: counts).
 */
export function processWrites(s: Scene, more: Writes = {}): Writes {
  const E = s.rows, K = s.kinds.length, N1 = stationCount(s) + 1, R = Math.max(shape(s).resources, 1), M = s.ring;
  const w = (type: WriteType, count: number) => ({ type, count });
  return {
    kind: w('i32', E), gen: w('i32', E), at: w('i32', E), batch: w('i32', E), holds: w('i32', E), rank: w('i32', E), made: w('f64', E), d: w('f64', E),
    made_n: w('i32', K), out_n: w('i32', K),
    count: w('i32', N1), left: w('i32', N1), area: w('f64', N1), dwell: w('f64', N1),
    busy: w('i32', R), cap: w('i32', R), busy_area: w('f64', R),
    thru: w('f64', N1), mean: w('f64', N1), p90: w('f64', N1), wip: w('f64', N1),
    clock: w('f64', 3), rec_n: w('i32', 1), rec_t: w('f64', M), rec_w: w('f64', M),
    ...more,
  };
}
const SIZE: Record<WriteType, number> = { bool: 4, i32: 4, f64: 8 };
const align8 = (n: number): number => Math.ceil(n / 8) * 8;
/** Where each array starts in the write region (the region map's rule: declaration order, each entry 8-aligned). */
export function offsets(writes: Writes): Record<string, number> {
  let at = 0;
  const out: Record<string, number> = {};
  for (const [name, w] of Object.entries(writes)) { out[name] = at; at = align8(at + SIZE[w.type] * w.count); }
  return out;
}
/** The whole write region's size. */
export const regionSize = (writes: Writes): number => { const o = offsets(writes); const last = Object.keys(writes).at(-1)!; return o[last]! + SIZE[writes[last]!.type] * writes[last]!.count; };

const SIG = {
  source: '(param i32 i32 f64 f64 i32 f64 i32) (result i32)',
  queue: '(param i32 i32 i32 i32) (result i32)',
  resource: '(param i32 i32) (result i32)',
  request: '(param i32 i32 i32 f64 f64 i32) (result i32)',
  release: '(param i32 i32) (result i32)',
  conveyor: '(param i32 f64 f64 f64 i32) (result i32)',
  pack: '(param i32 i32 i32 i32) (result i32)',
  unpack: '(param i32 i32 i32) (result i32)',
  sink: '(param i32) (result i32)',
  stats: '(param i32 i32 i32)',
} as const;
export type ExportName = keyof typeof SIG;
/** process@1's exports with their signatures (README: Exports). */
export const EXPORTS = (Object.keys(SIG) as ExportName[]).map((name) => {
  const m = /\(param ([^)]*)\)(?: \(result ([^)]*)\))?/.exec(SIG[name])!;
  return { name, params: m[1]!.split(' '), results: m[2] ? m[2].split(' ') : [] };
});

const tag = (s: string): string => s.replace(/[^a-z0-9]/gi, '_');
const f = (x: number): string => (Number.isInteger(x) ? `${x}.0` : String(x));
const S = `(i32.const ${STATE_AT})`;
const dataText = (b: Buffer): string => Array.from(b, (x) => `\\${x.toString(16).padStart(2, '0')}`).join('');

/** The tables a scene's sources read (README: Exports: source's `at`), laid out from DATA_AT, and each one's address. */
function tables(s: Scene): { bytes: Buffer; at: Map<Build, number> } {
  const parts: Buffer[] = [];
  const at = new Map<Build, number>();
  let off = DATA_AT;
  for (const b of s.build) {
    if (b.op !== 'source' || !b.at) continue;
    const t = Buffer.alloc(8 + 8 * b.at.length);
    t.writeUInt32LE(b.at.length, 0);
    b.at.forEach((x, i) => t.writeDoubleLE(x, 8 + 8 * i));
    at.set(b, off);
    parts.push(t);
    off += t.length;
  }
  return { bytes: parts.length ? Buffer.concat(parts) : Buffer.from([0]), at };
}
/** One builder call (README: Exports), its result dropped: the scene numbers its stations itself. */
function call(b: Build, table: Map<Build, number>): string {
  switch (b.op) {
    case 'source': return `(call $source ${S} (i32.const ${b.kind}) (f64.const ${f(b.every ?? 0)}) (f64.const ${f(b.mean_gap ?? 0)}) (i32.const ${table.get(b) ?? -1}) (f64.const ${f(b.until ?? -1)}) (i32.const ${b.to}))`;
    case 'queue': return `(call $queue ${S} (i32.const ${b.order ?? 0}) (i32.const ${b.capacity ?? -1}) (i32.const ${b.to}))`;
    case 'resource': return `(call $resource ${S} (i32.const ${b.capacity}))`;
    case 'request': return `(call $request ${S} (i32.const ${b.r}) (i32.const ${b.n}) (f64.const ${f(b.mean_hold ? 0 : b.hold ?? -1)}) (f64.const ${f(b.mean_hold ?? 0)}) (i32.const ${b.to}))`;
    case 'conveyor': return `(call $conveyor ${S} (f64.const ${f(b.length)}) (f64.const ${f(b.speed)}) (f64.const ${f(b.spacing)}) (i32.const ${b.to}))`;
    case 'pack': return `(call $pack ${S} (i32.const ${b.n}) (i32.const ${b.into}) (i32.const ${b.to}))`;
    case 'unpack': return `(call $unpack ${S} (i32.const ${b.members}) (i32.const ${b.carrier}))`;
    case 'sink': return `(call $sink ${S})`;
  }
}
/** init: the header (README: The header), then the scene's builders in order. */
function init(s: Scene, table: Map<Build, number>): string {
  return `
  (func (export "init") (param $seed i64)
    (f64.store ${S} (f64.const ${f(s.tick)}))
    (i64.store offset=8 ${S} (local.get $seed))
    (i32.store offset=16 ${S} (i32.const ${s.rows}))
    (i32.store offset=20 ${S} (i32.const ${s.kinds.length}))
    (i32.store offset=24 ${S} (i32.const ${s.ring}))
    (f64.store offset=32 ${S} (f64.const ${f(s.window ?? 3600)}))
    (f64.store offset=40 ${S} (f64.const ${f(s.warmup ?? 0)}))${s.build.map((b) => `
    (drop ${call(b, table)})`).join('')})`;
}
const head = (module: string, uses: ExportName[]): string => `
(module
  (import "env" "__linear_memory" (memory ${PAGES} ${PAGES}))
${uses.map((n) => `  (import "${module}" "${n}" (func $${n} ${SIG[n]}))`).join('\n')}
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))`;
const builders = (s: Scene): ExportName[] => [...new Set(s.build.map((b) => b.op))];

/**
 * A scene's program: init builds the model; step k makes the scene's release calls for k, then stats(n = the scene's
 * ticks a step, out = writes_at). `module` is `lib:process@1` (the interface) or `lib:<library>` (a library's own name).
 */
export function sceneProgram(s: Scene, module: string): Program {
  const t = tables(s);
  const uses: ExportName[] = [...builders(s), ...(s.releases?.length ? ['release' as const] : []), 'stats'];
  const releases = (s.releases ?? []).map((r) => `
    (if (i64.eq (local.get $k) (i64.const ${r.at})) (then (drop (call $release ${S} (i32.const ${r.e})))))`).join('');
  return assemble(`scene_${tag(s.name)}_${tag(module)}`, `${head(module, uses)}${init(s, t.at)}
  (func (export "step") (param $k i64)${releases}
    (call $stats ${S} (i32.const ${s.ticksPerStep}) (i32.const ${WRITES_AT})))
  (data (i32.const ${DATA_AT}) "${dataText(t.bytes)}"))`, 'program');
}

/** Criterion 9's frame cost alone: the same writes and the same model built, and a step that calls nothing. */
export function idleProgram(s: Scene, module: string): Program {
  const t = tables(s);
  return assemble(`idle_${tag(s.name)}_${tag(module)}`, `${head(module, builders(s))}${init(s, t.at)}
  (func (export "step") (param $k i64))
  (data (i32.const ${DATA_AT}) "${dataText(t.bytes)}"))`, 'program');
}

// ---------------------------------------------------------------------------------------------------
// The warehouse (criteria 7 and 10): after stats, the program writes where each case draws (README: The warehouse).

/** The page (u, y down) and where each station's cases draw. */
export const PAGE: [number, number] = [720, 300];
export const DRAW = {
  inbound: { x: 140, step: 16, y: 170, rowStep: 18, perRow: 8 }, belt: { x: 160, perM: 30, y: 170 }, dock: { x: 478, step: 18, y: 170 },
  forks: { x: 648, y: 150, step: 40 },
} as const;
/** The warehouse's own arrays after process@1's: each row's draw point, its tile and whether it draws. */
export const warehouseWrites = (s: Scene): Writes => processWrites(s, {
  x: { type: 'f64', count: s.rows }, y: { type: 'f64', count: s.rows }, tile: { type: 'i32', count: s.rows }, show: { type: 'bool', count: s.rows },
});
/** Tiles: 0 a case waiting in a queue, 1 a case on the belt, 2 a case a forklift carries. */
export const TILES = { waiting: 0, belt: 1, carried: 2 } as const;

export function warehouseProgram(s: Scene, module: string, l: Layout): Program {
  const t = tables(s);
  const w = (name: string): number => WRITES_AT + entryAt(l, 'writes', name);
  const [AT, RANK, D, X, Y, TILE, SHOW] = ['at', 'rank', 'd', 'x', 'y', 'tile', 'show'].map(w) as [number, number, number, number, number, number, number];
  const st = WAREHOUSE_ST;
  const i4 = (base: number) => `(i32.add (i32.const ${base}) (i32.shl (local.get $r) (i32.const 2)))`;
  const i8 = (base: number) => `(i32.add (i32.const ${base}) (i32.shl (local.get $r) (i32.const 3)))`;
  const place = (x: string, y: string, tile: number) => `(local.set $x ${x}) (local.set $y ${y}) (local.set $t (i32.const ${tile})) (local.set $v (i32.const 1))`;
  const rank = '(f64.convert_i32_s (local.get $rank))';
  return assemble(`warehouse_${tag(module)}_${X}`, `${head(module, [...builders(s), 'stats'])}${init(s, t.at)}
  (func (export "step") (param $k i64) (local $r i32) (local $at i32) (local $rank i32) (local $x f64) (local $y f64) (local $t i32) (local $v i32)
    (call $stats ${S} (i32.const ${s.ticksPerStep}) (i32.const ${WRITES_AT}))
    (loop $rows
      (local.set $at (i32.load ${i4(AT)}))
      (local.set $rank (i32.load ${i4(RANK)}))
      (local.set $x (f64.const 0)) (local.set $y (f64.const 0)) (local.set $t (i32.const 0)) (local.set $v (i32.const 0))
      (if (i32.eq (local.get $at) (i32.const ${st.inbound}))
        (then ${place(`(f64.sub (f64.const ${f(DRAW.inbound.x)}) (f64.mul (f64.const ${f(DRAW.inbound.step)}) (f64.convert_i32_s (i32.rem_s (local.get $rank) (i32.const ${DRAW.inbound.perRow})))))`,
          `(f64.sub (f64.const ${f(DRAW.inbound.y)}) (f64.mul (f64.const ${f(DRAW.inbound.rowStep)}) (f64.convert_i32_s (i32.div_s (local.get $rank) (i32.const ${DRAW.inbound.perRow})))))`, TILES.waiting)}))
      (if (i32.eq (local.get $at) (i32.const ${st.belt}))
        (then ${place(`(f64.add (f64.const ${f(DRAW.belt.x)}) (f64.mul (f64.const ${f(DRAW.belt.perM)}) (f64.load ${i8(D)})))`, `(f64.const ${f(DRAW.belt.y)})`, TILES.belt)}))
      (if (i32.eq (local.get $at) (i32.const ${st.dock}))
        (then ${place(`(f64.add (f64.const ${f(DRAW.dock.x)}) (f64.mul (f64.const ${f(DRAW.dock.step)}) ${rank}))`, `(f64.const ${f(DRAW.dock.y)})`, TILES.waiting)}))
      (if (i32.eq (local.get $at) (i32.const ${st.forks}))
        (then ${place(`(f64.const ${f(DRAW.forks.x)})`, `(f64.add (f64.const ${f(DRAW.forks.y)}) (f64.mul (f64.const ${f(DRAW.forks.step)}) ${rank}))`, TILES.carried)}))
      (f64.store ${i8(X)} (local.get $x))
      (f64.store ${i8(Y)} (local.get $y))
      (i32.store ${i4(TILE)} (local.get $t))
      (i32.store ${i4(SHOW)} (local.get $v))
      (local.set $r (i32.add (local.get $r) (i32.const 1)))
      (br_if $rows (i32.lt_u (local.get $r) (i32.const ${s.rows})))))
  (data (i32.const ${DATA_AT}) "${dataText(t.bytes)}"))`, 'program');
}
