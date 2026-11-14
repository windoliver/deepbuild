// The #548 acceptance suite's logic programs, as WebAssembly text assembled by #544's assembler (README: Programs),
// and the rules the tests work their expected values from. Each program exports `memory` (its maximum its minimum),
// `init(seed: i64)`, `step(k: i64)`, `reads_at` and `writes_at`, and, where its item declares them, `emits_at`, and
// `preview(k: i64)` with `preview_at`. A program that reads or writes a region entry past the first is built against
// the item's layout as `check` reports it (each test reads it first); the preview regions are laid out as the README's
// "The preview regions" says. Nothing here runs a program: the logic module does.

import { assemble, type Program } from './helpers.ts';

export const PAGE = 65_536;

// ---------------------------------------------------------------------------------------------------
// The hex board (criteria 1, 2 and 7): a 24 × 24 pointy odd hex grid, one selected unit, its AI's move and a preview
// that writes the route from the unit to the hovered hex.

export const COLS = 24;
export const ROWS = 24;
export const CELLS = COLS * ROWS;
export type Cell = [number, number];
/** The selected unit's cell before the AI's move, and after it. */
export const U0: Cell = [12, 12];
export const U1: Cell = [13, 12];
/** The step whose AI moves the selected unit from U0 to U1 (2 s at 60 Hz). */
export const MOVE_STEP = 120;
/** The route's length: the preview's `route` array holds this many cells. */
export const ROUTE = 12;

/** A cell's axial coordinates on the pointy odd grid (odd rows shifted right half a cell; canvas primitives: Mark set: hex grid). */
const axial = ([cx, cy]: Cell): [number, number] => [cx - (cy >> 1), cy];
const offsetOf = ([q, r]: [number, number]): Cell => [q + (r >> 1), r];
export const hexDistance = (a: Cell, b: Cell): number => {
  const [q1, r1] = axial(a); const [q2, r2] = axial(b);
  const dq = q2 - q1; const dr = r2 - r1;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
};
/** A cell's index in the board's arrays: row-major, cy × 24 + cx. */
export const indexOf = ([cx, cy]: Cell): number => cy * COLS + cx;
/**
 * The route the preview writes from `from` to `to` (README: Programs, `game`): the cells of the walk from the unit's
 * cell, the unit's own cell first, that each move steps one hex toward the target, (+1, −1) or (−1, +1) in axial
 * coordinates while q and r must move opposite ways, else along q, else along r, until it reaches the target or holds
 * 12 cells; each as its index + 1, the rest 0. A shortest path: a target 11 hexes away fills all 12.
 */
export function routeOf(from: Cell, to: Cell): number[] {
  let [q, r] = axial(from);
  const [tq, tr] = axial(to);
  const out: number[] = [];
  for (;;) {
    out.push(indexOf(offsetOf([q, r])) + 1);
    if ((q === tq && r === tr) || out.length === ROUTE) break;
    const dq = tq - q; const dr = tr - r;
    if (dq > 0 && dr < 0) { q += 1; r -= 1; } else if (dq < 0 && dr > 0) { q -= 1; r += 1; } else if (dq !== 0) q += Math.sign(dq); else r += Math.sign(dr);
  }
  while (out.length < ROUTE) out.push(0);
  return out;
}
/** The route's cells as the `lit` mask: true at each cell of the route. */
export function litOf(route: number[]): boolean[] {
  const lit = new Array<boolean>(CELLS).fill(false);
  for (const v of route) if (v > 0) lit[v - 1] = true;
  return lit;
}
const ALL: Cell[] = Array.from({ length: CELLS }, (_, i) => [i % COLS, Math.floor(i / COLS)] as Cell);
/** The 66 hexes 11 from U0, all on the board, in a seeded order: the 40 hovered in turn, then the trap hex. */
export const RING: Cell[] = ALL.filter((c) => hexDistance(U0, c) === 11);
const ORDER = ((): Cell[] => {
  const out = [...RING];
  let a = 548;
  for (let i = out.length - 1; i > 0; i--) { a = (a * 1103515245 + 12345) >>> 0; const j = a % (i + 1); [out[i], out[j]] = [out[j]!, out[i]!]; }
  return out;
})();
export const HOVERS: Cell[] = ORDER.slice(0, 40);
/** The hex whose preview loops forever (criterion 1's last clause). */
export const TRAP: Cell = ORDER[40]!;

