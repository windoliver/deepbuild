// This suite's logic programs, as an agent would write them (README: Programs), in WebAssembly text, assembled by
// #544's assembler (../544/wat, read-only). Every one exports `memory` (its maximum equal to its minimum), `init(seed:
// i64)`, `step(k: i64)` and the immutable globals `reads_at` (0: no reads, so the read region holds only the step's
// seed) and `writes_at` (4096), and keeps to the logic subset (no imports). The write region is laid out as the base's
// logic module lays it (crates/deep-logic piece.rs): each array in declaration order, its elements contiguous, a bool or
// an i32 4 bytes, an f64 8, a vec2 16, each array starting on an 8-byte boundary. Each program writes every element it
// owns at every step, so an array's value after step k is a function of k alone and the step that changes an element is
// the first step whose function differs.

import { assemble, type Program } from './helpers.ts';

export const WRITES_AT = 4096;
/** The byte offset of each array of a write region in declaration order (bool and i32 4 bytes, f64 8, vec2 16). */
export function offsets(writes: [string, 'bool' | 'i32' | 'f64' | 'vec2', number][]): Record<string, number> {
  const size = { bool: 4, i32: 4, f64: 8, vec2: 16 } as const;
  const out: Record<string, number> = {};
  let at = 0;
  for (const [name, type, count] of writes) {
    out[name] = WRITES_AT + at;
    at = Math.ceil((at + size[type] * count) / 8) * 8;
  }
  return out;
}

const head = (pages: number): string => `
  (memory (export "memory") ${pages} ${pages})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func (export "init") (param $seed i64))`;

// ---------------------------------------------------------------------------------------------------
// Criterion 1: the 96 × 96 layer. `cells: i32 × 9,216`, row-major: index 96 × cy + cx.

export const COLS = 96;
export const CELLS = COLS * COLS;
/** The step that changes only cell (40, 7), and the one that changes only cells (0, 0) and (95, 95). */
export const ONE_CELL_STEP = 30;
export const TWO_CELL_STEP = 60;
export const ONE_CELL = { index: 7 * COLS + 40, value: 6 } as const;
export const FIRST = { index: 0, value: 3 } as const;
export const LAST = { index: CELLS - 1, value: 7 } as const;
/** The layer's value at index i after step k: (cx + 3 cy) mod 8, with (40, 7) set to 6 from step 30 and (0, 0) to 3
 * and (95, 95) to 7 from step 60. Each change is to another value than the cell held. */
export function cellValue(i: number, k: number): number {
  if (k >= ONE_CELL_STEP && i === ONE_CELL.index) return ONE_CELL.value;
  if (k >= TWO_CELL_STEP && i === FIRST.index) return FIRST.value;
  if (k >= TWO_CELL_STEP && i === LAST.index) return LAST.value;
  return ((i % COLS) + 3 * Math.floor(i / COLS)) % 8;
}
export const layerProgram = (): Program => assemble('layer96', `
(module${head(1)}
  (func (export "step") (param $k i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const ${WRITES_AT}) (i32.shl (local.get $i) (i32.const 2)))
        (i32.rem_u
          (i32.add (i32.rem_u (local.get $i) (i32.const ${COLS})) (i32.mul (i32.const 3) (i32.div_u (local.get $i) (i32.const ${COLS}))))
          (i32.const 8)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${CELLS}))))
    (if (i64.ge_s (local.get $k) (i64.const ${ONE_CELL_STEP}))
      (then (i32.store (i32.const ${WRITES_AT + 4 * ONE_CELL.index}) (i32.const ${ONE_CELL.value}))))
    (if (i64.ge_s (local.get $k) (i64.const ${TWO_CELL_STEP}))
      (then
        (i32.store (i32.const ${WRITES_AT + 4 * FIRST.index}) (i32.const ${FIRST.value}))
        (i32.store (i32.const ${WRITES_AT + 4 * LAST.index}) (i32.const ${LAST.value}))))))`);

// ---------------------------------------------------------------------------------------------------
// Criterion 2: narrowing. `tile: i32 × 16`, `flip: i32 × 16`, `fine: f64 × 16`.

