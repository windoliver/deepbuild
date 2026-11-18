// This suite's fixtures (README: Fixtures): the crawler's walled-exit and key-in-vault twins, the 64 × 64 flow fixture
// and its two twins, the 6 × 6 hex fixture, and #1048's 2-layer map with its no-teleporter twin. Each is a logic item in
// WebAssembly text assembled by #533's assembler (#555's helper builds it from a copy). The clean crawler is #555's
// (its programs.ts, read only), and the crawler twins are its own text (crawlerText) with one planted change each; the
// map is a copy of #1048's map text whose links are a parameter, and ac06 checks the copy with both links assembles to
// #1048's map byte for byte. Region offsets come from `deep-logic check` of a probe with each piece's controls, reads
// and writes, so every program reads and writes where the logic module lays its entries out.
import { expect } from 'vitest';
import { checkCall, onLogic } from '../533/helpers.ts';
import { CLASS, CONTROLS, DESCENDER, READS, SIZE, crawlerPiece, crawlerText, writesOf } from '../555/programs.ts';
import { LINKS, MAP, idx, mapCells } from '../1048/programs.ts';
import { assemble, type Obj } from './helpers.ts';
import type { Program } from '../533/helpers.ts';

export type { Program };
export { CLASS, SIZE };

// ---------------------------------------------------------------------------------------------------
// Layouts, from the logic module's own check.

interface Entry { region: string; name: string; offset: number; size: number }
const layouts = new Map<string, Entry[]>();
const head = (pages: number, readsAt: number, writesAt: number): string => `(memory (export "memory") ${pages} ${pages})
  (global (export "reads_at") i32 (i32.const ${readsAt}))
  (global (export "writes_at") i32 (i32.const ${writesAt}))`;
/** The layout `deep-logic check` gives a piece with these controls, reads and writes (its program a probe). */
function layoutOf(key: string, controls: Obj, reads: string[], writes: Obj, readsAt: number, writesAt: number, state: number): Entry[] {
  const known = layouts.get(key);
  if (known) return known;
  const probe = assemble(`probe556_${key}`, `(module ${head(2, readsAt, writesAt)} (func (export "init") (param $seed i64)) (func (export "step") (param $k i64)))`);
  const p = {
    seed: 556, class: 'figure', controls,
    items: { probe: { kind: 'logic@1', params: { program: probe.sha, step_rate: 60, reads, writes } } },
    assets: { [probe.sha]: probe.b64 },
  };
  const [reply] = onLogic([checkCall(p as never)]) as Obj[];
  expect(reply?.['ok'], `deep-logic check takes ${key}'s layout probe: ${JSON.stringify(reply).slice(0, 1500)}`).toBe(true);
  const entries = reply!['items']['probe']['layout']['entries'] as Entry[];
  const end = (region: string): number => Math.max(0, ...entries.filter((e) => e.region === region).map((e) => e.offset + e.size));
  expect(readsAt + end('reads'), `${key}: the read region ends before writes_at`).toBeLessThanOrEqual(writesAt);
  expect(writesAt + end('writes'), `${key}: the write region ends before the program's own state`).toBeLessThanOrEqual(state);
  layouts.set(key, entries);
  return entries;
}
function at(entries: Entry[], region: 'reads' | 'writes', name: string): number {
  const e = entries.find((x) => x.region === region && x.name === name);
  if (!e) throw Error(`the layout has no ${region} entry ${name}: ${JSON.stringify(entries)}`);
  return e.offset;
}
/** `text` with `anchor`, which must occur in it exactly once, replaced by `by`. */
function swap(text: string, anchor: string, by: string): string {
  const parts = text.split(anchor);
  if (parts.length !== 2) throw Error(`the anchor occurs ${parts.length - 1} times, not once: ${anchor}`);
  return parts.join(by);
}

// ---------------------------------------------------------------------------------------------------
// The crawler's twins: #555's crawler text with one planted change each.

/**
 * `walled`: init reads its own seed and, when that seed is 0 modulo 50 (1 seed in 50), every floor it generates has its
 * exit room (room R − 2) ringed with blocked cells, so the exit and everything behind the room can't be reached; it
 * publishes `walled` (1 on such a seed), this suite's own reading. `vault`: the key is put inside the vault (room R − 1),
 * the room its lock closes, in place of a room between; nothing else changes.
 */
export type CrawlerTwin = 'clean' | 'walled' | 'vault';
/** One run seed in this many walls its exit rooms (the walled twin, on the seed its init gets). */
export const WALLED_ONE_IN = 50;
/**
 * The walled twin's own document seed: run 87's of the check seed 3556 (runSeed(3556, 87)), a seed that walls, so a
 * play that keeps the document's seed walls every run (criterion 3).
 */
export const WALLED_DOC_SEED = 4307912556001750;