/** Where `game` keeps the unit's cell (cx, then cy, i32s), and where its preview regions start. */
const STATE = 16_384;
export const PREVIEW_AT = 8192;
/** The preview's read region: the hover's 248 B point record (README: The preview regions); its write region follows. */
export const HOVER_BYTES = 248;
export const PREVIEW_WRITES_AT = PREVIEW_AT + HOVER_BYTES;
/** route (i32 × 12, 48 B), then lit (bool × 576) at the next 8-byte boundary. */
export const ROUTE_AT = PREVIEW_WRITES_AT;
export const LIT_AT = PREVIEW_WRITES_AT + 48;
export const GAME_WRITES = { unit: { type: 'i32', count: 2 }, here: { type: 'bool', count: CELLS } } as const;
export const GAME_PREVIEW = { reads: ['place.hover'], writes: { route: { type: 'i32', count: ROUTE }, lit: { type: 'bool', count: CELLS } } } as const;
export interface GameAt { unit: number; here: number }
/**
 * `game` (item `game`): the selected unit at U0, moved to U1 by the AI at step 120. Each step writes `unit` (its cx, cy)
 * and `here` (true at its cell). `preview(k)` zeroes its write region, then, when the hover holds a cell (flags bit 0)
 * on the board, reads the unit's cell from memory as the last step left it and writes the route to the hovered hex
 * into `route` and `lit`; on the trap hex it loops forever, so it runs out of fuel. Its step never reads the preview.
 * Item: writes GAME_WRITES, preview GAME_PREVIEW, controls {place: point}.
 */
export const game = (w: GameAt): Program => assemble('game', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  (global (export "preview_at") i32 (i32.const ${PREVIEW_AT}))
  (func (export "init") (param $seed i64)
    (i32.store (i32.const ${STATE}) (i32.const ${U0[0]}))
    (i32.store (i32.const ${STATE + 4}) (i32.const ${U0[1]})))
  (func (export "step") (param $k i64) (local $x i32) (local $y i32)
    (if (i64.eq (local.get $k) (i64.const ${MOVE_STEP}))
      (then (i32.store (i32.const ${STATE}) (i32.const ${U1[0]})) (i32.store (i32.const ${STATE + 4}) (i32.const ${U1[1]}))))
    (local.set $x (i32.load (i32.const ${STATE})))
    (local.set $y (i32.load (i32.const ${STATE + 4})))
    (i32.store (i32.const ${1024 + w.unit}) (local.get $x))
    (i32.store (i32.const ${1024 + w.unit + 4}) (local.get $y))
    (memory.fill (i32.const ${1024 + w.here}) (i32.const 0) (i32.const ${CELLS * 4}))
    (i32.store (i32.add (i32.const ${1024 + w.here}) (i32.shl (i32.add (i32.mul (local.get $y) (i32.const ${COLS})) (local.get $x)) (i32.const 2))) (i32.const 1)))
  (func (export "preview") (param $k i64)
    (local $tx i32) (local $ty i32) (local $q i32) (local $r i32) (local $tq i32) (local $tr i32)
    (local $n i32) (local $idx i32) (local $dq i32) (local $dr i32)
    (memory.fill (i32.const ${ROUTE_AT}) (i32.const 0) (i32.const ${48 + CELLS * 4}))
    (if (i32.eqz (i32.and (i32.load8_u (i32.const ${PREVIEW_AT + 3})) (i32.const 1))) (then (return)))
    (local.set $tx (i32.trunc_f64_s (f64.load (i32.const ${PREVIEW_AT + 8}))))
    (local.set $ty (i32.trunc_f64_s (f64.load (i32.const ${PREVIEW_AT + 16}))))
    (if (i32.and (i32.eq (local.get $tx) (i32.const ${TRAP[0]})) (i32.eq (local.get $ty) (i32.const ${TRAP[1]})))
      (then (loop $forever (br $forever))))
    (if (i32.or (i32.ge_u (local.get $tx) (i32.const ${COLS})) (i32.ge_u (local.get $ty) (i32.const ${ROWS}))) (then (return)))
    (local.set $r (i32.load (i32.const ${STATE + 4})))
    (local.set $q (i32.sub (i32.load (i32.const ${STATE})) (i32.shr_s (local.get $r) (i32.const 1))))
    (local.set $tr (local.get $ty))
    (local.set $tq (i32.sub (local.get $tx) (i32.shr_s (local.get $ty) (i32.const 1))))
    (block $done
      (loop $walk
        (local.set $idx (i32.add (i32.mul (local.get $r) (i32.const ${COLS})) (i32.add (local.get $q) (i32.shr_s (local.get $r) (i32.const 1)))))
        (i32.store (i32.add (i32.const ${ROUTE_AT}) (i32.shl (local.get $n) (i32.const 2))) (i32.add (local.get $idx) (i32.const 1)))
        (i32.store (i32.add (i32.const ${LIT_AT}) (i32.shl (local.get $idx) (i32.const 2))) (i32.const 1))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (br_if $done (i32.and (i32.eq (local.get $q) (local.get $tq)) (i32.eq (local.get $r) (local.get $tr))))
        (br_if $done (i32.eq (local.get $n) (i32.const ${ROUTE})))
        (local.set $dq (i32.sub (local.get $tq) (local.get $q)))
        (local.set $dr (i32.sub (local.get $tr) (local.get $r)))
        (if (i32.and (i32.gt_s (local.get $dq) (i32.const 0)) (i32.lt_s (local.get $dr) (i32.const 0)))
          (then (local.set $q (i32.add (local.get $q) (i32.const 1))) (local.set $r (i32.sub (local.get $r) (i32.const 1))))
          (else
            (if (i32.and (i32.lt_s (local.get $dq) (i32.const 0)) (i32.gt_s (local.get $dr) (i32.const 0)))
              (then (local.set $q (i32.sub (local.get $q) (i32.const 1))) (local.set $r (i32.add (local.get $r) (i32.const 1))))
              (else
                (if (i32.ne (local.get $dq) (i32.const 0))
                  (then (local.set $q (i32.add (local.get $q) (select (i32.const 1) (i32.const -1) (i32.gt_s (local.get $dq) (i32.const 0))))))
                  (else (local.set $r (i32.add (local.get $r) (select (i32.const 1) (i32.const -1) (i32.gt_s (local.get $dr) (i32.const 0)))))))))))
        (br $walk)))))`);

/** A program for layout probes: the exports a logic item with emits and a preview needs, and an empty step. */
export const probe = (): Program => assemble('probe', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  (global (export "emits_at") i32 (i32.const 6144))
  (global (export "preview_at") i32 (i32.const ${PREVIEW_AT}))
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64))
  (func (export "preview") (param $k i64)))`);

