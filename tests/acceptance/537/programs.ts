// This suite's logic programs, as an agent would write them (README: Programs), in WebAssembly text, assembled by
// #544's assembler (../544/wat, read only). Every one exports `memory` (its maximum equal to its minimum), `init(seed:
// i64)`, `step(k: i64)` and the immutable globals `reads_at` (0: no reads) and `writes_at` (4096), and keeps to the
// logic subset (no imports). The write region is laid out as the logic module lays it: each array in declaration
// order, its elements contiguous, a bool or an i32 4 bytes, an f64 8, a vec2 16, a vec3 24 (three f64), a quat 32, each
// array starting on an 8-byte boundary. Each program writes every element it owns at every step, so an array's value
// after step k is a function of k alone, written out here beside the program as the expected values.

import { assemble, type Program } from './helpers.ts';

export const WRITES_AT = 4096;
export type ArrayType = 'bool' | 'i32' | 'f64' | 'vec2' | 'vec3' | 'quat';
const SIZE: Record<ArrayType, number> = { bool: 4, i32: 4, f64: 8, vec2: 16, vec3: 24, quat: 32 };
export type Writes = [string, ArrayType, number][];
/** The byte offset of each array of a write region in declaration order. */
export function offsets(writes: Writes): Record<string, number> {
  const out: Record<string, number> = {};
  let o = 0;
  for (const [name, type, count] of writes) {
    out[name] = WRITES_AT + o;
    o = Math.ceil((o + SIZE[type] * count) / 8) * 8;
  }
  return out;
}
/** The pages a program needs for its write region (and `extra` bytes past it). */
export function pagesFor(writes: Writes, extra = 0): number {
  const end = writes.reduce((o, [, type, count]) => Math.ceil((o + SIZE[type] * count) / 8) * 8, 0);
  return Math.ceil((WRITES_AT + end + extra) / 65_536);
}
const head = (pages: number): string => `
  (memory (export "memory") ${pages} ${pages})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func (export "init") (param $seed i64))`;
/** `(f64.const v)`, NaN written as WebAssembly text writes it. */
const f64 = (v: number): string => (Number.isNaN(v) ? '(f64.const nan)' : `(f64.const ${v})`);
/** Stores vec3 `[x, y, z]` (three f64 expressions) at element `i` (an i32 expression) of the array at `base`. */
const storeVec3 = (base: number, i: string, xyz: [string, string, string]): string => xyz.map((e, k) =>
  `(f64.store (i32.add (i32.const ${base + 8 * k}) (i32.mul ${i} (i32.const 24))) ${e})`).join('\n      ');
/** A program that writes nothing: its arrays read zero at every step (the refusals' fixtures). */
export const zerosProgram = (name: string, writes: Writes): Program => assemble(name, `
(module${head(pagesFor(writes))}
  (func (export "step") (param $k i64)))`);

// ---------------------------------------------------------------------------------------------------
// Criterion 1: 16 slots. `live: bool × 16`, `gen: i32 × 16` (read as u32), `pos: vec3 × 16`.