const C_READS_AT = 0;
const C_WRITES_AT = 40960;
/** #555's crawler's own state (its programs.ts): the rng at STATE, `dead` at STATE + 36; this suite's flag at STATE + 128, which the crawler leaves free. */
const C_STATE = 49152;
const C_RNG = C_STATE;
const C_DEAD = C_STATE + 36;
const C_WALLED = C_STATE + 128;

/** The twin's arrays: the clean crawler's, and the walled twin's own `walled` reading after them. */
export function crawlerWrites(v: CrawlerTwin): Obj {
  return { ...writesOf('clean'), ...(v === 'walled' ? { walled: { type: 'i32' } } : {}) };
}
/** The twin's program, assembled; its read and write offsets from `deep-logic check` of its own reads and writes. */
export function crawlerTwinProgram(v: CrawlerTwin): Program {
  const l = layoutOf(`crawler_${v}`, CONTROLS, READS, crawlerWrites(v), C_READS_AT, C_WRITES_AT, C_STATE);
  const AIM = C_READS_AT + at(l, 'reads', 'aim');
  const WAIT = C_READS_AT + at(l, 'reads', 'wait_key');
  const STAIRS = C_READS_AT + at(l, 'reads', 'stairs');
  const W = (name: string): number => C_WRITES_AT + at(l, 'writes', name);
  return assemble(`crawler556_${v}_${AIM}_${WAIT}_${STAIRS}_${W('grid')}`, crawlerTwinText(v, AIM, WAIT, STAIRS, W));
}
/** The twin's WebAssembly text: #555's clean crawler text (crawlerText), with the twin's change. */
export function crawlerTwinText(v: CrawlerTwin, AIM: number, WAIT: number, STAIRS: number, W: (name: string) => number): string {
  let text = crawlerText('clean', AIM, WAIT, STAIRS, W);
  if (v === 'walled') {
    // The seed init gets decides: 1 seed in 50 walls every floor's exit room.
    const seeded = `(i64.store (i32.const ${C_RNG}) (i64.xor (local.get $seed) (i64.const 0x2545f4914f6cdd1d)))`;
    text = swap(text, seeded, `${seeded}
    (i32.store (i32.const ${C_WALLED}) (i64.eqz (i64.rem_u (local.get $seed) (i64.const ${WALLED_ONE_IN}))))`);
    // Room p's ring, from (x0 − 1, y0 − 1) to (x0 + w, y0 + h), blocked on floor f.
    text = swap(text, '(func $gen (param $f i32)', `(func $wall (param $f i32) (param $p i32)
    (local $x i32) (local $y i32) (local $x0 i32) (local $y0 i32) (local $x1 i32) (local $y1 i32)
    (local.set $x0 (i32.sub (call $room (local.get $p) (i32.const 0)) (i32.const 1)))
    (local.set $y0 (i32.sub (call $room (local.get $p) (i32.const 1)) (i32.const 1)))
    (local.set $x1 (i32.add (call $room (local.get $p) (i32.const 0)) (call $room (local.get $p) (i32.const 2))))
    (local.set $y1 (i32.add (call $room (local.get $p) (i32.const 1)) (call $room (local.get $p) (i32.const 3))))
    (local.set $y (local.get $y0))
    (loop $rows
      (local.set $x (local.get $x0))
      (loop $cols
        (if (i32.or (i32.or (i32.eq (local.get $x) (local.get $x0)) (i32.eq (local.get $x) (local.get $x1)))
                    (i32.or (i32.eq (local.get $y) (local.get $y0)) (i32.eq (local.get $y) (local.get $y1))))
          (then (call $put (local.get $f) (local.get $x) (local.get $y) (i32.const ${CLASS.blocked}))))
        (local.set $x (i32.add (local.get $x) (i32.const 1)))
        (br_if $cols (i32.le_s (local.get $x) (local.get $x1))))
      (local.set $y (i32.add (local.get $y) (i32.const 1)))
      (br_if $rows (i32.le_s (local.get $y) (local.get $y1)))))
  (func $gen (param $f i32)`);
    // At the end of each floor's generation: the exit room (R − 2) walled on a walled seed.
    const last = '(i32.store offset=16 (local.get $m) (local.get $R)))';
    text = swap(text, last, `(i32.store offset=16 (local.get $m) (local.get $R))
    (if (i32.load (i32.const ${C_WALLED})) (then (call $wall (local.get $f) (i32.sub (local.get $R) (i32.const 2))))))`);
    const dead = `(i32.store (i32.const ${W('dead')}) (i32.load (i32.const ${C_DEAD})))`;
    text = swap(text, dead, `${dead}
    (i32.store (i32.const ${W('walled')}) (i32.load (i32.const ${C_WALLED})))`);
  }
  if (v === 'vault') {
    // The key in the vault, room R − 1, behind the one locked cell its own lock holds shut.
    text = swap(text, '(local.set $cell (call $inside (i32.add (i32.const 1) (call $rnd (i32.sub (local.get $R) (i32.const 3))))))',
      '(local.set $cell (call $inside (i32.sub (local.get $R) (i32.const 1))))');
  }
  return text;
}
/** A crawler twin as the replica takes it: #555's crawler piece with the twin's program and arrays, its document's seed `seed`. */
export function crawlerTwinPiece(program: Program, v: CrawlerTwin, seed: number): Obj {
  const p = crawlerPiece(program, 'clean');
  p['seed'] = seed;
  p['items']['crawler']['params']['writes'] = crawlerWrites(v);
  return p;
}
export const WALLED_PATH = 'crawler.walled';
/** The playtest grid.reach names on the crawler and its twins (criteria 1 and 3): 200 descender runs of 150 steps, each from its own seed. */
export const CRAWLER_RUNS = { seed: 3556, runs: 200, span: 150 } as const;
export function descenderInput(piece: string, play: Obj, runs: number = CRAWLER_RUNS.runs): Obj {
  return {
    piece, play, bots: [DESCENDER], runs, seed: CRAWLER_RUNS.seed, span: { steps: CRAWLER_RUNS.span }, goals: [], piece_seed: 'run', frames: { every: 0 },
  };
}
/** grid.reach's input on those runs (criterion 1): the exit and every open cell, depths 1 and 2 generated. */
export const CRAWLER_REACH = { playtest: 'R-floors', goals: ['exit'], every: ['open'], depths: [1, 2] } as const;

