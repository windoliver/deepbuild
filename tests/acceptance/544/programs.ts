// This suite's logic programs, as an agent would write them (README: Programs), in WebAssembly text. Every one
// exports `memory`, `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at`, `writes_at` and, for an
// item that declares `emits` (all but `ticker`), `emits_at` (Logic `logic@1`: Exports), and keeps to the logic subset
// (one memory whose maximum is its minimum, no imports). Regions: reads at 0, writes at 4096, emits at 8192.
//
// The emit region is laid out as the design gives it (Logic: occurrences): for each kind in declaration order, a u32
// count, then `max_per_step` rows of {a: u32, b: u32, its fields in declaration order}, little-endian, each field at
// its type's size. Every item here declares one kind, so its count is at 8192 and row i at 8196 + i × the row's
// bytes (8 + its fields: 16 for {power: f64}, 8 for no fields). The module zeroes the count before each step, and
// each program still writes it every step. The read region is filled in declaration order (Logic `logic@1`:
// Semantics), so an item's first read control's slot (a u32 count, 4 zero bytes, then its entries) is at 0.

import { assemble, type Program } from './helpers.ts';

const READS_AT = 0;
const WRITES_AT = 4096;
const EMITS_AT = 8192;
/** Row i of the first kind's block, for rows of `bytes` bytes. */
const rowAt = (i: number, bytes: number): number => EMITS_AT + 4 + i * bytes;

const head = `
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global (export "emits_at") i32 (i32.const ${EMITS_AT}))
  (func $init (export "init") (param $seed i64))`;

/**
 * Criteria 1 and 5, the shot lab: on each entry of Fire in a step (its read slot's count at 0), one shot row with a
 * the press's number from 1 (kept in the mutable global $presses), b 0 and power the press's number as an f64.
 * Item: reads ["fire"], emits {shot: {fields: {power: f64}}} (16 a step).
 */
export const shot = (): Program => assemble('shot', `
(module${head}
  (global $presses (mut i32) (i32.const 0))
  (func $step (export "step") (param $k i64) (local $n i32) (local $i i32) (local $row i32)
    (local.set $n (i32.load (i32.const ${READS_AT})))
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (global.set $presses (i32.add (global.get $presses) (i32.const 1)))
        (local.set $row (i32.add (i32.const ${rowAt(0, 16)}) (i32.shl (local.get $i) (i32.const 4))))
        (i32.store (local.get $row) (global.get $presses))
        (i32.store offset=4 (local.get $row) (i32.const 0))
        (f64.store offset=8 (local.get $row) (f64.convert_i32_u (global.get $presses)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $each)))
    (i32.store (i32.const ${EMITS_AT}) (local.get $n))))`);

/** The steps `overfull` writes rows at, and how many: three, then four (its cap), then five. */
export const OVERFULL = { 30: 3, 60: 4, 90: 5 } as const;
export const TRAP_STEP = 90;
/**
 * Criterion 2: at step 30 three shot rows, at step 60 four, at step 90 five; row i of step k has a k, b i and power k.
 * Every step, after its rows, it writes k into `last`, so a module that copied the write region of the step that
 * traps would show 90 there. Item: writes {last: i32}, emits {shot: {fields: {power: f64}, max_per_step: 4}}.
 */
export const overfull = (): Program => assemble('overfull', `
(module${head}
  (func $step (export "step") (param $k i64) (local $n i32) (local $i i32) (local $row i32)
    (local.set $n (i32.const 0))
    ${Object.entries(OVERFULL).map(([k, n]) => `(if (i64.eq (local.get $k) (i64.const ${k})) (then (local.set $n (i32.const ${n}))))`).join('\n    ')}
    (block $done
      (loop $each
        (br_if $done (i32.ge_u (local.get $i) (local.get $n)))
        (local.set $row (i32.add (i32.const ${rowAt(0, 16)}) (i32.shl (local.get $i) (i32.const 4))))
        (i32.store (local.get $row) (i32.wrap_i64 (local.get $k)))
        (i32.store offset=4 (local.get $row) (local.get $i))
        (f64.store offset=8 (local.get $row) (f64.convert_i64_u (local.get $k)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $each)))
    (i32.store (i32.const ${EMITS_AT}) (local.get $n))
    (i32.store (i32.const ${WRITES_AT}) (i32.wrap_i64 (local.get $k)))))`);

/** Criterion 2's second item, the rest of the piece: every step writes k into `n`. Item: writes {n: i32}. */
export const ticker = (): Program => assemble('ticker', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const ${READS_AT}))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const ${WRITES_AT}) (i32.wrap_i64 (local.get $k)))))`);

/** The rows `ties` writes, in the order it writes them: step, a, b, power. */
export const TIE_STEP = 75;
export const TIES_WRITTEN: [number, number, number, number][] = [
  [30, 9, 9, 9.0],
  [TIE_STEP, 7, 1, 3.0],
  [TIE_STEP, 2, 9, 2.0],
  [TIE_STEP, 2, 9, 1.0],
];
/**
 * Criterion 2's ties: at step 30 one shot row (a 9, b 9, power 9); at step 75 three, written in this order: (a 7, b 1,
 * power 3), (a 2, b 9, power 2), (a 2, b 9, power 1). Sorted by (step, kind, a, b) with ties in the order written,
 * step 75 reads (2, 9, 2), (2, 9, 1), (7, 1, 3). Item: emits {shot: {fields: {power: f64}}} (16 a step).
 */
export const ties = (): Program => {
  const at = (k: number): string => TIES_WRITTEN.filter((w) => w[0] === k).map(([, a, b, p], i) =>
    `(i32.store (i32.const ${rowAt(i, 16)}) (i32.const ${a})) (i32.store (i32.const ${rowAt(i, 16) + 4}) (i32.const ${b})) (f64.store (i32.const ${rowAt(i, 16) + 8}) (f64.const ${p}))`).join(' ');
  const count = (k: number): number => TIES_WRITTEN.filter((w) => w[0] === k).length;
  return assemble('ties', `
(module${head}
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const ${EMITS_AT}) (i32.const 0))
    (if (i64.eq (local.get $k) (i64.const 30))
      (then ${at(30)} (i32.store (i32.const ${EMITS_AT}) (i32.const ${count(30)}))))
    (if (i64.eq (local.get $k) (i64.const ${TIE_STEP}))
      (then ${at(TIE_STEP)} (i32.store (i32.const ${EMITS_AT}) (i32.const ${count(TIE_STEP)}))))))`);
};

/** The step the latch opens the door at: 5.000 s at 60 Hz. */
export const DOOR_STEP = 300;
/**
 * Criteria 3 and 4, the door's logic: at step 300 one door_open row (a 1, b 0, no fields: 8 bytes a row), and none at
 * any other step. Item: emits {door_open: {fields: {}}} (16 a step).
 */
export const latch = (): Program => assemble('latch', `
(module${head}
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const ${EMITS_AT}) (i32.const 0))
    (if (i64.eq (local.get $k) (i64.const ${DOOR_STEP}))
      (then
        (i32.store (i32.const ${rowAt(0, 8)}) (i32.const 1))
        (i32.store (i32.const ${rowAt(0, 8) + 4}) (i32.const 0))
        (i32.store (i32.const ${EMITS_AT}) (i32.const 1))))))`);
