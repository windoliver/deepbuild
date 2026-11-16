// This suite's logic programs, as an agent would write them (README: Programs), in WebAssembly text. Every one
// exports `memory`, `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at` and `writes_at`
// (Logic `logic@1`: Exports) and keeps to the logic subset. A program that reads or writes a region entry is built
// against the item's layout as `check` reports it (read first with `layoutProbe`), so its offsets are the item's.

import { assemble, entryAt, type Layout, type Program, type Writes } from './helpers.ts';

/** A program built for no layout: `check` of an item naming it reports the item's layout. */
export const layoutProbe = (): Program => assemble('layout_probe', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 32768))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);

/** The reading criterion 1's item reads, from the source `feed` (Logic: readings: `reading:<source>`). */
export const FEED = 'reading:feed';
/** How many of a step's values `listen` writes out. */
export const SHOWN = 4;
export const LISTEN_WRITES: Writes = { count: { type: 'i32' }, values: { type: 'f64', count: SHOWN }, as_of: { type: 'f64', count: SHOWN } };
/**
 * Criterion 1: each step it reads the reading `feed`'s slot (a u32 count and 4 zero bytes, then each value as an
 * f64 followed by its as-of time as an i64 of microseconds: Logic: readings) and writes the count, the first
 * SHOWN values and their as-of times (as f64; 0 past the count).
 * Item: reads ["reading:feed"], writes {count: i32, values: f64 × 4, as_of: f64 × 4}.
 */
export const listen = (l: Layout): Program => {
  const feed = entryAt(l, 'reads', FEED).offset;
  const count = 4096 + entryAt(l, 'writes', 'count').offset;
  const values = 4096 + entryAt(l, 'writes', 'values').offset;
  const asOf = 4096 + entryAt(l, 'writes', 'as_of').offset;
  return assemble(`listen_${feed}_${count}_${values}_${asOf}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64) (local $n i32) (local $j i32)
    (local.set $n (i32.load (i32.const ${feed})))
    (i32.store (i32.const ${count}) (local.get $n))
    (loop $each
      (if (i32.lt_u (local.get $j) (local.get $n))
        (then
          (f64.store (i32.add (i32.const ${values}) (i32.shl (local.get $j) (i32.const 3)))
            (f64.load (i32.add (i32.const ${feed + 8}) (i32.shl (local.get $j) (i32.const 4)))))
          (f64.store (i32.add (i32.const ${asOf}) (i32.shl (local.get $j) (i32.const 3)))
            (f64.convert_i64_s (i64.load (i32.add (i32.const ${feed + 16}) (i32.shl (local.get $j) (i32.const 4)))))))
        (else
          (f64.store (i32.add (i32.const ${values}) (i32.shl (local.get $j) (i32.const 3))) (f64.const 0))
          (f64.store (i32.add (i32.const ${asOf}) (i32.shl (local.get $j) (i32.const 3))) (f64.const 0))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br_if $each (i32.lt_u (local.get $j) (i32.const ${SHOWN}))))))`);
};

/** The control criterion 2's presses are entries of. */
export const PRESS = 'press';
export const FIRST_WRITES: Writes = { first: { type: 'i32' }, n: { type: 'i32' } };
/**
 * Criterion 2: each step it writes how many entries of `press` it read (`n`) and the player of the first one
 * (`first`, the u32 at the slot's offset 8: Logic `logic@1`'s control slot), 0 when it read none.
 * Item: reads ["press"], writes {first: i32, n: i32}.
 */
export const firstPlayer = (l: Layout): Program => {
  const press = entryAt(l, 'reads', PRESS).offset;
  const first = 4096 + entryAt(l, 'writes', 'first').offset;
  const n = 4096 + entryAt(l, 'writes', 'n').offset;
  return assemble(`first_${press}_${first}_${n}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const ${n}) (i32.load (i32.const ${press})))
    (i32.store (i32.const ${first})
      (select (i32.load (i32.const ${press + 8})) (i32.const 0) (i32.ne (i32.load (i32.const ${press})) (i32.const 0))))))`);
};

export const BOIDS = 100;
export const FLOCK_WRITES: Writes = { cx: { type: 'f64' } };
/**
 * Criterion 4: a flock of 100 boids on a 10 × 10 grid that reads nothing. Each step it finds the flock's centre,
 * writes its x (`cx`, the first write at offset 0), and moves every boid toward the centre with a steady drift
 * in x; positions at 8192, velocities after them. `flockCx` mirrors it.
 * Item: writes {cx: f64}.
 */
