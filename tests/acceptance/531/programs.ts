// This suite's logic programs, as an agent would write them (README: Programs), in WebAssembly text. Every one
// exports `memory`, `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at` and `writes_at`
// (Logic `logic@1`: Exports), and keeps to the logic subset unless its comment says it doesn't. Function 0 is
// `init` and function 1 is `step` unless a comment says otherwise. A program that reads a region entry other
// than a first one is built against the item's layout, as `check` reports it, so its offsets are the item's.

import { assemble, type Layout, type Program, entryAt } from './helpers.ts';

const i64 = (u: bigint): string => BigInt.asIntN(64, u).toString();

/** Criterion 1: a step that loops forever (in function 2) once it reads a `go` entry; else it writes k. Item: reads ["go"] (first), writes {k: i32}. */
export const spin = (): Program => assemble('spin', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (if (i32.ne (i32.load (i32.const 0)) (i32.const 0)) (then (call $spin)))
    (i32.store (i32.const 4096) (i32.wrap_i64 (local.get $k))))
  (func $spin (loop $forever (br $forever))))`);

/** Every step writes k. Item: writes {k: i32}, reads nothing. */
export const tally = (): Program => assemble('tally', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const 4096) (i32.wrap_i64 (local.get $k)))))`);

/** The depth counter's address in `recurse`. */
export const DEPTH_AT = 8192;
/** One frame of `recurse`'s function 2: no params or locals, a value stack 3 deep: 8 × 3 + 64 bytes (Logic: sandbox). */
export const DOWN_FRAME = 88;
/** Criterion 1: a recursion that never ends (function 2), counting its depth at DEPTH_AT. Item: writes {d: i32}. */
export const recurse = (): Program => assemble('recurse', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const ${DEPTH_AT}) (i32.const 0))
    (call $down))
  (func $down
    (i32.store (i32.const ${DEPTH_AT}) (i32.add (i32.load (i32.const ${DEPTH_AT})) (i32.const 1)))
    (call $down)))`);

/** The quiz's xorshift64 shuffle, as `quiz` computes it from the seed of the step that read `start`. */
export function shuffleOf(seed: bigint): number[] {
  const M = (1n << 64n) - 1n;
  let x = (seed ^ 0x9e3779b97f4a7c15n) & M;
  const order = [0, 1, 2, 3, 4];
  for (let i = 4; i > 0; i--) {
    x ^= (x << 13n) & M; x ^= x >> 7n; x ^= (x << 17n) & M;
    const j = Number(x % BigInt(i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}
/**
 * Criterion 2: a quiz of five questions. Until it has shuffled, a step that reads a `start` entry shuffles the
 * order [0, 1, 2, 3, 4] with that step's seed (shuffleOf); every step writes the order and the seed it read.
 * Item: reads ["start"], writes {order: i32 × 5, seed: i32 × 2 (the step's seed, low word first)}.
 */
export const quiz = (l: Layout): Program => {
  const start = entryAt(l, 'reads', 'start').offset;
  const seed = entryAt(l, 'reads', 'seed').offset;
  const order = 4096 + entryAt(l, 'writes', 'order').offset;
  const seedOut = 4096 + entryAt(l, 'writes', 'seed').offset;
  return assemble(`quiz_${start}_${seed}_${order}_${seedOut}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  ;; state: 8192 shuffled flag, 8196.. order[5]
  (func $init (export "init") (param $seed i64) (local $i i32)
    (i32.store (i32.const 8192) (i32.const 0))
    (loop $fill
      (i32.store (i32.add (i32.const 8196) (i32.shl (local.get $i) (i32.const 2))) (local.get $i))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $fill (i32.lt_u (local.get $i) (i32.const 5)))))
  (func $step (export "step") (param $k i64) (local $x i64) (local $i i32) (local $j i32) (local $t i32)
    (if (i32.and (i32.eqz (i32.load (i32.const 8192))) (i32.ne (i32.load (i32.const ${start})) (i32.const 0)))
      (then
        (local.set $x (i64.xor (i64.load (i32.const ${seed})) (i64.const ${i64(0x9e3779b97f4a7c15n)})))
        (local.set $i (i32.const 4))
        (loop $fy
          (local.set $x (i64.xor (local.get $x) (i64.shl (local.get $x) (i64.const 13))))
          (local.set $x (i64.xor (local.get $x) (i64.shr_u (local.get $x) (i64.const 7))))
          (local.set $x (i64.xor (local.get $x) (i64.shl (local.get $x) (i64.const 17))))
          (local.set $j (i32.wrap_i64 (i64.rem_u (local.get $x) (i64.extend_i32_u (i32.add (local.get $i) (i32.const 1))))))
          (local.set $t (i32.load (i32.add (i32.const 8196) (i32.shl (local.get $i) (i32.const 2)))))
          (i32.store (i32.add (i32.const 8196) (i32.shl (local.get $i) (i32.const 2)))
            (i32.load (i32.add (i32.const 8196) (i32.shl (local.get $j) (i32.const 2)))))
          (i32.store (i32.add (i32.const 8196) (i32.shl (local.get $j) (i32.const 2))) (local.get $t))
          (local.set $i (i32.sub (local.get $i) (i32.const 1)))
          (br_if $fy (i32.gt_u (local.get $i) (i32.const 0))))
        (i32.store (i32.const 8192) (i32.const 1))))
    (memory.copy (i32.const ${order}) (i32.const 8196) (i32.const 20))
    (i64.store (i32.const ${seedOut}) (i64.load (i32.const ${seed})))))`);
};

/** Criterion 4: at step 1, nine `memory.fill`s of 1 MiB each (1 MiB to 10 MiB of a 160-page memory); every step writes k. Item: writes {k: i32}, budget {fuel: 10,000,000, memory: 16}. */
export const nineFills = (): Program => assemble('nine_fills', `
(module
  (memory (export "memory") 160 160)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64) (local $i i32)
    (if (i64.eq (local.get $k) (i64.const 1))
      (then
        (loop $fills
          (memory.fill (i32.add (i32.const 1048576) (i32.mul (local.get $i) (i32.const 1048576))) (i32.const 0xab) (i32.const 1048576))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br_if $fills (i32.lt_u (local.get $i) (i32.const 9))))))
    (i32.store (i32.const 4096) (i32.wrap_i64 (local.get $k)))))`);

/**
 * Criterion 5: calls through a fixed function table with call_indirect (four functions, filled by an active
 * segment) and moves 512 bytes with memory.copy each step; a `nudge` entry's value changes which function a
 * step calls. Its state is memory and the mutable globals $acc and $mix.
 * Item: reads ["nudge"], writes {acc: i32, mix: f64}.
 */
export const tableCopy = (l: Layout): Program => {
  const nudge = entryAt(l, 'reads', 'nudge').offset;
  const acc = 4096 + entryAt(l, 'writes', 'acc').offset;
  const mix = 4096 + entryAt(l, 'writes', 'mix').offset;
  return assemble(`table_copy_${nudge}_${acc}_${mix}`, `