export const SLOTS = 16;
export const SLOT = 3;
export const OFF_FROM = 50;
export const OFF_TO = 59;
export const ON_AGAIN = 60;
export const SLOT_WRITES: Writes = [['live', 'bool', SLOTS], ['gen', 'i32', SLOTS], ['pos', 'vec3', SLOTS]];
/** Slot i stands at (−6 + 4 (i mod 4), 0, −6 + 4 ⌊i ÷ 4⌋) m. */
export const slotAt = (i: number): [number, number, number] => [-6 + 4 * (i % 4), 0, -6 + 4 * Math.floor(i / 4)];
export interface SlotPlan { offFrom: number; offTo: number; gen2From: number }
/** The criterion's plan: slot 3 live with gen 1 from step 0, not live at steps 50 to 59, live with gen 2 from step 60. */
export const PLAN: SlotPlan = { offFrom: OFF_FROM, offTo: OFF_TO, gen2From: ON_AGAIN };
/** The seeds' reference: slot 3 live with gen 2 from step 0, never off. */
export const GEN2_PLAN: SlotPlan = { offFrom: 1_000_000, offTo: 0, gen2From: 0 };
/** Slot i's (live, gen) after step k under `plan`: every slot live with gen 1, slot 3 as the plan says. */
export function slotState(i: number, k: number, plan: SlotPlan = PLAN): { live: boolean; gen: number } {
  if (i !== SLOT) return { live: true, gen: 1 };
  return { live: !(k >= plan.offFrom && k <= plan.offTo), gen: k >= plan.gen2From ? 2 : 1 };
}
export function slotsProgram(plan: SlotPlan = PLAN): Program {
  const o = offsets(SLOT_WRITES);
  return assemble(`slots-${plan.offFrom}-${plan.offTo}-${plan.gen2From}`, `
(module${head(pagesFor(SLOT_WRITES))}
  (func (export "step") (param $k i64) (local $i i32)
    (loop $each
      (i32.store (i32.add (i32.const ${o['live']}) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
      (i32.store (i32.add (i32.const ${o['gen']}) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
      ${storeVec3(o['pos']!, '(local.get $i)', [
        '(f64.convert_i32_s (i32.add (i32.const -6) (i32.mul (i32.const 4) (i32.rem_u (local.get $i) (i32.const 4)))))',
        '(f64.const 0)',
        '(f64.convert_i32_s (i32.add (i32.const -6) (i32.mul (i32.const 4) (i32.div_u (local.get $i) (i32.const 4)))))',
      ])}
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${SLOTS}))))
    (if (i32.and (i64.ge_s (local.get $k) (i64.const ${plan.offFrom})) (i64.le_s (local.get $k) (i64.const ${plan.offTo})))
      (then (i32.store (i32.const ${o['live']! + 4 * SLOT}) (i32.const 0))))
    (if (i64.ge_s (local.get $k) (i64.const ${plan.gen2From}))
      (then (i32.store (i32.const ${o['gen']! + 4 * SLOT}) (i32.const 2))))))`);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: the fog grid. `fog: i32 × 16,384`, row-major over 128 × 128 cells: index 128 cz + cx.

export const GRID = 128;
export const CELLS = GRID * GRID;
/** The step that sets the 9 × 9 square centred on cell (64, 64) to 2 and every other cell to 0. */
export const SQUARE_STEP = 600;
export const SQUARE = { from: 60, to: 68 } as const;
export const FOG_WRITES: Writes = [['fog', 'i32', CELLS]];
export const inSquare = (cx: number, cz: number): boolean => cx >= SQUARE.from && cx <= SQUARE.to && cz >= SQUARE.from && cz <= SQUARE.to;
/**
 * Cell (cx, cz)'s value after step k: (cx + cz + k) mod 3 before step 600 (every cell changes at every step: fog, dim
 * and none in diagonal bands that move), and from step 600 the square: 2 (none) inside, 0 (fog) everywhere else.
 */
export const fogValue = (cx: number, cz: number, k: number): number => (k < SQUARE_STEP ? (cx + cz + k) % 3 : inSquare(cx, cz) ? 2 : 0);
export function fogProgram(): Program {
  const o = offsets(FOG_WRITES)['fog']!;
  return assemble('fog', `
(module${head(pagesFor(FOG_WRITES))}
  (func (export "step") (param $k i64) (local $i i32) (local $cx i32) (local $cz i32) (local $km i32)
    (local.set $km (i32.wrap_i64 (i64.rem_s (local.get $k) (i64.const 3))))
    (loop $each
      (local.set $cx (i32.and (local.get $i) (i32.const ${GRID - 1})))
      (local.set $cz (i32.shr_u (local.get $i) (i32.const 7)))
      (i32.store (i32.add (i32.const ${o}) (i32.shl (local.get $i) (i32.const 2)))
        (if (result i32) (i64.lt_s (local.get $k) (i64.const ${SQUARE_STEP}))
          (then (i32.rem_u (i32.add (i32.add (local.get $cx) (local.get $cz)) (local.get $km)) (i32.const 3)))
          (else (select (i32.const 2) (i32.const 0)
            (i32.and
              (i32.and (i32.ge_u (local.get $cx) (i32.const ${SQUARE.from})) (i32.le_u (local.get $cx) (i32.const ${SQUARE.to})))
              (i32.and (i32.ge_u (local.get $cz) (i32.const ${SQUARE.from})) (i32.le_u (local.get $cz) (i32.const ${SQUARE.to}))))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${CELLS}))))))`);
}
/** Three grids for the overlay refusal: `fog`, `a`, `b`, each i32 × 16,384 (all zero). */
export const THREE_GRIDS: Writes = [['fog', 'i32', CELLS], ['a', 'i32', CELLS], ['b', 'i32', CELLS]];

// ---------------------------------------------------------------------------------------------------
// Criterion 3: the line's points. `points: vec3 × 64`: segment s (0 to 31) joins points 2s and 2s + 1.

export const POINTS = 64;
export const SEGMENTS = 32;
/** The step that changes only elements 10 and 11 (segment 5), and the steps element 7 (segment 3's end) is NaN. */
export const ONLY_10_11 = 100;
export const MOVED_SEGMENT = 5;
export const NAN_FROM = 120;
export const NAN_TO = 129;
export const NAN_ELEMENT = 7;
export const NAN_SEGMENT = 3;
/** The 20 sampled steps: 0, 5, …, 95, at each of which every point has moved since the step before. */
export const SAMPLED = Array.from({ length: 20 }, (_, i) => 5 * i);
export const LINE_WRITES: Writes = [['points', 'vec3', POINTS]];
/**
 * Point j after step k: segment s = ⌊j ÷ 2⌋ in column ⌊s ÷ 8⌋ and row s mod 8, from (−16 + 8 col, 0, −14 + 4 row) to
 * 4 m along +x, every point shifted 0.0625 min(k, 99) m along +x (so every point moves at each step up to 99, then
 * stops); from step 100 segment 5 stands 1.5 m further along +z (step 100 changes elements 10 and 11 alone); element 7
 * is NaN (its x) at steps 120 to 129.
 */
export function pointAt(j: number, k: number): [number, number, number] {
  const s = Math.floor(j / 2);
  const x = -16 + 8 * Math.floor(s / 8) + 4 * (j % 2) + 0.0625 * Math.min(k, 99);
  const z = -14 + 4 * (s % 8) + (s === MOVED_SEGMENT && k >= ONLY_10_11 ? 1.5 : 0);
  return [j === NAN_ELEMENT && k >= NAN_FROM && k <= NAN_TO ? Number.NaN : x, 0, z];
}
export function lineProgram(): Program {
  const o = offsets(LINE_WRITES)['points']!;
  return assemble('laser', `
(module${head(pagesFor(LINE_WRITES))}
  (func (export "step") (param $k i64) (local $j i32) (local $s i32) (local $shift f64)
    (local.set $shift (f64.mul (f64.const 0.0625)
      (f64.convert_i64_s (select (local.get $k) (i64.const 99) (i64.lt_s (local.get $k) (i64.const 99))))))
    (loop $each
      (local.set $s (i32.shr_u (local.get $j) (i32.const 1)))
      ${storeVec3(o, '(local.get $j)', [
        `(f64.add (local.get $shift) (f64.convert_i32_s (i32.add (i32.const -16)
          (i32.add (i32.mul (i32.const 8) (i32.shr_u (local.get $s) (i32.const 3))) (i32.mul (i32.const 4) (i32.and (local.get $j) (i32.const 1)))))))`,
        '(f64.const 0)',
        `(f64.add (f64.convert_i32_s (i32.add (i32.const -14) (i32.mul (i32.const 4) (i32.and (local.get $s) (i32.const 7)))))
          (select (f64.const 1.5) (f64.const 0)
            (i32.and (i32.eq (local.get $s) (i32.const ${MOVED_SEGMENT})) (i64.ge_s (local.get $k) (i64.const ${ONLY_10_11})))))`,
      ])}
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $j) (i32.const ${POINTS}))))
    (if (i32.and (i64.ge_s (local.get $k) (i64.const ${NAN_FROM})) (i64.le_s (local.get $k) (i64.const ${NAN_TO})))
      (then (f64.store (i32.const ${o + 24 * NAN_ELEMENT}) ${f64(Number.NaN)})))))`);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4: tanks. `live: bool × N`, `gen: i32 × N`, `pos: vec3 × N`, `yaw`, `turret`, `barrel`: f64 × N (degrees).

export interface Army { n: number; width: number; spacing: number; x0: number; z0: number; freeze: number | null }
/** The 1,000 tanks: a 40 × 25 grid 10 m apart, their turrets and barrels still from step 199. */
export const ARMY: Army = { n: 1000, width: 40, spacing: 10, x0: -195, z0: -120, freeze: 199 };
/** The 2,000 units of the budget: a 50 × 40 grid 8 m apart, every turret and barrel moving at every step. */
export const HORDE: Army = { n: 2000, width: 50, spacing: 8, x0: -196, z0: -156, freeze: null };
/** The one turret that turns at step 210, when nothing else moves. */
export const TURNED = 417;
export const TURN_STEP = 210;
/** The 20 sampled steps: 0, 10, …, 190. */
export const TANK_SAMPLED = Array.from({ length: 20 }, (_, i) => 10 * i);
export const armyWrites = (a: Army): Writes => [['live', 'bool', a.n], ['gen', 'i32', a.n], ['pos', 'vec3', a.n], ['yaw', 'f64', a.n], ['turret', 'f64', a.n], ['barrel', 'f64', a.n]];
/** Tank i after step k: live, gen 1, at its grid place, turned (37 i) mod 360° about +Y; its turret's yaw
 * ((13 i + 3 kk) mod 360)°, 45° more for tank 417 from step 210; its barrel's pitch (2 ((i + kk) mod 8) − 5)°, kk being k
 * held at the army's freeze step. */
export function tankAt(a: Army, i: number, k: number): { pos: [number, number, number]; yaw: number; turret: number; barrel: number } {
  const kk = a.freeze === null ? k : Math.min(k, a.freeze);
  return {
    pos: [a.x0 + a.spacing * (i % a.width), 0, a.z0 + a.spacing * Math.floor(i / a.width)],
    yaw: (37 * i) % 360,
    turret: ((13 * i + 3 * kk) % 360) + (a === ARMY && i === TURNED && k >= TURN_STEP ? 45 : 0),
    barrel: 2 * ((i + kk) % 8) - 5,
  };
}
export function armyProgram(a: Army): Program {
  const w = armyWrites(a);
  const o = offsets(w);
  const kk = a.freeze === null ? '(i32.wrap_i64 (local.get $k))'
    : `(i32.wrap_i64 (select (local.get $k) (i64.const ${a.freeze}) (i64.lt_s (local.get $k) (i64.const ${a.freeze}))))`;
  const turn = a === ARMY
    ? `(if (i64.ge_s (local.get $k) (i64.const ${TURN_STEP}))
      (then (f64.store (i32.const ${o['turret']! + 8 * TURNED}) (f64.add (f64.load (i32.const ${o['turret']! + 8 * TURNED})) (f64.const 45)))))`
    : '';
  return assemble(`army-${a.n}`, `
(module${head(pagesFor(w))}
  (func (export "step") (param $k i64) (local $i i32) (local $kk i32)
    (local.set $kk ${kk})
    (loop $each
      (i32.store (i32.add (i32.const ${o['live']}) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
      (i32.store (i32.add (i32.const ${o['gen']}) (i32.shl (local.get $i) (i32.const 2))) (i32.const 1))
      ${storeVec3(o['pos']!, '(local.get $i)', [
        `(f64.convert_i32_s (i32.add (i32.const ${a.x0}) (i32.mul (i32.const ${a.spacing}) (i32.rem_u (local.get $i) (i32.const ${a.width})))))`,
        '(f64.const 0)',
        `(f64.convert_i32_s (i32.add (i32.const ${a.z0}) (i32.mul (i32.const ${a.spacing}) (i32.div_u (local.get $i) (i32.const ${a.width})))))`,
      ])}
      (f64.store (i32.add (i32.const ${o['yaw']}) (i32.shl (local.get $i) (i32.const 3)))
        (f64.convert_i32_u (i32.rem_u (i32.mul (i32.const 37) (local.get $i)) (i32.const 360))))
      (f64.store (i32.add (i32.const ${o['turret']}) (i32.shl (local.get $i) (i32.const 3)))
        (f64.convert_i32_u (i32.rem_u (i32.add (i32.mul (i32.const 13) (local.get $i)) (i32.mul (i32.const 3) (local.get $kk))) (i32.const 360))))
      (f64.store (i32.add (i32.const ${o['barrel']}) (i32.shl (local.get $i) (i32.const 3)))
        (f64.convert_i32_s (i32.sub (i32.mul (i32.const 2) (i32.rem_u (i32.add (local.get $i) (local.get $kk)) (i32.const 8))) (i32.const 5))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $i) (i32.const ${a.n}))))
    ${turn}))`);
}

// ---------------------------------------------------------------------------------------------------
// The oracle lane: a pool whose live and gen rows come from a table the program carries, one row a step.

/** A pool of `slots` slots whose (live, gen) after step k is `table[min(k, steps − 1)][slot]`, every slot at a fixed place. */
export function poolProgram(name: string, table: { live: boolean; gen: number }[][]): Program {
  const slots = table[0]!.length;
  const writes: Writes = [['live', 'bool', slots], ['gen', 'i32', slots], ['pos', 'vec3', slots]];
  const o = offsets(writes);
  const tableAt = WRITES_AT + 4096;
  const bytes = Buffer.alloc(table.length * slots * 8);
  table.forEach((row, k) => row.forEach((c, s) => { bytes.writeInt32LE(c.live ? 1 : 0, (k * slots + s) * 8); bytes.writeInt32LE(c.gen, (k * slots + s) * 8 + 4); }));
  const data = [...bytes].map((b) => `\\${b.toString(16).padStart(2, '0')}`).join('');
  const pages = Math.ceil((tableAt + bytes.length) / 65_536);
  return assemble(name, `
(module
  (memory (export "memory") ${pages} ${pages})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (data (i32.const ${tableAt}) "${data}")
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64) (local $s i32) (local $row i32)
    (local.set $row (i32.add (i32.const ${tableAt}) (i32.mul (i32.const ${slots * 8})
      (i32.wrap_i64 (select (local.get $k) (i64.const ${table.length - 1}) (i64.lt_s (local.get $k) (i64.const ${table.length - 1})))))))
    (loop $each
      (i32.store (i32.add (i32.const ${o['live']}) (i32.shl (local.get $s) (i32.const 2)))
        (i32.load (i32.add (local.get $row) (i32.shl (local.get $s) (i32.const 3)))))
      (i32.store (i32.add (i32.const ${o['gen']}) (i32.shl (local.get $s) (i32.const 2)))
        (i32.load (i32.add (i32.add (local.get $row) (i32.shl (local.get $s) (i32.const 3))) (i32.const 4))))
      ${storeVec3(o['pos']!, '(local.get $s)', [
        '(f64.convert_i32_s (i32.mul (i32.const 2) (i32.rem_u (local.get $s) (i32.const 4))))',
        '(f64.const 0)',
        '(f64.convert_i32_s (i32.mul (i32.const 2) (i32.div_u (local.get $s) (i32.const 4))))',
      ])}
      (local.set $s (i32.add (local.get $s) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $s) (i32.const ${slots}))))))`);
}
