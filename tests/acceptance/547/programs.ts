// This suite's logic programs, as an agent would write them (README: Programs), in WebAssembly text. Every one
// exports `memory`, `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at` (0) and `writes_at`
// (Logic `logic@1`: Exports), and keeps to the logic subset. Each reads at most one control and writes one array,
// so its read entry and its write entry sit at offset 0 of their regions (#531's README: Layouts); each test checks
// that in a `check` reply before relying on it. A control's slot: a u32 count, 4 zero bytes, then each entry as a
// u32 player, 4 zero bytes and an f64 value, so the step's last entry's value is at 16 + 16 × (count − 1).

import { assemble, PAGE, type Program } from './helpers.ts';

/** The last entry's value of the control at offset 0, truncated to i32, into `$into` (when the step has one). */
const lastEntry = (into: string, scale = 1): string => `
    (local.set $n (i32.load (i32.const 0)))
    (if (i32.gt_u (local.get $n) (i32.const 0))
      (then (global.set ${into} (i32.trunc_f64_s (f64.mul (f64.const ${scale})
        (f64.load (i32.add (i32.const 16) (i32.shl (i32.sub (local.get $n) (i32.const 1)) (i32.const 4)))))))))`;

// ---------------------------------------------------------------------------------------------------
// Criterion 1

/** 32 MiB: 512 pages. */
export const PAGES3_PAGES = 512;
/** The page `pages3` writes with a store, and the one it writes with memory.fill; page 0 holds both regions. */
export const STORE_PAGE = 200;
export const FILL_PAGE = 400;
/**
 * Criterion 1: a 32 MiB memory whose every step writes the same 3 of its 64 KiB pages: page 0 (its read region,
 * which the logic module fills, and its write region, where it stores the high half of `$acc` as `sum`), page
 * STORE_PAGE (an i64 store of `$acc` at slot k mod 8,192) and page FILL_PAGE (a 256-byte memory.fill at slot
 * k mod 256 with a byte from k and `$knob`). `$acc` (an LCG over k and `$knob`, seeded by `init`) and `$knob`
 * (the knob slider's last entry) are its globals. A slot the fill wrote keeps its byte until the fill comes back
 * 256 steps later, so a restore that loses the fill page's bytes differs at the next checkpoint.
 * Item: reads ["knob"], writes {sum: i32}, budget {memory: 32}.
 */
export const pages3 = (): Program => assemble('pages3', `
(module
  (memory (export "memory") ${PAGES3_PAGES} ${PAGES3_PAGES})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global $knob (mut i32) (i32.const 0))
  (global $acc (mut i64) (i64.const 0))
  (func $init (export "init") (param $seed i64)
    (global.set $acc (i64.or (local.get $seed) (i64.const 1))))
  (func $step (export "step") (param $k i64) (local $n i32) (local $k32 i32)
    (local.set $k32 (i32.wrap_i64 (local.get $k)))${lastEntry('$knob')}
    (global.set $acc (i64.add (i64.mul (global.get $acc) (i64.const 6364136223846793005))
      (i64.add (local.get $k) (i64.extend_i32_s (global.get $knob)))))
    (i64.store (i32.add (i32.const ${STORE_PAGE * PAGE}) (i32.shl (i32.and (local.get $k32) (i32.const 8191)) (i32.const 3))) (global.get $acc))
    (memory.fill
      (i32.add (i32.const ${FILL_PAGE * PAGE}) (i32.shl (i32.and (local.get $k32) (i32.const 255)) (i32.const 8)))
      (i32.and (i32.add (i32.add (i32.mul (local.get $k32) (i32.const 7)) (i32.shr_u (local.get $k32) (i32.const 8)))
        (i32.add (global.get $knob) (i32.const 1))) (i32.const 255))
      (i32.const 256))
    (i32.store (i32.const 4096) (i32.wrap_i64 (i64.shr_u (global.get $acc) (i64.const 32))))))`);

// ---------------------------------------------------------------------------------------------------
// Criterion 2

export const CELLS = 9216;
export const GRID_AT = 65_536;
/** The two elements step k changes: (7,919 × k) mod 9,216, and that plus 4,608 mod 9,216. */
export const cellsOf = (k: number): [number, number] => {
  const a = Number((BigInt(k) * 7919n) % 9216n);
  return [a, (a + 4608) % 9216];
};
/** The value step k writes at its first element (its negation at the second): 4 × (k + 1) + (brush & 3). */
export const valueOf = (k: number, brush: number): number => 4 * (k + 1) + (brush & 3);
/**
 * Criterion 2: a 96 × 96 grid of i32 cells (9,216, `cells`, at GRID_AT in its write region). Each step takes the
 * brush slider's last entry into `$brush` and changes exactly two cells, cellsOf(k), to valueOf(k, brush) and its
 * negation: the values are unique per step, so both are always real changes, and the two cells are 4,608 apart, so
 * they are two changed ranges. At step 5,000 they are 3,064 and 7,672.
 * Item: reads ["brush"], writes {cells: i32 × 9,216}.
 */
