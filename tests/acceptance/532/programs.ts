// This suite's logic programs, as an agent would write them (README: Programs), in WebAssembly text. Every one
// exports `memory`, `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at` and `writes_at`
// (Logic `logic@1`: Exports), with `assets_at` where it names data assets, and keeps to the logic subset.
// A program that reads or writes a region entry is built against the item's layout as `check` reports it
// (read first with `layoutProbe`), so its offsets are the item's.

import { assemble, entryAt, type Layout, type Program } from './helpers.ts';

/** A program built for no layout: `check` of an item naming it reports the item's layout. */
export const layoutProbe = (): Program => assemble('layout_probe', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 32768))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);

export const BOIDS = 100;
/** The flock's item: it reads the wind slider and writes 100 positions. */
export const FLOCK_WRITES = { pos: { type: 'vec2' as const, count: BOIDS } };

/**
 * Criteria 1, 2 and 5: a flock of 100 boids. Each step it takes the wind slider's last entry of the step into
 * the mutable global $wind, finds the flock's centre, and moves every boid toward it, pushed by the wind and by
 * a jitter from a xorshift64 generator whose state is the mutable global $rng (seeded by `init`); it keeps
 * positions at 8192 and velocities at 9792 and copies the positions into the write region. Its state is its
 * memory and those two globals, so a checkpoint without its globals restores another flock.
 * Item: reads ["wind"], writes {pos: vec2 × 100}.
 */
export const flock = (l: Layout): Program => {
  const wind = entryAt(l, 'reads', 'wind').offset;
  const pos = 4096 + entryAt(l, 'writes', 'pos').offset;
  return assemble(`flock_${wind}_${pos}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global $rng (mut i64) (i64.const 0))
  (global $wind (mut f64) (f64.const 0))
  (func $init (export "init") (param $seed i64) (local $i i32) (local $p i32)
    (global.set $rng (i64.or (local.get $seed) (i64.const 1)))
    (loop $place
      (local.set $p (i32.add (i32.const 8192) (i32.shl (local.get $i) (i32.const 4))))
      (f64.store (local.get $p) (f64.convert_i32_u (i32.rem_u (local.get $i) (i32.const 10))))
      (f64.store offset=8 (local.get $p) (f64.convert_i32_u (i32.div_u (local.get $i) (i32.const 10))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $place (i32.lt_u (local.get $i) (i32.const ${BOIDS})))))
  ;; xorshift64 on $rng, as a value in [-0.5, 0.5)
  (func $jitter (result f64)
    (global.set $rng (i64.xor (global.get $rng) (i64.shl (global.get $rng) (i64.const 13))))
    (global.set $rng (i64.xor (global.get $rng) (i64.shr_u (global.get $rng) (i64.const 7))))
    (global.set $rng (i64.xor (global.get $rng) (i64.shl (global.get $rng) (i64.const 17))))
    (f64.sub (f64.div (f64.convert_i64_u (i64.and (global.get $rng) (i64.const 65535))) (f64.const 65536)) (f64.const 0.5)))
  (func $step (export "step") (param $k i64)
    (local $i i32) (local $p i32) (local $v i32) (local $n i32) (local $cx f64) (local $cy f64) (local $vx f64) (local $vy f64)
    (local.set $n (i32.load (i32.const ${wind})))
    (if (i32.gt_u (local.get $n) (i32.const 0))
      (then (global.set $wind (f64.load (i32.add (i32.const ${wind + 16}) (i32.shl (i32.sub (local.get $n) (i32.const 1)) (i32.const 4)))))))
    (loop $sum
      (local.set $p (i32.add (i32.const 8192) (i32.shl (local.get $i) (i32.const 4))))
      (local.set $cx (f64.add (local.get $cx) (f64.load (local.get $p))))
      (local.set $cy (f64.add (local.get $cy) (f64.load offset=8 (local.get $p))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $sum (i32.lt_u (local.get $i) (i32.const ${BOIDS}))))
    (local.set $cx (f64.div (local.get $cx) (f64.const ${BOIDS})))
    (local.set $cy (f64.div (local.get $cy) (f64.const ${BOIDS})))
    (local.set $i (i32.const 0))
    (loop $move
      (local.set $p (i32.add (i32.const 8192) (i32.shl (local.get $i) (i32.const 4))))
      (local.set $v (i32.add (i32.const ${8192 + 16 * BOIDS}) (i32.shl (local.get $i) (i32.const 4))))
      (local.set $vx (f64.mul (f64.const 0.99) (f64.add (f64.load (local.get $v))
        (f64.add (f64.mul (f64.sub (local.get $cx) (f64.load (local.get $p))) (f64.const 0.001))
          (f64.add (f64.mul (global.get $wind) (f64.const 0.01)) (f64.mul (call $jitter) (f64.const 0.01)))))))
      (local.set $vy (f64.mul (f64.const 0.99) (f64.add (f64.load offset=8 (local.get $v))
        (f64.add (f64.mul (f64.sub (local.get $cy) (f64.load offset=8 (local.get $p))) (f64.const 0.001))
          (f64.mul (call $jitter) (f64.const 0.01))))))
      (f64.store (local.get $v) (local.get $vx))
      (f64.store offset=8 (local.get $v) (local.get $vy))
      (f64.store (local.get $p) (f64.add (f64.load (local.get $p)) (f64.div (local.get $vx) (f64.const 60))))
      (f64.store offset=8 (local.get $p) (f64.add (f64.load offset=8 (local.get $p)) (f64.div (local.get $vy) (f64.const 60))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $move (i32.lt_u (local.get $i) (i32.const ${BOIDS}))))
    (memory.copy (i32.const ${pos}) (i32.const 8192) (i32.const ${16 * BOIDS}))))`);
};