// ---------------------------------------------------------------------------------------------------
// The flow fixture (criterion 2): 64 × 64 cells, a core of exit cells at the centre, spawns on the edges.

/**
 * The flow fixture's geometry: the core (class exit) is the 2 × 2 block at x 31 to 32, y 31 to 32; every other cell is
 * open until the wall entry, which blocks row y 16 from x 16 to x 47. The clean program refreshes its field 4 steps
 * after the wall (inside the brief's lag of 8); the stale twin never does; the rising twin, from step 300, steps the
 * cell (10, 40) west, to a neighbour whose cost is one higher.
 */
export const FLOW = {
  id: 'flow', size: 64, open: 0, blocked: 1, exit: 5,
  core: [[31, 31], [32, 31], [31, 32], [32, 32]] as const,
  wall: { y: 16, x0: 16, x1: 47 },
  /** The policy's wall entry, at 10 s on the 60 Hz clock: step 600. */
  wallAt: 600, wallKeyS: 10, refreshAfter: 4, lag: 8,
  rising: { cell: [10, 40] as const, at: 300 },
  span: 640,
} as const;
export const FLOW_SPAWNS: [number, number][] = [[0, 0], [32, 0], [63, 0], [0, 32], [63, 32], [0, 63], [32, 63], [63, 63]];
export type FlowTwin = 'clean' | 'stale' | 'rising';
const F_CONTROLS: Obj = { wall: { kind: 'slider', range: [0, 1], increment: 1, default: 0 } };
const F_READS = ['wall'];
const F_N = FLOW.size * FLOW.size;
const F_WRITES: Obj = { cells: { type: 'i32', count: F_N }, next: { type: 'i32', count: F_N }, cost: { type: 'i32', count: F_N }, walls: { type: 'i32' } };
const F_READS_AT = 0;
const F_WRITES_AT = 1024;
const F_STATE = 65536;
const F = { queue: F_STATE, refreshAt: F_STATE + 4 * F_N, walls: F_STATE + 4 * F_N + 8, planted: F_STATE + 4 * F_N + 12 };
/** Fuel a step may use: a refresh is one breadth-first search over 4,096 cells. */
const F_FUEL = 8_000_000;

/**
 * The flow fixture's program. `init` writes the cells (open, the core exit) and the field. Each step, an entry on the
 * `wall` slider blocks the wall's cells and (but in the stale twin) sets a refresh `refreshAfter` steps later; at that
 * step the field is computed again. The field: a breadth-first search from the core over the cells that aren't
 * blocked; `cost` the distance (−1 where none reaches), `next` the neighbour of lowest cost, ties to the first of
 * north, east, south and west, −1 on the core and where none is lower. It publishes `cells`, `next`, `cost` and
 * `walls` (the wall entries it took).
 */