export const NARROW_ROWS = 16;
export const BAD_FROM = 30;
export const BAD_TO = 39;
export const GOOD_AGAIN = 40;
export const TILE_ROW = 12;
export const FLIP_ROW = 3;
export const FINE_ROW = 7;
export const NARROW_WRITES: [string, 'i32' | 'f64', number][] = [['tile', 'i32', NARROW_ROWS], ['flip', 'i32', NARROW_ROWS], ['fine', 'f64', NARROW_ROWS]];
const N = offsets(NARROW_WRITES);
/** tile[i] = i + 1, but 70,000 at row 12 for steps 30 to 39 and 5 there from step 40. */
export function tileValue(i: number, k: number): number {
  if (i !== TILE_ROW) return i + 1;
  if (k >= BAD_FROM && k <= BAD_TO) return 70_000;
  return k >= GOOD_AGAIN ? 5 : i + 1;
}
/** flip[i] = 0, but −1 at row 3 for steps 30 to 39. */
export const flipValue = (i: number, k: number): number => (i === FLIP_ROW && k >= BAD_FROM && k <= BAD_TO ? -1 : 0);
/** fine[i] = 16 + 16 i, the row's x in u, but NaN at row 7 for steps 30 to 39. */
export const fineValue = (i: number, k: number): number => (i === FINE_ROW && k >= BAD_FROM && k <= BAD_TO ? Number.NaN : 16 + 16 * i);
const bad = (body: string): string =>
  `(if (i32.and (i64.ge_s (local.get $k) (i64.const ${BAD_FROM})) (i64.le_s (local.get $k) (i64.const ${BAD_TO}))) (then ${body}))`;
export const narrowProgram = (): Program => assemble('narrow', `
(module${head(1)}
  (func (export "step") (param $k i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const ${N['tile']}) (i32.shl (local.get $i) (i32.const 2))) (i32.add (local.get $i) (i32.const 1)))
      (i32.store (i32.add (i32.const ${N['flip']}) (i32.shl (local.get $i) (i32.const 2))) (i32.const 0))
      (f64.store (i32.add (i32.const ${N['fine']}) (i32.shl (local.get $i) (i32.const 3)))
        (f64.convert_i32_u (i32.add (i32.const 16) (i32.mul (i32.const 16) (local.get $i)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${NARROW_ROWS}))))
    ${bad(`(i32.store (i32.const ${N['tile']! + 4 * TILE_ROW}) (i32.const 70000))`)}
    ${bad(`(i32.store (i32.const ${N['flip']! + 4 * FLIP_ROW}) (i32.const -1))`)}
    ${bad(`(f64.store (i32.const ${N['fine']! + 8 * FINE_ROW}) (f64.const nan))`)}
    (if (i64.ge_s (local.get $k) (i64.const ${GOOD_AGAIN}))
      (then (i32.store (i32.const ${N['tile']! + 4 * TILE_ROW}) (i32.const 5))))))`);

// ---------------------------------------------------------------------------------------------------
// Criterion 3: the pool. `alive: bool × 64`, `x: f64 × 64`, `y: f64 × 64`.

export const POOL = 64;
export const ALIVE = 10;
export const POOL_WRITES: [string, 'bool' | 'f64', number][] = [['alive', 'bool', POOL], ['x', 'f64', POOL], ['y', 'f64', POOL]];
const P = offsets(POOL_WRITES);
/** Row i's centre in u: (20 + 24 (i mod 8), 20 + 24 ⌊i ÷ 8⌋); alive for rows 0 to 9 only, at every step. */
export const actorAt = (i: number): [number, number] => [20 + 24 * (i % 8), 20 + 24 * Math.floor(i / 8)];
export const poolProgram = (): Program => assemble('actors', `
(module${head(1)}
  (func (export "step") (param $k i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const ${P['alive']}) (i32.shl (local.get $i) (i32.const 2))) (i32.lt_u (local.get $i) (i32.const ${ALIVE})))
      (f64.store (i32.add (i32.const ${P['x']}) (i32.shl (local.get $i) (i32.const 3)))
        (f64.convert_i32_u (i32.add (i32.const 20) (i32.mul (i32.const 24) (i32.rem_u (local.get $i) (i32.const 8))))))
      (f64.store (i32.add (i32.const ${P['y']}) (i32.shl (local.get $i) (i32.const 3)))
        (f64.convert_i32_u (i32.add (i32.const 20) (i32.mul (i32.const 24) (i32.div_u (local.get $i) (i32.const 8))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${POOL}))))))`);