(module
  (type $op (func (param i32) (result i32)))
  (memory (export "memory") 2 2)
  (table 4 4 funcref)
  (elem (i32.const 0) $f0 $f1 $f2 $f3)
  (data (i32.const 8192) "logic@1 acceptance #531: bytes that memory.copy moves from place to place, step by step.")
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global $acc (mut i32) (i32.const 0))
  (global $mix (mut f64) (f64.const 0))
  (func $init (export "init") (param $seed i64)
    (global.set $acc (i32.wrap_i64 (local.get $seed))))
  (func $step (export "step") (param $k i64) (local $v i32) (local $kk i32)
    (local.set $kk (i32.wrap_i64 (local.get $k)))
    (if (i32.ne (i32.load (i32.const ${nudge})) (i32.const 0))
      (then (local.set $v (i32.trunc_f64_s (f64.load (i32.const ${nudge + 16}))))))
    (global.set $acc (call_indirect (type $op) (global.get $acc) (i32.and (i32.add (local.get $kk) (local.get $v)) (i32.const 3))))
    (memory.copy
      (i32.add (i32.const 65536) (i32.rem_u (i32.mul (local.get $kk) (i32.const 977)) (i32.const 60000)))
      (i32.add (i32.const 8192) (i32.rem_u (i32.mul (local.get $kk) (i32.const 131)) (i32.const 50000)))
      (i32.const 512))
    (i32.store (i32.add (i32.const 16384) (i32.and (global.get $acc) (i32.const 0x3ffc))) (global.get $acc))
    (global.set $mix (f64.add (f64.mul (global.get $mix) (f64.const 0.5)) (f64.convert_i32_s (global.get $acc))))
    (i32.store (i32.const ${acc}) (global.get $acc))
    (f64.store (i32.const ${mix}) (global.get $mix)))
  (func $f0 (type $op) (i32.add (i32.mul (local.get 0) (i32.const 3)) (i32.const 1)))
  (func $f1 (type $op) (i32.xor (local.get 0) (i32.const 0x5bd1e995)))
  (func $f2 (type $op) (i32.rotl (local.get 0) (i32.const 7)))
  (func $f3 (type $op) (i32.sub (local.get 0) (i32.const 12345))))`);
};

/** The value `lookup`'s start function puts at entry i (1,000 entries at LOOKUP_AT). */
export const lookupValue = (i: number): number => (i * i * 7 + 3) % 10007;
/** The lookup entry step k reads. */
export const lookupIndex = (k: number): number => (k * 37) % 1000;
/**
 * Criterion 6: a start function (function 2) that builds a 1,000-entry lookup in memory and counts its runs at
 * 8192; `init` counts its runs at 8196; every step reads entry lookupIndex(k) and writes it with a running sum and
 * both counts. Item: writes {v: i32, sum: i32, starts: i32, inits: i32}.
 */
export const lookup = (l: Layout): Program => {
  const w = (n: string): number => 4096 + entryAt(l, 'writes', n).offset;
  return assemble(`lookup_${['v', 'sum', 'starts', 'inits'].map(w).join('_')}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global $sum (mut i32) (i32.const 0))
  (start $build)
  (func $init (export "init") (param $seed i64)
    (i32.store (i32.const 8196) (i32.add (i32.load (i32.const 8196)) (i32.const 1))))
  (func $step (export "step") (param $k i64) (local $v i32)
    (local.set $v (i32.load (i32.add (i32.const 16384)
      (i32.shl (i32.rem_u (i32.mul (i32.wrap_i64 (local.get $k)) (i32.const 37)) (i32.const 1000)) (i32.const 2)))))
    (global.set $sum (i32.add (global.get $sum) (local.get $v)))
    (i32.store (i32.const ${w('v')}) (local.get $v))
    (i32.store (i32.const ${w('sum')}) (global.get $sum))
    (i32.store (i32.const ${w('starts')}) (i32.load (i32.const 8192)))
    (i32.store (i32.const ${w('inits')}) (i32.load (i32.const 8196))))
  (func $build (local $i i32)
    (i32.store (i32.const 8192) (i32.add (i32.load (i32.const 8192)) (i32.const 1)))
    (loop $fill
      (i32.store (i32.add (i32.const 16384) (i32.shl (local.get $i) (i32.const 2)))
        (i32.rem_u (i32.add (i32.mul (i32.mul (local.get $i) (local.get $i)) (i32.const 7)) (i32.const 3)) (i32.const 10007)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $fill (i32.lt_u (local.get $i) (i32.const 1000))))))`);
};

/** Criterion 6: a start function (function 2) that loops forever. Item: writes {k: i32}. */
export const startForever = (): Program => assemble('start_forever', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (start $forever)
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const 4096) (i32.wrap_i64 (local.get $k))))
  (func $forever (loop $l (br $l))))`);