// ---------------------------------------------------------------------------------------------------
// The flock (criteria 4, 5 and 6): 100 boids.

export const BOIDS = 100;
export const FLOCK_READS = ['wind', 'gust'];
export const FLOCK_WRITES = { pos: { type: 'vec3', count: BOIDS }, vel: { type: 'vec2', count: BOIDS }, score: { type: 'i32' } } as const;
export const FLOCK_EMITS = { crossing: { fields: { boid: 'i32', side: 'i32' }, max_per_step: 16 } } as const;
/** The flock item's reads and writes in declaration order, then its emit kinds: the region map's names. */
export const FLOCK_NAMES = [['reads', 'wind'], ['reads', 'gust'], ['reads', 'seed'], ['writes', 'pos'], ['writes', 'vel'], ['writes', 'score'], ['emits', 'crossing']] as const;
export interface FlockAt { wind: number; gust: number; pos: number; vel: number; score: number; crossing: number }
/** f64 constants as WebAssembly text. */
const f = (x: number): string => `(f64.const ${x})`;
/**
 * `flock` (item `flock`): 100 boids at seeded points, each step pulled toward their centroid, pushed by the wind (the
 * last `wind` entry, kept in `$wind`) and every `gust` entry's value, jittered by a xorshift64 on `$rng` seeded by
 * `init`, and damped. Each step writes `pos` (x, y, x · y), `vel` and `score` (crossings so far), and emits a `crossing`
 * {boid, side} for each boid whose x changed sign, at most 16 a step. State: memory from 8,192 (5 f64 a boid).
 * Item: reads FLOCK_READS, writes FLOCK_WRITES, emits FLOCK_EMITS, controls {wind, gust: slider}.
 */