// ---------------------------------------------------------------------------------------------------
// Criterion 4: the door. `tiles: i32 × 48` on an 8 × 6 grid; the door at cell (5, 3), index 29.

export const DOOR_COLS = 8;
export const DOOR_ROWS = 6;
export const DOOR_CELL: [number, number] = [5, 3];
export const DOOR_INDEX = DOOR_CELL[1] * DOOR_COLS + DOOR_CELL[0];
export const DOOR_STEP = 100;
/** The floor: ((cx + cy) mod 4); the door 7 before step 100 and 8 from it. */
export const doorValue = (i: number, k: number): number =>
  (i === DOOR_INDEX ? (k >= DOOR_STEP ? 8 : 7) : ((i % DOOR_COLS) + Math.floor(i / DOOR_COLS)) % 4);
export const doorProgram = (): Program => assemble('keeper', `
(module${head(1)}
  (func (export "step") (param $k i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const ${WRITES_AT}) (i32.shl (local.get $i) (i32.const 2)))
        (i32.rem_u (i32.add (i32.rem_u (local.get $i) (i32.const ${DOOR_COLS})) (i32.div_u (local.get $i) (i32.const ${DOOR_COLS}))) (i32.const 4)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${DOOR_COLS * DOOR_ROWS}))))
    (i32.store (i32.const ${WRITES_AT + 4 * DOOR_INDEX})
      (select (i32.const 8) (i32.const 7) (i64.ge_s (local.get $k) (i64.const ${DOOR_STEP}))))))`);

// ---------------------------------------------------------------------------------------------------
// Criterion 5: refusals. `big: i32 × 9,216`, `short: i32 × 9,215`, `where: vec2 × 4`; it writes nothing (all zeros).

export const COUNT_WRITES: [string, 'i32' | 'vec2', number][] = [['big', 'i32', CELLS], ['short', 'i32', CELLS - 1], ['where', 'vec2', 4]];
export const countsProgram = (): Program => assemble('counts', `
(module${head(2)}
  (func (export "step") (param $k i64)))`);

// ---------------------------------------------------------------------------------------------------
// Criterion 6: 3,000 free rows. `x`, `y`, `angle`: f64 × 3,000 each.

export const SWARM = 3_000;
export const SWARM_WRITES: [string, 'f64', number][] = [['x', 'f64', SWARM], ['y', 'f64', SWARM], ['angle', 'f64', SWARM]];
const S = offsets(SWARM_WRITES);
/** Row 0 at (10.5, 3.25) u, turned 90°; row i ≥ 1 at (26 + (i mod 50), 3 + 0.75 ⌊i ÷ 50⌋), turned 45 (i mod 8)°. */
export const POSE = { x: 10.5, y: 3.25, angle: 90 } as const;
export const swarmAt = (i: number): [number, number, number] =>
  (i === 0 ? [POSE.x, POSE.y, POSE.angle] : [26 + (i % 50), 3 + 0.75 * Math.floor(i / 50), 45 * (i % 8)]);
export const swarmProgram = (): Program => assemble('flock', `
(module${head(2)}
  (func (export "step") (param $k i64) (local $i i32)
    (local.set $i (i32.const 1))
    (loop $each
      (f64.store (i32.add (i32.const ${S['x']}) (i32.shl (local.get $i) (i32.const 3)))
        (f64.convert_i32_u (i32.add (i32.const 26) (i32.rem_u (local.get $i) (i32.const 50)))))
      (f64.store (i32.add (i32.const ${S['y']}) (i32.shl (local.get $i) (i32.const 3)))
        (f64.add (f64.const 3) (f64.mul (f64.const 0.75) (f64.convert_i32_u (i32.div_u (local.get $i) (i32.const 50))))))
      (f64.store (i32.add (i32.const ${S['angle']}) (i32.shl (local.get $i) (i32.const 3)))
        (f64.convert_i32_u (i32.mul (i32.const 45) (i32.rem_u (local.get $i) (i32.const 8)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${SWARM}))))
    (f64.store (i32.const ${S['x']}) (f64.const ${POSE.x}))
    (f64.store (i32.const ${S['y']}) (f64.const ${POSE.y}))
    (f64.store (i32.const ${S['angle']}) (f64.const ${POSE.angle}))))`);