export function flowProgram(v: FlowTwin): Program {
  const l = layoutOf('flow', F_CONTROLS, F_READS, F_WRITES, F_READS_AT, F_WRITES_AT, F_STATE);
  const WALL = F_READS_AT + at(l, 'reads', 'wall');
  const W = (name: string): number => F_WRITES_AT + at(l, 'writes', name);
  const CELLS = W('cells');
  const NEXT = W('next');
  const COST = W('cost');
  const cellAt = (x: number, y: number): number => y * FLOW.size + x;
  const rc = cellAt(FLOW.rising.cell[0], FLOW.rising.cell[1]);
  const core = FLOW.core.map(([x, y]) => `(i32.store (i32.const ${CELLS + 4 * cellAt(x, y)}) (i32.const ${FLOW.exit}))`).join('\n    ');
  const text = `
(module
  ${head(2, F_READS_AT, F_WRITES_AT)}
  (func $cls (param $i i32) (result i32)
    (i32.load (i32.add (i32.const ${CELLS}) (i32.shl (local.get $i) (i32.const 2)))))
  (func $cost (param $i i32) (result i32)
    (i32.load (i32.add (i32.const ${COST}) (i32.shl (local.get $i) (i32.const 2)))))
  ;; Neighbour k of cell i: 0 north, 1 east, 2 south, 3 west; -1 off the grid.
  (func $nb (param $i i32) (param $k i32) (result i32) (local $x i32) (local $y i32)
    (local.set $x (i32.and (local.get $i) (i32.const ${FLOW.size - 1})))
    (local.set $y (i32.shr_u (local.get $i) (i32.const 6)))
    (if (i32.eq (local.get $k) (i32.const 0)) (then (return (select (i32.sub (local.get $i) (i32.const ${FLOW.size})) (i32.const -1) (i32.gt_u (local.get $y) (i32.const 0))))))
    (if (i32.eq (local.get $k) (i32.const 1)) (then (return (select (i32.add (local.get $i) (i32.const 1)) (i32.const -1) (i32.lt_u (local.get $x) (i32.const ${FLOW.size - 1}))))))
    (if (i32.eq (local.get $k) (i32.const 2)) (then (return (select (i32.add (local.get $i) (i32.const ${FLOW.size})) (i32.const -1) (i32.lt_u (local.get $y) (i32.const ${FLOW.size - 1}))))))
    (select (i32.sub (local.get $i) (i32.const 1)) (i32.const -1) (i32.gt_u (local.get $x) (i32.const 0))))
  ;; The planted cell steps west, to a neighbour whose cost is higher (the rising twin).
  (func $plant
    (i32.store (i32.const ${NEXT + 4 * rc}) (i32.const ${rc - 1})))
  (func $field (local $i i32) (local $head i32) (local $tail i32) (local $c i32) (local $d i32) (local $k i32) (local $n i32) (local $best i32) (local $bc i32) (local $nc i32)
    (loop $init
      (i32.store (i32.add (i32.const ${COST}) (i32.shl (local.get $i) (i32.const 2))) (i32.const -1))
      (if (i32.eq (call $cls (local.get $i)) (i32.const ${FLOW.exit}))
        (then
          (i32.store (i32.add (i32.const ${COST}) (i32.shl (local.get $i) (i32.const 2))) (i32.const 0))
          (i32.store (i32.add (i32.const ${F.queue}) (i32.shl (local.get $tail) (i32.const 2))) (local.get $i))
          (local.set $tail (i32.add (local.get $tail) (i32.const 1)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $init (i32.lt_u (local.get $i) (i32.const ${F_N}))))
    (block $done (loop $bfs
      (br_if $done (i32.ge_u (local.get $head) (local.get $tail)))
      (local.set $c (i32.load (i32.add (i32.const ${F.queue}) (i32.shl (local.get $head) (i32.const 2)))))
      (local.set $head (i32.add (local.get $head) (i32.const 1)))
      (local.set $d (i32.add (call $cost (local.get $c)) (i32.const 1)))
      (local.set $k (i32.const 0))
      (loop $each
        (local.set $n (call $nb (local.get $c) (local.get $k)))
        (if (i32.ge_s (local.get $n) (i32.const 0))
          (then
            (if (i32.and (i32.ne (call $cls (local.get $n)) (i32.const ${FLOW.blocked})) (i32.lt_s (call $cost (local.get $n)) (i32.const 0)))
              (then
                (i32.store (i32.add (i32.const ${COST}) (i32.shl (local.get $n) (i32.const 2))) (local.get $d))
                (i32.store (i32.add (i32.const ${F.queue}) (i32.shl (local.get $tail) (i32.const 2))) (local.get $n))
                (local.set $tail (i32.add (local.get $tail) (i32.const 1)))))))
        (local.set $k (i32.add (local.get $k) (i32.const 1)))
        (br_if $each (i32.lt_u (local.get $k) (i32.const 4))))
      (br $bfs)))
    (local.set $i (i32.const 0))
    (loop $next
      (local.set $best (i32.const -1))
      (local.set $bc (call $cost (local.get $i)))
      (if (i32.gt_s (local.get $bc) (i32.const 0))
        (then
          (local.set $k (i32.const 0))
          (loop $each2
            (local.set $n (call $nb (local.get $i) (local.get $k)))
            (if (i32.ge_s (local.get $n) (i32.const 0))
              (then
                (local.set $nc (call $cost (local.get $n)))
                (if (i32.and (i32.ge_s (local.get $nc) (i32.const 0)) (i32.lt_s (local.get $nc) (local.get $bc)))
                  (then (local.set $best (local.get $n)) (local.set $bc (local.get $nc))))))
            (local.set $k (i32.add (local.get $k) (i32.const 1)))
            (br_if $each2 (i32.lt_u (local.get $k) (i32.const 4))))))
      (i32.store (i32.add (i32.const ${NEXT}) (i32.shl (local.get $i) (i32.const 2))) (local.get $best))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $next (i32.lt_u (local.get $i) (i32.const ${F_N}))))
    (if (i32.load (i32.const ${F.planted})) (then (call $plant))))
  ;; The wall: row ${FLOW.wall.y}, x ${FLOW.wall.x0} to ${FLOW.wall.x1}, blocked.
  (func $wall (local $x i32)
    (local.set $x (i32.const ${FLOW.wall.x0}))
    (loop $each
      (i32.store (i32.add (i32.const ${CELLS + 4 * cellAt(0, FLOW.wall.y)}) (i32.shl (local.get $x) (i32.const 2))) (i32.const ${FLOW.blocked}))
      (local.set $x (i32.add (local.get $x) (i32.const 1)))
      (br_if $each (i32.le_u (local.get $x) (i32.const ${FLOW.wall.x1})))))
  (func (export "init") (param $seed i64)
    ${core}
    (i64.store (i32.const ${F.refreshAt}) (i64.const -1))
    (call $field))
  (func (export "step") (param $k i64)
    (if (i32.gt_u (i32.load (i32.const ${WALL})) (i32.const 0))
      (then
        (call $wall)
        (i32.store (i32.const ${F.walls}) (i32.add (i32.load (i32.const ${F.walls})) (i32.const 1)))
        ${v === 'stale' ? '(nop)' : `(i64.store (i32.const ${F.refreshAt}) (i64.add (local.get $k) (i64.const ${FLOW.refreshAfter})))`}))
    (if (i64.eq (local.get $k) (i64.load (i32.const ${F.refreshAt}))) (then (call $field)))
    ${v === 'rising' ? `(if (i64.eq (local.get $k) (i64.const ${FLOW.rising.at})) (then (i32.store (i32.const ${F.planted}) (i32.const 1)) (call $plant)))` : ''}
    (i32.store (i32.const ${W('walls')}) (i32.load (i32.const ${F.walls})))))`;
  return assemble(`flow556_${v}_${WALL}_${CELLS}`, text);
}
export function flowPiece(program: Program): Obj {
  return {
    seed: 556, class: 'figure', controls: F_CONTROLS,
    items: { [FLOW.id]: { kind: 'logic@1', params: { program: program.sha, step_rate: 60, reads: F_READS, writes: F_WRITES, budget: { fuel: F_FUEL } } } },
    assets: { [program.sha]: program.b64 },
  };
}
const fp = (n: string): string => `${FLOW.id}.${n}`;
export const FLOW_PATH = { cells: fp('cells'), next: fp('next'), cost: fp('cost'), walls: fp('walls') } as const;
/** The flow fixture's `game.play@1`: its grid alone. */
export function flowPlay(): Obj {
  return { grid: { cells: FLOW_PATH.cells, size: [FLOW.size, FLOW.size], shape: 'square', moves: 4, classes: { open: [FLOW.open], blocked: [FLOW.blocked], exit: [FLOW.exit] } } };
}
/** The bot that places the wall: one entry on the slider at 10 s, step 600. */
export const WALL_POLICY: Obj = { policy: { keys: { wall: [[FLOW.wallKeyS, 1]] } } };
/** grid.reach's flow form on the flow fixture (README: The surface): the brief's next, cost, solid, targets, spawns and lag. */
export const FLOW_FORM: Obj = { next: FLOW_PATH.next, cost: FLOW_PATH.cost, solid: ['blocked'], targets: ['exit'], spawns: FLOW_SPAWNS, lag: FLOW.lag };