/** Criterion 6: a one-page program whose write region starts 8 bytes before the end of memory. Item: writes {big: f64 × 4} (32 bytes). */
export const writePastMemory = (): Program => assemble('write_past_memory', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 65528))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);

/**
 * Criterion 7: an eight-page memory. Every step writes k into its write region (page 0, as is its read region),
 * then, by k mod 4, writes zeros where memory already holds zeros, so memory never changes:
 *   0: an i32.store at page 3;  1: a 64-byte memory.fill across pages 3 and 4;
 *   2: a 100-byte memory.copy from page 2 into pages 5 and 6;  3: an i32.store8 at page 7's last byte and a
 *   10-byte memory.copy from page 2 into page 1.
 * `quiet` is the same program without those writes. Item: writes {k: i32}.
 */
export const PAGES_BY_PHASE: readonly (readonly number[])[] = [[0, 3], [0, 3, 4], [0, 5, 6], [0, 1, 7]];
/** The pages the memory.copy of each phase writes (what a tracker that skips memory.copy misses). */
export const COPY_PAGES_BY_PHASE: readonly (readonly number[])[] = [[], [], [5, 6], [1]];
const pagesWat = (touch: boolean): string => `
(module
  (memory (export "memory") 8 8)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 1024))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64) (local $p i32)
    (i32.store (i32.const 1024) (i32.wrap_i64 (local.get $k)))
    (local.set $p (i32.wrap_i64 (i64.rem_u (local.get $k) (i64.const 4))))
    ${touch ? `(if (i32.eq (local.get $p) (i32.const 0)) (then (i32.store (i32.const ${3 * 65536 + 100}) (i32.const 0))))
    (if (i32.eq (local.get $p) (i32.const 1)) (then (memory.fill (i32.const ${4 * 65536 - 16}) (i32.const 0) (i32.const 64))))
    (if (i32.eq (local.get $p) (i32.const 2)) (then (memory.copy (i32.const ${6 * 65536 - 6}) (i32.const ${2 * 65536}) (i32.const 100))))
    (if (i32.eq (local.get $p) (i32.const 3)) (then
      (i32.store8 (i32.const ${8 * 65536 - 1}) (i32.const 0))
      (memory.copy (i32.const ${65536 + 10}) (i32.const ${2 * 65536 + 200}) (i32.const 10))))` : ''}))`;