export const grid = (): Program => assemble('grid', `
(module
  (memory (export "memory") 2 2)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${GRID_AT}))
  (global $brush (mut i32) (i32.const 0))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64) (local $n i32) (local $a i32) (local $b i32) (local $v i32)${lastEntry('$brush')}
    (local.set $a (i32.wrap_i64 (i64.rem_u (i64.mul (local.get $k) (i64.const 7919)) (i64.const ${CELLS}))))
    (local.set $b (i32.rem_u (i32.add (local.get $a) (i32.const 4608)) (i32.const ${CELLS})))
    (local.set $v (i32.add (i32.shl (i32.add (i32.wrap_i64 (local.get $k)) (i32.const 1)) (i32.const 2)) (i32.and (global.get $brush) (i32.const 3))))
    (i32.store (i32.add (i32.const ${GRID_AT}) (i32.shl (local.get $a) (i32.const 2))) (local.get $v))
    (i32.store (i32.add (i32.const ${GRID_AT}) (i32.shl (local.get $b) (i32.const 2))) (i32.sub (i32.const 0) (local.get $v)))))`);

// ---------------------------------------------------------------------------------------------------
// Criterion 3

/**
 * Criterion 3: 64 pages (4 MiB, the default), and every step writes one byte in each: at 8,192 + (31k + 17p) mod
 * 49,152 of page p, the byte there plus k + p + `$nudge` + 1, folded into `$acc`, which it writes as `sum`. So
 * every checkpoint, whole or not, holds all 64 pages, and a step's bytes depend on the memory it read.
 * `$nudge` is 100 × the nudge slider's last entry.
 * Item: reads ["nudge"], writes {sum: i32}.
 */
export const bytes64 = (): Program => assemble('bytes64', `
(module
  (memory (export "memory") 64 64)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global $nudge (mut i32) (i32.const 0))
  (global $acc (mut i32) (i32.const 0))
  (func $init (export "init") (param $seed i64)
    (global.set $acc (i32.wrap_i64 (local.get $seed))))
  (func $step (export "step") (param $k i64) (local $n i32) (local $k32 i32) (local $p i32) (local $at i32) (local $b i32)
    (local.set $k32 (i32.wrap_i64 (local.get $k)))${lastEntry('$nudge', 100)}
    (loop $page
      (local.set $at (i32.add (i32.shl (local.get $p) (i32.const 16))
        (i32.add (i32.const 8192) (i32.rem_u (i32.add (i32.mul (local.get $k32) (i32.const 31)) (i32.mul (local.get $p) (i32.const 17))) (i32.const 49152)))))
      (local.set $b (i32.add (i32.load8_u (local.get $at))
        (i32.add (i32.add (local.get $k32) (local.get $p)) (i32.add (global.get $nudge) (i32.const 1)))))
      (i32.store8 (local.get $at) (local.get $b))
      (global.set $acc (i32.add (i32.mul (global.get $acc) (i32.const 31)) (i32.and (local.get $b) (i32.const 255))))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br_if $page (i32.lt_u (local.get $p) (i32.const 64))))
    (i32.store (i32.const 4096) (global.get $acc))))`);

// ---------------------------------------------------------------------------------------------------
// Criterion 4

export const UNITS = 300;
/** 7 MiB: 112 pages. */
export const MATCH_PAGES = 112;
const UNITS_AT = PAGE;
const MAP_AT = 2 * PAGE;
const NOISE_FROM = 10;
/** Square roots each pair of units chains through, serially, beyond its distance's (the step's cost: README). */
export const ROUNDS = 4;
/** One noise page range filled by an LCG, 8 bytes at a time, four to a loop turn. */
const noise = (name: string, from: number, to: number, mult: string): string => `
  (func ${name} (local $at i32) (local $r i64)
    (local.set $at (i32.const ${from * PAGE}))
    (local.set $r (i64.const ${mult}))
    (loop $fill
      (i64.store (local.get $at) (local.get $r))
      (local.set $r (i64.add (i64.mul (local.get $r) (i64.const 6364136223846793005)) (i64.const 1442695040888963407)))
      (i64.store offset=8 (local.get $at) (local.get $r))
      (local.set $r (i64.add (i64.mul (local.get $r) (i64.const 6364136223846793005)) (i64.const 1442695040888963407)))
      (i64.store offset=16 (local.get $at) (local.get $r))
      (local.set $r (i64.add (i64.mul (local.get $r) (i64.const 6364136223846793005)) (i64.const 1442695040888963407)))
      (i64.store offset=24 (local.get $at) (local.get $r))
      (local.set $r (i64.add (i64.mul (local.get $r) (i64.const 6364136223846793005)) (i64.const 1442695040888963407)))
      (local.set $at (i32.add (local.get $at) (i32.const 32)))
      (br_if $fill (i32.lt_u (local.get $at) (i32.const ${to * PAGE})))))`;