// ---------------------------------------------------------------------------------------------------
// The hex fixture (criterion 4): 6 × 6, pointy, odd rows shifted.

/**
 * Rows 0 and 1 are open, and so are rows 4 and 5; row 2 holds one open cell, (3, 2), and row 3 one, (2, 3); every other
 * cell of rows 2 and 3 is blocked. (3, 2) and (2, 3) are neighbours only when the odd rows are shifted (with offset
 * even, (3, 2)'s lower neighbours are (3, 3) and (4, 3), and (2, 3)'s upper ones (1, 2) and (2, 2)), so the one route
 * from the start (0, 0) to the exit (5, 5) crosses from row 2 to row 3 there.
 */
export const HEX = {
  id: 'hex', size: 6, start: [0, 0] as const, exit: [5, 5] as const, crossing: [[3, 2], [2, 3]] as const,
  open: 0, blocked: 1, exitClass: 5,
} as const;
export function hexCells(): number[] {
  const cells = new Array<number>(HEX.size * HEX.size).fill(HEX.open);
  for (const y of [2, 3]) for (let x = 0; x < HEX.size; x++) cells[y * HEX.size + x] = HEX.blocked;
  for (const [x, y] of HEX.crossing) cells[y * HEX.size + x] = HEX.open;
  cells[HEX.exit[1] * HEX.size + HEX.exit[0]] = HEX.exitClass;
  return cells;
}
const H_WRITES: Obj = { cells: { type: 'i32', count: HEX.size * HEX.size }, cell: { type: 'i32', count: 2 } };
const H_WRITES_AT = 1024;
/** The hex fixture's program: `init` writes the cells and the self unit on the start; a step changes nothing. */
export function hexProgram(): Program {
  const l = layoutOf('hex', {}, [], H_WRITES, 0, H_WRITES_AT, 4096);
  const W = (name: string): number => H_WRITES_AT + at(l, 'writes', name);
  const stores = hexCells().map((v, i) => (v === HEX.open ? '' : `(i32.store (i32.const ${W('cells') + 4 * i}) (i32.const ${v}))`)).filter(Boolean).join('\n    ');
  const text = `
(module
  ${head(1, 0, H_WRITES_AT)}
  (func (export "init") (param $seed i64)
    ${stores}
    (i32.store (i32.const ${W('cell')}) (i32.const ${HEX.start[0]}))
    (i32.store (i32.const ${W('cell') + 4}) (i32.const ${HEX.start[1]})))
  (func (export "step") (param $k i64)))`;
  return assemble(`hex556_${W('cells')}`, text);
}
export function hexPiece(program: Program): Obj {
  return {
    seed: 556, class: 'figure', controls: {},
    items: { [HEX.id]: { kind: 'logic@1', params: { program: program.sha, step_rate: 60, reads: [], writes: H_WRITES } } },
    assets: { [program.sha]: program.b64 },
  };
}
/** The hex fixture's `game.play@1`: a pointy hex grid, odd rows shifted, as Mark set: hex grid draws one; the self unit on the start. */
export function hexPlay(): Obj {
  return {
    grid: {
      cells: `${HEX.id}.cells`, size: [HEX.size, HEX.size], shape: 'hex', hex: { orient: 'pointy', offset: 'odd' },
      classes: { open: [HEX.open], blocked: [HEX.blocked], exit: [HEX.exitClass] },
    },
    units: { cell: `${HEX.id}.cell`, self: 0 },
  };
}
/** A policy that puts nothing: the hex fixture's runs only record its floor. */
export const IDLE: Obj = { policy: {} };