export const touchPages = (): Program => assemble('touch_pages', pagesWat(true));
export const quietPages = (): Program => assemble('quiet_pages', pagesWat(false));

/** Criterion 8: a logic program that imports a function (function 0, env.forbidden_fn) and calls it from `step` (function 2). Item: writes {k: i32}. */
export const logicImport = (): Program => assemble('logic_import', `
(module
  (import "env" "forbidden_fn" (func $forbidden))
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (call $forbidden)
    (i32.store (i32.const 4096) (i32.wrap_i64 (local.get $k)))))`);

/** Criterion 9: a program for an item that reads arrays and controls and writes {hit: i32}, exporting `regions_digest` when given one. */
export const aim = (digest?: string): Program => assemble(`aim_${digest ?? 'none'}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 8192))
  ${digest ? `(global (export "regions_digest") i64 (i64.const ${i64(BigInt(`0x${digest}`))}))` : ''}
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const 8192) (i32.wrap_i64 (local.get $k)))))`);
/** Criterion 9: the item `src`, which writes {level: f64 × 4} (k at each), for another item to read as `src.level`. */
export const levels = (): Program => assemble('levels', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64) (local $x f64)
    (local.set $x (f64.convert_i64_s (local.get $k)))
    (f64.store (i32.const 4096) (local.get $x))
    (f64.store (i32.const 4104) (local.get $x))
    (f64.store (i32.const 4112) (local.get $x))
    (f64.store (i32.const 4120) (local.get $x))))`);

/** Criterion 12: each step runs a 50,000-iteration xorshift loop and writes its result. Item: writes {x: i32}. */
export const work = (): Program => assemble('work', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global $x (mut i32) (i32.const 1))
  (func $init (export "init") (param $seed i64)
    (global.set $x (i32.or (i32.wrap_i64 (local.get $seed)) (i32.const 1))))
  (func $step (export "step") (param $k i64) (local $i i32) (local $x i32)
    (local.set $x (global.get $x))
    (loop $spin
      (local.set $x (i32.xor (local.get $x) (i32.shl (local.get $x) (i32.const 13))))
      (local.set $x (i32.xor (local.get $x) (i32.shr_u (local.get $x) (i32.const 17))))
      (local.set $x (i32.xor (local.get $x) (i32.shl (local.get $x) (i32.const 5))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $spin (i32.lt_u (local.get $i) (i32.const 50000))))
    (global.set $x (local.get $x))
    (i32.store (i32.const 4096) (local.get $x))))`);

/** A program built for no particular layout, that `check` reads an item's layout with (it reads and writes nothing). */
export const probe = (): Program => assemble('layout_probe', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 32768))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);