/** The step at which `hungry` spends most of its fuel. */
export const HUNGRY_STEP = 7;
/** `hungry`'s loop count at HUNGRY_STEP: eight instructions an iteration, about 720,000 fuel of a 1,000,000 budget. */
export const HUNGRY_LOOPS = 90_000;
/**
 * Criterion 2: a step that counts to HUNGRY_LOOPS at step HUNGRY_STEP and does nothing more at other steps;
 * every step writes k. Item: writes {k: i32}, the default fuel budget (1,000,000).
 */
export const hungry = (): Program => assemble('hungry', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64) (local $i i32)
    (if (i64.eq (local.get $k) (i64.const ${HUNGRY_STEP}))
      (then (loop $count
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $count (i32.lt_u (local.get $i) (i32.const ${HUNGRY_LOOPS}))))))
    (i32.store (i32.const 4096) (i32.wrap_i64 (local.get $k)))))`);

/** Where `secret` keeps its private flag: memory no region holds and no array shows. */
export const FLAG_AT = 8192;
/**
 * Criterion 3: a press of A (any entry of `a` in a step) sets the private flag at FLAG_AT to 1; a press of
 * Reveal (any entry of `reveal`) copies the flag into `shown`. Nothing else reads or writes the flag, so until
 * a Reveal no step hash or array depends on it. Every step writes k into `tick`.
 * Item: reads ["a", "reveal"], writes {shown: i32, tick: i32}.
 */
export const secret = (l: Layout): Program => {
  const a = entryAt(l, 'reads', 'a').offset;
  const reveal = entryAt(l, 'reads', 'reveal').offset;
  const shown = 4096 + entryAt(l, 'writes', 'shown').offset;
  const tick = 4096 + entryAt(l, 'writes', 'tick').offset;
  return assemble(`secret_${a}_${reveal}_${shown}_${tick}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (if (i32.ne (i32.load (i32.const ${a})) (i32.const 0))
      (then (i32.store (i32.const ${FLAG_AT}) (i32.const 1))))
    (if (i32.ne (i32.load (i32.const ${reveal})) (i32.const 0))
      (then (i32.store (i32.const ${shown}) (i32.load (i32.const ${FLAG_AT})))))
    (i32.store (i32.const ${tick}) (i32.wrap_i64 (local.get $k)))))`);
};

/** The test asset's size: 64 KiB. */
export const ASSET_BYTES = 65_536;
/** `atlas`'s memory: four pages. */
export const ATLAS_MEMORY = 4 * 65_536;
/** The FNV-1a 32 hash `atlas` computes over an asset's bytes, as the signed i32 it writes. */
export function fnv1a(bytes: Buffer): number {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return h | 0;
}
/**
 * Criterion 4: a program that names data assets, which the logic module copies into its memory from
 * `assets_at` before the start function, each after a u32 of its length. Its start function reads the first
 * asset's length and hashes its bytes (fnv1a) into memory; at step 0 the step hashes them again; every step
 * then adds 1 to one byte of the asset's copy (byte (k × 7,919) mod length), so the copy in memory is the
 * program's own state from then on and no array shows it. Every step writes both hashes and the length.
 * Item: assets [the asset], writes {start_sum: i32, step0_sum: i32, len: i32}, budget {fuel: 4,000,000}.
 */
export const atlas = (l: Layout, assetsAt: number): Program => {
  const startSum = 4096 + entryAt(l, 'writes', 'start_sum').offset;
  const step0Sum = 4096 + entryAt(l, 'writes', 'step0_sum').offset;
  const len = 4096 + entryAt(l, 'writes', 'len').offset;
  return assemble(`atlas_${assetsAt}_${startSum}_${step0Sum}_${len}`, `
(module
  (memory (export "memory") 4 4)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global (export "assets_at") i32 (i32.const ${assetsAt}))
  ;; state: 8192 the start function's hash, 8196 step 0's hash, 8200 the length it read
  (func $fnv (result i32) (local $i i32) (local $n i32) (local $h i32)
    (local.set $n (i32.load (i32.const ${assetsAt})))
    (local.set $h (i32.const 0x811c9dc5))
    (block $done
      (br_if $done (i32.eqz (local.get $n)))
      (loop $byte
        (local.set $h (i32.mul (i32.xor (local.get $h) (i32.load8_u (i32.add (i32.const ${assetsAt + 4}) (local.get $i)))) (i32.const 0x01000193)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $byte (i32.lt_u (local.get $i) (local.get $n)))))
    (local.get $h))
  (func $start
    (i32.store (i32.const 8192) (call $fnv))
    (i32.store (i32.const 8200) (i32.load (i32.const ${assetsAt}))))
  (start $start)
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64) (local $at i32)
    (if (i64.eqz (local.get $k)) (then (i32.store (i32.const 8196) (call $fnv))))
    (if (i32.ne (i32.load (i32.const ${assetsAt})) (i32.const 0))
      (then
        (local.set $at (i32.add (i32.const ${assetsAt + 4})
          (i32.rem_u (i32.mul (i32.wrap_i64 (local.get $k)) (i32.const 7919)) (i32.load (i32.const ${assetsAt})))))
        (i32.store8 (local.get $at) (i32.add (i32.load8_u (local.get $at)) (i32.const 1)))))
    (i32.store (i32.const ${startSum}) (i32.load (i32.const 8192)))
    (i32.store (i32.const ${step0Sum}) (i32.load (i32.const 8196)))
    (i32.store (i32.const ${len}) (i32.load (i32.const 8200)))))`);
};

/** Criterion 6: a step that does nothing. Item: writes {v: i32}, which it never writes. */
export const idle = (): Program => assemble('idle', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);