export const flock = (o: FlockAt): Program => assemble('flock', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  (global (export "emits_at") i32 (i32.const 6144))
  (global $wind (mut f64) ${f(0)})
  (global $rng (mut i64) (i64.const 1))
  (global $total (mut i32) (i32.const 0))
  (func $jitter (result f64) (local $x i64)
    (local.set $x (global.get $rng))
    (local.set $x (i64.xor (local.get $x) (i64.shl (local.get $x) (i64.const 13))))
    (local.set $x (i64.xor (local.get $x) (i64.shr_u (local.get $x) (i64.const 7))))
    (local.set $x (i64.xor (local.get $x) (i64.shl (local.get $x) (i64.const 17))))
    (global.set $rng (local.get $x))
    (f64.sub (f64.mul (f64.convert_i64_u (i64.shr_u (local.get $x) (i64.const 11))) ${f(2 ** -53)}) ${f(0.5)}))
  (func (export "init") (param $seed i64) (local $i i32) (local $a i32)
    (global.set $rng (i64.or (local.get $seed) (i64.const 1)))
    (block $done (loop $each
      (br_if $done (i32.eq (local.get $i) (i32.const ${BOIDS})))
      (local.set $a (i32.add (i32.const 8192) (i32.mul (local.get $i) (i32.const 40))))
      (f64.store (local.get $a) (f64.mul (call $jitter) ${f(10)}))
      (f64.store offset=8 (local.get $a) (f64.mul (call $jitter) ${f(10)}))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each))))
  (func (export "step") (param $k i64)
    (local $i i32) (local $a i32) (local $n i32) (local $g f64) (local $cx f64) (local $cy f64)
    (local $px f64) (local $py f64) (local $vx f64) (local $vy f64) (local $old f64) (local $emitted i32) (local $row i32)
    ;; the wind: the last entry this step, else as before
    (local.set $n (i32.load (i32.const ${o.wind})))
    (if (i32.gt_u (local.get $n) (i32.const 0))
      (then (global.set $wind (f64.load (i32.add (i32.const ${o.wind + 16}) (i32.shl (i32.sub (local.get $n) (i32.const 1)) (i32.const 4)))))))
    ;; the gusts: every entry's value, summed
    (local.set $n (i32.load (i32.const ${o.gust})))
    (local.set $i (i32.const 0))
    (block $g_done (loop $g_each
      (br_if $g_done (i32.ge_u (local.get $i) (local.get $n)))
      (local.set $g (f64.add (local.get $g) (f64.load (i32.add (i32.const ${o.gust + 16}) (i32.shl (local.get $i) (i32.const 4))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $g_each)))
    ;; the centroid
    (local.set $i (i32.const 0))
    (block $c_done (loop $c_each
      (br_if $c_done (i32.eq (local.get $i) (i32.const ${BOIDS})))
      (local.set $a (i32.add (i32.const 8192) (i32.mul (local.get $i) (i32.const 40))))
      (local.set $cx (f64.add (local.get $cx) (f64.load (local.get $a))))
      (local.set $cy (f64.add (local.get $cy) (f64.load offset=8 (local.get $a))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $c_each)))
    (local.set $cx (f64.div (local.get $cx) ${f(BOIDS)}))
    (local.set $cy (f64.div (local.get $cy) ${f(BOIDS)}))
    (i32.store (i32.const ${6144 + o.crossing}) (i32.const 0))
    (local.set $i (i32.const 0))
    (block $done (loop $each
      (br_if $done (i32.eq (local.get $i) (i32.const ${BOIDS})))
      (local.set $a (i32.add (i32.const 8192) (i32.mul (local.get $i) (i32.const 40))))
      (local.set $px (f64.load (local.get $a)))
      (local.set $py (f64.load offset=8 (local.get $a)))
      (local.set $vx (f64.load offset=16 (local.get $a)))
      (local.set $vy (f64.load offset=24 (local.get $a)))
      (local.set $vx (f64.mul ${f(0.98)} (f64.add (local.get $vx) (f64.add (f64.add (f64.mul (f64.sub (local.get $cx) (local.get $px)) ${f(0.02)})
        (f64.add (f64.mul (global.get $wind) ${f(0.01)}) (f64.mul (local.get $g) ${f(0.05)}))) (f64.mul (call $jitter) ${f(0.2)})))))
      (local.set $vy (f64.mul ${f(0.98)} (f64.add (local.get $vy) (f64.add (f64.mul (f64.sub (local.get $cy) (local.get $py)) ${f(0.02)}) (f64.mul (call $jitter) ${f(0.2)})))))
      (local.set $old (local.get $px))
      (local.set $px (f64.add (local.get $px) (f64.mul (local.get $vx) ${f(1 / 6)})))
      (local.set $py (f64.add (local.get $py) (f64.mul (local.get $vy) ${f(1 / 6)})))
      (f64.store (local.get $a) (local.get $px))
      (f64.store offset=8 (local.get $a) (local.get $py))
      (f64.store offset=16 (local.get $a) (local.get $vx))
      (f64.store offset=24 (local.get $a) (local.get $vy))
      (local.set $row (i32.add (i32.const ${1024 + o.pos}) (i32.mul (local.get $i) (i32.const 24))))
      (f64.store (local.get $row) (local.get $px))
      (f64.store offset=8 (local.get $row) (local.get $py))
      (f64.store offset=16 (local.get $row) (f64.mul (local.get $px) (local.get $py)))
      (local.set $row (i32.add (i32.const ${1024 + o.vel}) (i32.shl (local.get $i) (i32.const 4))))
      (f64.store (local.get $row) (local.get $vx))
      (f64.store offset=8 (local.get $row) (local.get $vy))
      (if (i32.and (i32.ne (f64.lt (local.get $old) ${f(0)}) (f64.lt (local.get $px) ${f(0)})) (i32.lt_u (local.get $emitted) (i32.const 16)))
        (then
          (local.set $row (i32.add (i32.const ${6144 + o.crossing + 4}) (i32.shl (local.get $emitted) (i32.const 4))))
          (i32.store (local.get $row) (local.get $i))
          (i32.store offset=4 (local.get $row) (i32.wrap_i64 (local.get $k)))
          (i32.store offset=8 (local.get $row) (local.get $i))
          (i32.store offset=12 (local.get $row) (select (i32.const -1) (i32.const 1) (f64.lt (local.get $px) ${f(0)})))
          (local.set $emitted (i32.add (local.get $emitted) (i32.const 1)))
          (global.set $total (i32.add (global.get $total) (i32.const 1)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (i32.store (i32.const ${6144 + o.crossing}) (local.get $emitted))
    (i32.store (i32.const ${1024 + o.score}) (global.get $total))))`);

// ---------------------------------------------------------------------------------------------------
// The program that traps at step 412 (criterion 4).

export const TRAP_STEP = 412;
/** `judge`'s index among the module's functions: init 0, step 1, judge 2 (no imports). */
export const JUDGE_FUNCTION = 2;
/**
 * `judge` (item `judge`): each step adds k to `acc`; a step that read a `trigger` entry divides `acc` by the entry's
 * value in function 2 (`$judge`, an i32.div_u), so an entry of 0 traps with kind divide.
 * Item: reads ["trigger"], writes {acc: i32}, controls {trigger: slider}.
 */
export const judge = (): Program => assemble('judge', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  (global $acc (mut i32) (i32.const 0))
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64)
    (global.set $acc (i32.add (global.get $acc) (i32.wrap_i64 (local.get $k))))
    (if (i32.gt_u (i32.load (i32.const 0)) (i32.const 0))
      (then (global.set $acc (call $judge (global.get $acc) (i32.trunc_f64_u (f64.load (i32.const 16)))))))
    (i32.store (i32.const 1024) (global.get $acc)))
  (func $judge (param $a i32) (param $b i32) (result i32)
    (i32.div_u (local.get $a) (local.get $b))))`);

// ---------------------------------------------------------------------------------------------------
// Criterion 3's programs.

/** `idle` (item `idle`, clock on_input, reads ["tap"]): each step that runs adds 1 to `n`. */
export const idle = (): Program => assemble('idle', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64)
    (i32.store (i32.const 1024) (i32.add (i32.load (i32.const 1024)) (i32.const 1)))))`);

/** `plain` (item `plain`, fixed clock, no emits, preview or linear write): `x` = k. */
export const plain = (): Program => assemble('plain', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64)
    (f64.store (i32.const 1024) (f64.convert_i64_s (local.get $k)))))`);

export const EMIT_ROWS = 64;
export const EMITS_64 = { hit: { fields: { x: 'f64' }, max_per_step: EMIT_ROWS } } as const;
/**
 * `emitter` (item `shots`, emits EMITS_64, writes {k: i32}): each step writes 64 rows {a: i, b: k, x: i} into its emit
 * region and sets the count to `rows`: 64, or 0 for the twin that does the same stores and emits none.
 */
export const emitter = (rows: number, hitAt: number): Program => assemble(`emitter${rows}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  (global (export "emits_at") i32 (i32.const 4096))
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64) (local $i i32) (local $row i32)
    (block $done (loop $each
      (br_if $done (i32.eq (local.get $i) (i32.const ${EMIT_ROWS})))
      (local.set $row (i32.add (i32.const ${4096 + hitAt + 4}) (i32.shl (local.get $i) (i32.const 4))))
      (i32.store (local.get $row) (local.get $i))
      (i32.store offset=4 (local.get $row) (i32.wrap_i64 (local.get $k)))
      (f64.store offset=8 (local.get $row) (f64.convert_i32_u (local.get $i)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (i32.store (i32.const ${4096 + hitAt}) (i32.const ${rows}))
    (i32.store (i32.const 1024) (i32.wrap_i64 (local.get $k)))))`);

export const SWARM = 1000;
/** `swarm` (item `swarm`, 10 Hz, writes {pos: vec3 × 1,000}, linear or hold): step k writes pos[i] = [k + i, i, 0]. */
export const swarm = (): Program => assemble('swarm', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64) (local $i i32) (local $row i32)
    (block $done (loop $each
      (br_if $done (i32.eq (local.get $i) (i32.const ${SWARM})))
      (local.set $row (i32.add (i32.const 1024) (i32.mul (local.get $i) (i32.const 24))))
      (f64.store (local.get $row) (f64.add (f64.convert_i64_s (local.get $k)) (f64.convert_i32_u (local.get $i))))
      (f64.store offset=8 (local.get $row) (f64.convert_i32_u (local.get $i)))
      (f64.store offset=16 (local.get $row) (f64.const 0))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))))`);

/**
 * `big` (item `big`, budget {memory: 4}: a 4 MiB state of 64 pages, every page holding a nonzero byte from `init`),
 * writes {k: i32}, preview {reads: ["place.hover"], writes: {seen: i32}}: the preview writes the hovered cell's cx.
 */
export const big = (): Program => assemble('big', `
(module
  (memory (export "memory") 64 64)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  (global (export "preview_at") i32 (i32.const ${PREVIEW_AT}))
  (func (export "init") (param $seed i64) (local $p i32)
    (block $done (loop $each
      (br_if $done (i32.eq (local.get $p) (i32.const 64)))
      (i32.store (i32.add (i32.mul (local.get $p) (i32.const ${PAGE})) (i32.const 32768)) (i32.add (local.get $p) (i32.const 1)))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br $each))))
  (func (export "step") (param $k i64)
    (i32.store (i32.const 1024) (i32.wrap_i64 (local.get $k))))
  (func (export "preview") (param $k i64)
    (i32.store (i32.const ${PREVIEW_WRITES_AT}) (i32.trunc_f64_s (f64.load (i32.const ${PREVIEW_AT + 8}))))))`);

export const PAGES3_PAGES = 512;
/** The pages `pages3` writes every step besides page 0 (its regions). */
export const PAGES3_WRITTEN = [0, 200, 400];
/**
 * `pages3` (item `pages3`, budget {memory: 32}: 512 pages, 32 MiB): every step writes the same 3 of its 64 KiB pages:
 * page 0 (its write region, `sum`), an i64 store on page 200 at slot k mod 8,192 and one on page 400 at slot k mod 64.
 */
export const pages3 = (): Program => assemble('pages3', `
(module
  (memory (export "memory") ${PAGES3_PAGES} ${PAGES3_PAGES})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global $acc (mut i64) (i64.const 1))
  (func (export "init") (param $seed i64)
    (global.set $acc (i64.or (local.get $seed) (i64.const 1))))
  (func (export "step") (param $k i64) (local $k32 i32)
    (local.set $k32 (i32.wrap_i64 (local.get $k)))
    (global.set $acc (i64.add (i64.mul (global.get $acc) (i64.const 6364136223846793005)) (local.get $k)))
    (i64.store (i32.add (i32.const ${200 * PAGE}) (i32.shl (i32.and (local.get $k32) (i32.const 8191)) (i32.const 3))) (global.get $acc))
    (i64.store (i32.add (i32.const ${400 * PAGE}) (i32.shl (i32.and (local.get $k32) (i32.const 63)) (i32.const 3))) (global.get $acc))
    (i32.store (i32.const 4096) (i32.wrap_i64 (i64.shr_u (global.get $acc) (i64.const 32))))))`);