// ---------------------------------------------------------------------------------------------------
// #1048's 2-layer map, as a copy of its text whose links are a parameter (criterion 6).

const MAP_CONTROLS: Obj = { aim: { kind: 'point' } };
const MAP_READS = ['aim'];
const MAP_ROWS = 6;
const MAP_WRITES: Obj = {
  cells: { type: 'i32', count: MAP.size * MAP.size * MAP.layers }, cell: { type: 'i32', count: 2 },
  turn: { type: 'i32' }, accepted: { type: 'i32' }, refused: { type: 'i32' }, won: { type: 'i32' },
  legal: { type: 'i32', count: 3 * MAP_ROWS }, nlegal: { type: 'i32' }, links: { type: 'i32', count: 3 * LINKS.length }, nlinks: { type: 'i32' },
};
const M_STATE = 49152;
const M = { hx: M_STATE, hy: M_STATE + 4, turn: M_STATE + 8, accepted: M_STATE + 12, refused: M_STATE + 16, won: M_STATE + 20 };
/** #1048's links without the teleporter's row: the gate alone. */
export const GATE_ONLY: [number, number, number][] = [LINKS[0]!];
/**
 * #1048's map program (its programs.ts, mapProgram), its text copied with the links its init writes as a parameter:
 * with #1048's LINKS it is #1048's map byte for byte; with GATE_ONLY it is the no-teleporter twin, whose links list
 * holds the gate's row alone (`nlinks` 1), the array's shape unchanged.
 */