/**
 * Criterion 4: a 300-unit match for two players at 30 Hz. Memory: page 0 the regions, page 1 the units (x, y as
 * f64), pages 2 to 9 a 1,024 × 512 byte map each unit stamps its cell on every step, and pages 10 to 111 seeded
 * noise (the start function fills 10 to 60, `init` 61 to 111, each well within a step's fuel), so a whole
 * checkpoint holds 7 MiB that no compression shrinks. Each step reads every entry of the order control: an entry
 * of player 1 or 2 sets that player's target cell. Every unit then sums, over all 300 units, a chain of square
 * roots of their distances (ROUNDS more per pair, serially, which sets the step's cost), moves toward its player's
 * target, nudged by the chain's fraction, wraps onto the map and stamps it; `score` counts each player's units in
 * the other's half. Units 0 to 149 are player 1's.
 * Item: step_rate 30, reads ["order"], writes {score: i32 × 2}, budget {fuel: 10,000,000, memory: 7}.
 */
export const match = (rounds = ROUNDS): Program => assemble(`match_${rounds}`, `
(module
  (memory (export "memory") ${MATCH_PAGES} ${MATCH_PAGES})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global $t1 (mut i32) (i32.const 131328))
  (global $t2 (mut i32) (i32.const 393984))
  ${noise('$noise_a', NOISE_FROM, 61, '0x2545F4914F6CDD1D')}
  ${noise('$noise_b', 61, MATCH_PAGES, '0x9E3779B97F4A7C15')}
  (start $noise_a)
  (func $init (export "init") (param $seed i64) (local $i i32) (local $p i32)
    (call $noise_b)
    (loop $place
      (local.set $p (i32.add (i32.const ${UNITS_AT}) (i32.shl (local.get $i) (i32.const 4))))
      (f64.store (local.get $p) (f64.add (f64.convert_i32_u (i32.rem_u (i32.mul (local.get $i) (i32.const 37)) (i32.const 1024))) (f64.const 0.5)))
      (f64.store offset=8 (local.get $p) (f64.add (f64.convert_i32_u (i32.rem_u (i32.mul (local.get $i) (i32.const 53)) (i32.const 512))) (f64.const 0.5)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $place (i32.lt_u (local.get $i) (i32.const ${UNITS})))))
  (func $step (export "step") (param $k i64)
    (local $n i32) (local $e i32) (local $i i32) (local $j i32) (local $p i32) (local $q i32) (local $t i32) (local $r i32)
    (local $xi f64) (local $yi f64) (local $dx f64) (local $dy f64) (local $s f64) (local $f f64) (local $c i32) (local $s1 i32) (local $s2 i32)
    ;; orders: every entry of the step, in order
    (local.set $n (i32.load (i32.const 0)))
    (block $done
      (loop $orders
        (br_if $done (i32.ge_u (local.get $e) (local.get $n)))
        (local.set $t (i32.trunc_f64_u (f64.load (i32.add (i32.const 16) (i32.shl (local.get $e) (i32.const 4))))))
        (if (i32.eq (i32.load (i32.add (i32.const 8) (i32.shl (local.get $e) (i32.const 4)))) (i32.const 1))
          (then (global.set $t1 (local.get $t)))
          (else (global.set $t2 (local.get $t))))
        (local.set $e (i32.add (local.get $e) (i32.const 1)))
        (br $orders)))
    (loop $unit
      (local.set $p (i32.add (i32.const ${UNITS_AT}) (i32.shl (local.get $i) (i32.const 4))))
      (local.set $xi (f64.load (local.get $p)))
      (local.set $yi (f64.load offset=8 (local.get $p)))
      (local.set $s (f64.const 0))
      (local.set $j (i32.const 0))
      (loop $pair
        (local.set $q (i32.add (i32.const ${UNITS_AT}) (i32.shl (local.get $j) (i32.const 4))))
        (local.set $dx (f64.sub (local.get $xi) (f64.load (local.get $q))))
        (local.set $dy (f64.sub (local.get $yi) (f64.load offset=8 (local.get $q))))
        (local.set $s (f64.sqrt (f64.add (local.get $s) (f64.add (f64.mul (local.get $dx) (local.get $dx)) (f64.mul (local.get $dy) (local.get $dy))))))
        (local.set $r (i32.const 0))
        (loop $chain
          (local.set $s (f64.sqrt (f64.add (local.get $s) (f64.const 1.5))))
          (local.set $r (i32.add (local.get $r) (i32.const 1)))
          (br_if $chain (i32.lt_u (local.get $r) (i32.const ${rounds}))))
        (local.set $j (i32.add (local.get $j) (i32.const 1)))
        (br_if $pair (i32.lt_u (local.get $j) (i32.const ${UNITS}))))
      (local.set $t (select (global.get $t1) (global.get $t2) (i32.lt_u (local.get $i) (i32.const ${UNITS / 2}))))
      (local.set $f (f64.sub (f64.sub (local.get $s) (f64.floor (local.get $s))) (f64.const 0.5)))
      (local.set $xi (f64.add (local.get $xi) (f64.add (f64.min (f64.const 1) (f64.max (f64.const -1)
        (f64.mul (f64.sub (f64.add (f64.convert_i32_u (i32.and (local.get $t) (i32.const 1023))) (f64.const 0.5)) (local.get $xi)) (f64.const 0.01))))
        (f64.mul (local.get $f) (f64.const 0.2)))))
      (local.set $yi (f64.add (local.get $yi) (f64.sub (f64.min (f64.const 1) (f64.max (f64.const -1)
        (f64.mul (f64.sub (f64.add (f64.convert_i32_u (i32.shr_u (local.get $t) (i32.const 10))) (f64.const 0.5)) (local.get $yi)) (f64.const 0.01))))
        (f64.mul (local.get $f) (f64.const 0.2)))))
      (if (f64.lt (local.get $xi) (f64.const 0)) (then (local.set $xi (f64.add (local.get $xi) (f64.const 1024)))))
      (if (f64.ge (local.get $xi) (f64.const 1024)) (then (local.set $xi (f64.sub (local.get $xi) (f64.const 1024)))))
      (if (f64.lt (local.get $yi) (f64.const 0)) (then (local.set $yi (f64.add (local.get $yi) (f64.const 512)))))
      (if (f64.ge (local.get $yi) (f64.const 512)) (then (local.set $yi (f64.sub (local.get $yi) (f64.const 512)))))
      (f64.store (local.get $p) (local.get $xi))
      (f64.store offset=8 (local.get $p) (local.get $yi))
      (local.set $c (i32.add (i32.const ${MAP_AT})
        (i32.add (i32.shl (i32.trunc_f64_u (local.get $yi)) (i32.const 10)) (i32.trunc_f64_u (local.get $xi)))))
      (i32.store8 (local.get $c) (i32.add (i32.load8_u (local.get $c)) (i32.const 1)))
      (if (i32.lt_u (local.get $i) (i32.const ${UNITS / 2}))
        (then (if (f64.ge (local.get $xi) (f64.const 512)) (then (local.set $s1 (i32.add (local.get $s1) (i32.const 1))))))
        (else (if (f64.lt (local.get $xi) (f64.const 512)) (then (local.set $s2 (i32.add (local.get $s2) (i32.const 1)))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $unit (i32.lt_u (local.get $i) (i32.const ${UNITS}))))
    (i32.store (i32.const 4096) (local.get $s1))
    (i32.store (i32.const 4100) (local.get $s2))))`);

// ---------------------------------------------------------------------------------------------------
// Criterion 5

/** The page step k writes in `intervals`: one page per 60-step interval, from page 4. */
export const intervalPage = (k: number): number => 4 + Math.floor(k / 60);
/**
 * Criterion 5: 16 pages; step k stores k + 1 at slot k mod 60 of page 4 + ⌊k ÷ 60⌋, so each 60-step interval
 * writes its own page besides page 0 (the read region, where the logic module writes the step's seed, and the
 * write region, where it stores k as `tick`).
 * Item: reads [], writes {tick: i32}.
 */
export const intervals = (): Program => assemble('intervals', `
(module
  (memory (export "memory") 16 16)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64) (local $k32 i32)
    (local.set $k32 (i32.wrap_i64 (local.get $k)))
    (i32.store
      (i32.add (i32.shl (i32.add (i32.const 4) (i32.div_u (local.get $k32) (i32.const 60))) (i32.const 16))
        (i32.shl (i32.rem_u (local.get $k32) (i32.const 60)) (i32.const 2)))
      (i32.add (local.get $k32) (i32.const 1)))
    (i32.store (i32.const 4096) (local.get $k32))))`);