export const flock = (): Program => assemble('flock', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64) (local $i i32) (local $p i32)
    (loop $place
      (local.set $p (i32.add (i32.const 8192) (i32.shl (local.get $i) (i32.const 4))))
      (f64.store (local.get $p) (f64.convert_i32_u (i32.rem_u (local.get $i) (i32.const 10))))
      (f64.store offset=8 (local.get $p) (f64.convert_i32_u (i32.div_u (local.get $i) (i32.const 10))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $place (i32.lt_u (local.get $i) (i32.const ${BOIDS})))))
  (func $step (export "step") (param $k i64)
    (local $i i32) (local $p i32) (local $v i32) (local $cx f64) (local $cy f64) (local $vx f64) (local $vy f64)
    (loop $sum
      (local.set $p (i32.add (i32.const 8192) (i32.shl (local.get $i) (i32.const 4))))
      (local.set $cx (f64.add (local.get $cx) (f64.load (local.get $p))))
      (local.set $cy (f64.add (local.get $cy) (f64.load offset=8 (local.get $p))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $sum (i32.lt_u (local.get $i) (i32.const ${BOIDS}))))
    (local.set $cx (f64.div (local.get $cx) (f64.const ${BOIDS})))
    (local.set $cy (f64.div (local.get $cy) (f64.const ${BOIDS})))
    (f64.store (i32.const 4096) (local.get $cx))
    (local.set $i (i32.const 0))
    (loop $move
      (local.set $p (i32.add (i32.const 8192) (i32.shl (local.get $i) (i32.const 4))))
      (local.set $v (i32.add (i32.const ${8192 + 16 * BOIDS}) (i32.shl (local.get $i) (i32.const 4))))
      (local.set $vx (f64.mul (f64.const 0.99) (f64.add (f64.load (local.get $v))
        (f64.add (f64.mul (f64.sub (local.get $cx) (f64.load (local.get $p))) (f64.const 0.001)) (f64.const 0.005)))))
      (local.set $vy (f64.mul (f64.const 0.99) (f64.add (f64.load offset=8 (local.get $v))
        (f64.mul (f64.sub (local.get $cy) (f64.load offset=8 (local.get $p))) (f64.const 0.001)))))
      (f64.store (local.get $v) (local.get $vx))
      (f64.store offset=8 (local.get $v) (local.get $vy))
      (f64.store (local.get $p) (f64.add (f64.load (local.get $p)) (f64.div (local.get $vx) (f64.const 60))))
      (f64.store offset=8 (local.get $p) (f64.add (f64.load offset=8 (local.get $p)) (f64.div (local.get $vy) (f64.const 60))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $move (i32.lt_u (local.get $i) (i32.const ${BOIDS}))))))`);

/** The flock's `cx` at steps 0 to n − 1, computed as `flock` computes it (the same f64 operations in the same order). */
export function flockCx(n: number): number[] {
  const px: number[] = []; const py: number[] = []; const vx: number[] = []; const vy: number[] = [];
  for (let i = 0; i < BOIDS; i++) { px.push(i % 10); py.push(Math.floor(i / 10)); vx.push(0); vy.push(0); }
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    let cx = 0; let cy = 0;
    for (let i = 0; i < BOIDS; i++) { cx += px[i]!; cy += py[i]!; }
    cx /= BOIDS; cy /= BOIDS;
    out.push(cx);
    for (let i = 0; i < BOIDS; i++) {
      const x = 0.99 * (vx[i]! + ((cx - px[i]!) * 0.001 + 0.005));
      const y = 0.99 * (vy[i]! + (cy - py[i]!) * 0.001);
      vx[i] = x; vy[i] = y;
      px[i] = px[i]! + x / 60;
      py[i] = py[i]! + y / 60;
    }
  }
  return out;
}

export const QUESTIONS = 5;
export const QUIZ_WRITES: Writes = { question: { type: 'i32' } };
/**
 * Criterion 4: a quiz of five questions. `init` shuffles them (a xorshift64 Fisher–Yates from the seed `init`
 * gets) into memory at 8192; step k writes the question asked in second ⌊k ÷ 60⌋, order[⌊k ÷ 60⌋ mod 5]
 * (`question`, the first write at offset 0), so each second of play asks another question.
 * Item: writes {question: i32}.
 */
export const quiz = (): Program => assemble('quiz', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64) (local $s i64) (local $i i32) (local $j i32) (local $t i32)
    (local.set $s (i64.or (local.get $seed) (i64.const 1)))
    (loop $fill
      (i32.store (i32.add (i32.const 8192) (i32.shl (local.get $i) (i32.const 2))) (local.get $i))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $fill (i32.lt_u (local.get $i) (i32.const ${QUESTIONS}))))
    (local.set $i (i32.const ${QUESTIONS - 1}))
    (loop $shuffle
      (local.set $s (i64.xor (local.get $s) (i64.shl (local.get $s) (i64.const 13))))
      (local.set $s (i64.xor (local.get $s) (i64.shr_u (local.get $s) (i64.const 7))))
      (local.set $s (i64.xor (local.get $s) (i64.shl (local.get $s) (i64.const 17))))
      (local.set $j (i32.wrap_i64 (i64.rem_u (local.get $s) (i64.extend_i32_u (i32.add (local.get $i) (i32.const 1))))))
      (local.set $t (i32.load (i32.add (i32.const 8192) (i32.shl (local.get $i) (i32.const 2)))))
      (i32.store (i32.add (i32.const 8192) (i32.shl (local.get $i) (i32.const 2)))
        (i32.load (i32.add (i32.const 8192) (i32.shl (local.get $j) (i32.const 2)))))
      (i32.store (i32.add (i32.const 8192) (i32.shl (local.get $j) (i32.const 2))) (local.get $t))
      (local.set $i (i32.sub (local.get $i) (i32.const 1)))
      (br_if $shuffle (i32.gt_u (local.get $i) (i32.const 0)))))
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const 4096)
      (i32.load (i32.add (i32.const 8192)
        (i32.shl (i32.wrap_i64 (i64.rem_u (i64.div_u (local.get $k) (i64.const 60)) (i64.const ${QUESTIONS}))) (i32.const 2)))))))`);