export function mapTwinProgram(links: [number, number, number][]): Program {
  const l = layoutOf('map', MAP_CONTROLS, MAP_READS, MAP_WRITES, C_READS_AT, C_WRITES_AT, M_STATE);
  const AIM = C_READS_AT + at(l, 'reads', 'aim');
  const W = (name: string): number => C_WRITES_AT + at(l, 'writes', name);
  const ld = (a: number): string => `(i32.load (i32.const ${a}))`;
  const st = (a: number, x: string): string => `(i32.store (i32.const ${a}) ${x})`;
  const inc = (a: number): string => st(a, `(i32.add ${ld(a)} (i32.const 1))`);
  const cells = mapCells();
  const N = MAP.size;
  const openRuns: string[] = [];
  cells.forEach((v, i) => { if (v !== MAP.blocked) openRuns.push(`(i32.store (i32.const ${W('cells') + 4 * i}) (i32.const ${v}))`); });
  const linkStores = links.flatMap((r, i) => r.map((v, j) => `(i32.store (i32.const ${W('links') + 12 * i + 4 * j}) (i32.const ${v}))`));
  const text = `
(module
  ${head(2, C_READS_AT, C_WRITES_AT)}
  ;; The class at (x, Y): blocked off the map.
  (func $cls (param $x i32) (param $y i32) (result i32)
    (if (result i32) (i32.or (i32.ge_u (local.get $x) (i32.const ${N})) (i32.ge_u (local.get $y) (i32.const ${N * MAP.layers})))
      (then (i32.const ${MAP.blocked}))
      (else (i32.load (i32.add (i32.const ${W('cells')}) (i32.shl (i32.add (i32.mul (local.get $y) (i32.const ${N})) (local.get $x)) (i32.const 2)))))))
  (func $pass (param $x i32) (param $y i32) (result i32) (local $v i32)
    (local.set $v (call $cls (local.get $x) (local.get $y)))
    (i32.or (i32.eq (local.get $v) (i32.const ${MAP.open})) (i32.eq (local.get $v) (i32.const ${MAP.exitClass}))))
  (func $abs (param $v i32) (result i32)
    (select (local.get $v) (i32.sub (i32.const 0) (local.get $v)) (i32.ge_s (local.get $v) (i32.const 0))))
  ;; Whether a link joins cell a to cell b: from a to b, or from b to a when two-way.
  (func $linked (param $a i32) (param $b i32) (result i32) (local $i i32) (local $p i32) (local $r i32)
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) ${ld(W('nlinks'))}))
      (local.set $p (i32.add (i32.const ${W('links')}) (i32.mul (local.get $i) (i32.const 12))))
      (if (i32.and (i32.eq (i32.load (local.get $p)) (local.get $a)) (i32.eq (i32.load offset=4 (local.get $p)) (local.get $b)))
        (then (local.set $r (i32.const 1))))
      (if (i32.and (i32.load offset=8 (local.get $p))
            (i32.and (i32.eq (i32.load offset=4 (local.get $p)) (local.get $a)) (i32.eq (i32.load (local.get $p)) (local.get $b))))
        (then (local.set $r (i32.const 1))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (local.get $r))
  ;; A move from the hero's cell to (x, Y): a passable neighbour on its layer, or a link's other end.
  (func $may (param $x i32) (param $y i32) (result i32) (local $hx i32) (local $hy i32)
    (local.set $hx ${ld(M.hx)})
    (local.set $hy ${ld(M.hy)})
    (i32.or
      (i32.and (call $pass (local.get $x) (local.get $y))
        (i32.and (i32.eq (i32.shr_u (local.get $y) (i32.const 4)) (i32.shr_u (local.get $hy) (i32.const 4)))
          (i32.eq (i32.add (call $abs (i32.sub (local.get $x) (local.get $hx))) (call $abs (i32.sub (local.get $y) (local.get $hy)))) (i32.const 1))))
      (call $linked (i32.add (i32.mul (local.get $hy) (i32.const ${N})) (local.get $hx)) (i32.add (i32.mul (local.get $y) (i32.const ${N})) (local.get $x)))))
  (func $row (param $n i32) (param $x i32) (param $y i32) (result i32) (local $p i32)
    (if (result i32) (i32.and (i32.lt_u (local.get $n) (i32.const ${MAP_ROWS})) (call $may (local.get $x) (local.get $y)))
      (then
        (local.set $p (i32.add (i32.const ${W('legal')}) (i32.mul (local.get $n) (i32.const 12))))
        (i32.store (local.get $p) (i32.const 0))
        (i32.store offset=4 (local.get $p) (local.get $x))
        (i32.store offset=8 (local.get $p) (local.get $y))
        (i32.add (local.get $n) (i32.const 1)))
      (else (local.get $n))))
  (func (export "init") (param $seed i64) (local $i i32)
    (loop $fill
      (i32.store (i32.add (i32.const ${W('cells')}) (i32.shl (local.get $i) (i32.const 2))) (i32.const ${MAP.blocked}))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $fill (i32.lt_u (local.get $i) (i32.const ${cells.length}))))
    ${openRuns.join('\n    ')}
    ${linkStores.join('\n    ')}
    ${st(W('nlinks'), `(i32.const ${links.length})`)}
    ${st(M.hx, `(i32.const ${MAP.start[0]})`)}
    ${st(M.hy, `(i32.const ${MAP.start[1]})`)})
  (func (export "step") (param $k i64)
    (local $n i32) (local $j i32) (local $rec i32) (local $fx f64) (local $fy f64) (local $x i32) (local $y i32) (local $i i32) (local $p i32) (local $here i32)
    (local.set $n ${ld(AIM)})
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $j) (local.get $n)))
      (local.set $rec (i32.add (i32.const ${AIM + 16}) (i32.shl (local.get $j) (i32.const 8))))
      (if (i32.eqz (i32.load8_u (local.get $rec)))
        (then
          (local.set $x (i32.const -1))
          (local.set $y (i32.const -1))
          (if (i32.and (i32.load8_u offset=3 (local.get $rec)) (i32.const 1))
            (then
              (local.set $fx (f64.load offset=8 (local.get $rec)))
              (local.set $fy (f64.load offset=16 (local.get $rec)))
              (if (i32.and (i32.and (f64.ge (local.get $fx) (f64.const 0)) (f64.lt (local.get $fx) (f64.const ${N})))
                           (i32.and (f64.ge (local.get $fy) (f64.const 0)) (f64.lt (local.get $fy) (f64.const ${N * MAP.layers}))))
                (then
                  (local.set $x (i32.trunc_f64_s (local.get $fx)))
                  (local.set $y (i32.trunc_f64_s (local.get $fy)))))))
          (if (i32.and (i32.ge_s (local.get $x) (i32.const 0)) (call $may (local.get $x) (local.get $y)))
            (then
              ${st(M.hx, '(local.get $x)')}
              ${st(M.hy, '(local.get $y)')}
              ${inc(M.accepted)}
              ${inc(M.turn)}
              (if (i32.eq (call $cls (local.get $x) (local.get $y)) (i32.const ${MAP.exitClass})) (then ${st(M.won, '(i32.const 1)')})))
            (else ${inc(M.refused)}))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $each)))
    ${st(W('cell'), ld(M.hx))}
    ${st(W('cell') + 4, ld(M.hy))}
    ${st(W('turn'), ld(M.turn))}
    ${st(W('accepted'), ld(M.accepted))}
    ${st(W('refused'), ld(M.refused))}
    ${st(W('won'), ld(M.won))}
    (local.set $i (i32.const 0))
    (loop $clear
      (i32.store (i32.add (i32.const ${W('legal')}) (local.get $i)) (i32.const 0))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br_if $clear (i32.lt_u (local.get $i) (i32.const ${3 * MAP_ROWS * 4}))))
    (local.set $n (i32.const 0))
    (local.set $n (call $row (local.get $n) ${ld(M.hx)} (i32.sub ${ld(M.hy)} (i32.const 1))))
    (local.set $n (call $row (local.get $n) (i32.add ${ld(M.hx)} (i32.const 1)) ${ld(M.hy)}))
    (local.set $n (call $row (local.get $n) ${ld(M.hx)} (i32.add ${ld(M.hy)} (i32.const 1))))
    (local.set $n (call $row (local.get $n) (i32.sub ${ld(M.hx)} (i32.const 1)) ${ld(M.hy)}))
    ;; The links from the hero's cell: each one's other end.
    (local.set $here (i32.add (i32.mul ${ld(M.hy)} (i32.const ${N})) ${ld(M.hx)}))
    (local.set $i (i32.const 0))
    (block $done (loop $links
      (br_if $done (i32.ge_u (local.get $i) ${ld(W('nlinks'))}))
      (local.set $p (i32.add (i32.const ${W('links')}) (i32.mul (local.get $i) (i32.const 12))))
      (if (i32.eq (i32.load (local.get $p)) (local.get $here))
        (then (local.set $n (call $row (local.get $n)
          (i32.rem_u (i32.load offset=4 (local.get $p)) (i32.const ${N})) (i32.div_u (i32.load offset=4 (local.get $p)) (i32.const ${N}))))))
      (if (i32.and (i32.load offset=8 (local.get $p)) (i32.eq (i32.load offset=4 (local.get $p)) (local.get $here)))
        (then (local.set $n (call $row (local.get $n)
          (i32.rem_u (i32.load (local.get $p)) (i32.const ${N})) (i32.div_u (i32.load (local.get $p)) (i32.const ${N}))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $links)))
    ${st(W('nlegal'), '(local.get $n)')}))`;
  return assemble(`map556_${links.length}_${AIM}_${W('cells')}`, text);
}
export { MAP, idx };
