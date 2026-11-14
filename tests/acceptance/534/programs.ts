// This suite's logic programs, as an agent would write them (README: Programs), in WebAssembly text. Every logic
// program exports `memory`, `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at` and `writes_at`
// (Logic `logic@1`: Exports), and keeps to the logic subset. A program that reads or writes a region entry is built
// against the item's layout as `check` reports it (read first with `layoutProbe`), so its offsets are the item's.

import { assemble, entryAt, type Layout, type Program } from './helpers.ts';

/** A program built for no layout: `check` of an item naming it reports the item's layout. */
export const layoutProbe = (): Program => assemble('layout_probe', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 32768))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);

/** A control's entries in the read region: a u32 count, 4 zero bytes, then 16 bytes an entry, its f64 value at +8. */
const valueAt = (slot: number, j: string): string => `(f64.load (i32.add (i32.const ${slot + 16}) (i32.shl ${j} (i32.const 4))))`;

/** The steps whose end `dungeon` saves slot 1 at: so its saves are at steps 1,200 and 1,800. */
export const DUNGEON_SAVES_AT = [1199, 1799];
export const DUNGEON_WRITES = {
  floor: { type: 'i32' as const }, health: { type: 'i32' as const }, inv: { type: 'i32' as const, count: 8 }, request: { type: 'i32' as const },
};
/** The dungeon's mutable globals, in declaration order: what a migration's state block holds after the memory. */
export const DUNGEON_GLOBALS = ['floor', 'health', 'rng'];
export const DUNGEON_START_HEALTH = 100;
/**
 * Criteria 1, 2, 3 and 8: a dungeon whose logic keeps its floor, its health and its seeded generator (xorshift64,
 * seeded by `init`) in mutable globals and its inventory (8 slots) in memory at 8192. Each entry of the `move`
 * control a step reads adds (its index in the step + 1) to the inventory slot its value names, so which entries
 * reach which step matters; each step moves health by the generator's next value (−3 to +4, additive, never
 * clamped) and goes down a floor when its bits 20 to 27 are zero. It writes 1 into `request` at the ends of steps
 * 1,199 and 1,799 (saves of slot 1 at steps 1,200 and 1,800) and 0 otherwise. `variant: 'nop'` is the same program
 * with one `nop` more in `step`: a changed program (another hash) whose state means the same.
 * Item: reads ["move"], writes DUNGEON_WRITES, saves {request: "request"}.
 */
export const dungeon = (l: Layout, variant: 'same' | 'nop' = 'same'): Program => {
  const move = entryAt(l, 'reads', 'move');
  const w = (n: string): number => 4096 + entryAt(l, 'writes', n);
  return assemble(`dungeon_${variant}_${move}_${w('floor')}_${w('inv')}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global $floor (mut i32) (i32.const 0))
  (global $health (mut i32) (i32.const 0))
  (global $rng (mut i64) (i64.const 0))
  (func $init (export "init") (param $seed i64)
    (global.set $rng (i64.or (local.get $seed) (i64.const 1)))
    (global.set $floor (i32.const 1))
    (global.set $health (i32.const ${DUNGEON_START_HEALTH})))
  (func $next (result i64)
    (global.set $rng (i64.xor (global.get $rng) (i64.shl (global.get $rng) (i64.const 13))))
    (global.set $rng (i64.xor (global.get $rng) (i64.shr_u (global.get $rng) (i64.const 7))))
    (global.set $rng (i64.xor (global.get $rng) (i64.shl (global.get $rng) (i64.const 17))))
    (global.get $rng))
  (func $step (export "step") (param $k i64) (local $n i32) (local $j i32) (local $p i32) (local $r i64)
    ${variant === 'nop' ? '(nop)' : ''}
    (local.set $n (i32.load (i32.const ${move})))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $j) (local.get $n)))
      (local.set $p (i32.add (i32.const 8192) (i32.shl (i32.and (i32.trunc_f64_s ${valueAt(move, '(local.get $j)')}) (i32.const 7)) (i32.const 2))))
      (i32.store (local.get $p) (i32.add (i32.load (local.get $p)) (i32.add (local.get $j) (i32.const 1))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $each)))
    (local.set $r (call $next))
    (global.set $health (i32.add (global.get $health) (i32.sub (i32.wrap_i64 (i64.and (local.get $r) (i64.const 7))) (i32.const 3))))
    (if (i64.eqz (i64.and (i64.shr_u (local.get $r) (i64.const 20)) (i64.const 255)))
      (then (global.set $floor (i32.add (global.get $floor) (i32.const 1)))))
    (i32.store (i32.const ${w('request')})
      (i32.or (i64.eq (local.get $k) (i64.const ${DUNGEON_SAVES_AT[0]})) (i64.eq (local.get $k) (i64.const ${DUNGEON_SAVES_AT[1]}))))
    (i32.store (i32.const ${w('floor')}) (global.get $floor))
    (i32.store (i32.const ${w('health')}) (global.get $health))
    (memory.copy (i32.const ${w('inv')}) (i32.const 8192) (i32.const 32))))`);
};

/** What the migration adds to the dungeon's health. */
export const MIGRATION_HEALTH = 1000;
/** The dungeon's state block (README: Migrations): a u32 memory length, the memory, a u32 global count, 8 bytes a global. */
const DUNGEON_STATE_BYTES = 4 + 65_536 + 4 + 8 * DUNGEON_GLOBALS.length;
const OLD_AT = 65_536;
const NEW_AT = 196_608;
/**
 * Criteria 3 and 8: a migration (Logic: saves across changes) from the dungeon's old program to its changed one. The
 * logic module copies the old state block to `old_at`; `migrate()` copies it to `new_at` and adds MIGRATION_HEALTH to
 * the health global (the second mutable global), so the new state is the old one with 1,000 more health.
 */
export const migration = (): Program => assemble('migration', `
(module
  (memory (export "memory") 5 5)
  (global (export "remap_at") i32 (i32.const 0))
  (global (export "old_at") i32 (i32.const ${OLD_AT}))
  (global (export "new_at") i32 (i32.const ${NEW_AT}))
  (func (export "migrate")
    (memory.copy (i32.const ${NEW_AT}) (i32.const ${OLD_AT}) (i32.const ${DUNGEON_STATE_BYTES}))
    (i32.store (i32.const ${NEW_AT + 4 + 65_536 + 4 + 8})
      (i32.add (i32.load (i32.const ${NEW_AT + 4 + 65_536 + 4 + 8})) (i32.const ${MIGRATION_HEALTH})))))`);

/** Where `dungeon_static` keeps its floor: the first word of its active data segment (segment 0). */
export const STATIC_FLOOR_AT = 1024;
export const STATIC_WRITES = { floor: { type: 'i32' as const }, health: { type: 'i32' as const }, request: { type: 'i32' as const } };
/** The step whose end `dungeon_static` saves slot 1 at: a save at step 1,800. */
export const STATIC_SAVE_AT = 1799;
/**
 * Criterion 5: a dungeon that keeps its floor in an initialized static: the i32 at 1024, the first word of its one
 * active data segment (floor 1, then a damage table 10, 20, 30, 40). It goes down a floor at the end of every 300th
 * step (so floor 7 at step 1,800), moves health by the table's entry its generator picks minus 25, keeps its
 * generator in a mutable global, and writes 1 into `request` at the end of step 1,799. `variant: 'nop'` adds one
 * `nop`: a changed program with the same segment. Item: reads ["move"], writes STATIC_WRITES.
 */
export const dungeonStatic = (l: Layout, variant: 'same' | 'nop' = 'same'): Program => {
  const w = (n: string): number => 4096 + entryAt(l, 'writes', n);
  return assemble(`dungeon_static_${variant}_${w('floor')}_${w('request')}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global $health (mut i32) (i32.const 0))
  (global $rng (mut i64) (i64.const 0))
  (data (i32.const ${STATIC_FLOOR_AT}) "\\01\\00\\00\\00\\0a\\00\\00\\00\\14\\00\\00\\00\\1e\\00\\00\\00\\28\\00\\00\\00")
  (func $init (export "init") (param $seed i64)
    (global.set $rng (i64.or (local.get $seed) (i64.const 1)))
    (global.set $health (i32.const 100)))
  (func $step (export "step") (param $k i64)
    ${variant === 'nop' ? '(nop)' : ''}
    (global.set $rng (i64.xor (global.get $rng) (i64.shl (global.get $rng) (i64.const 13))))
    (global.set $rng (i64.xor (global.get $rng) (i64.shr_u (global.get $rng) (i64.const 7))))
    (global.set $rng (i64.xor (global.get $rng) (i64.shl (global.get $rng) (i64.const 17))))
    (global.set $health (i32.add (global.get $health)
      (i32.sub (i32.load (i32.add (i32.const ${STATIC_FLOOR_AT + 4}) (i32.shl (i32.wrap_i64 (i64.and (global.get $rng) (i64.const 3))) (i32.const 2)))) (i32.const 25))))
    (if (i64.eq (i64.rem_u (local.get $k) (i64.const 300)) (i64.const 299))
      (then (i32.store (i32.const ${STATIC_FLOOR_AT}) (i32.add (i32.load (i32.const ${STATIC_FLOOR_AT})) (i32.const 1)))))
    (i32.store (i32.const ${w('request')}) (i64.eq (local.get $k) (i64.const ${STATIC_SAVE_AT})))
    (i32.store (i32.const ${w('floor')}) (i32.load (i32.const ${STATIC_FLOOR_AT})))
    (i32.store (i32.const ${w('health')}) (global.get $health))))`);
};

/**
 * Criteria 2 and 4: a program that holds a nonzero byte in every 64 KiB page of a `pages`-page memory (so a save
 * keeps all of it) and writes 1 into `request` at the ends of the steps in `saveAt`. Item: writes {request: i32},
 * budget {memory: pages ÷ 16 MiB}.
 */
export const hoard = (pages: number, saveAt: number[]): Program => assemble(`hoard_${pages}_${saveAt.join('_')}`, `
(module
  (memory (export "memory") ${pages} ${pages})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64) (local $i i32)
    (loop $page
      (i32.store8 (i32.add (i32.shl (local.get $i) (i32.const 16)) (i32.const 8192)) (i32.add (local.get $i) (i32.const 1)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $page (i32.lt_u (local.get $i) (i32.const ${pages})))))
  (func $step (export "step") (param $k i64)
    (i32.store (i32.const 4096) ${saveAt.map((k) => `(i64.eq (local.get $k) (i64.const ${k}))`).reduce((a, b) => `(i32.or ${a} ${b})`, '(i32.const 0)')})))`);

/** Criterion 7: a program that writes 1 into `request` at the end of step 29 (a save at step 30). Item: writes {request: i32}. */
export const saver = (): Program => assemble('saver', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global $n (mut i64) (i64.const 0))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (global.set $n (i64.add (global.get $n) (i64.const 1)))
    (i32.store (i32.const 4096) (i64.eq (local.get $k) (i64.const 29)))))`);

// ---------------------------------------------------------------------------------------------------
// Criterion 6: the fixture piece.

export const FIXTURE_HZ = 20;
export const CELLS = 256;
export const FIXTURE_WRITES = {
  pos: { type: 'f64' as const, interpolate: 'linear' as const },
  found: { type: 'i32' as const }, seen: { type: 'i32' as const }, paged: { type: 'i32' as const },
  mirrored: { type: 'i32' as const }, request: { type: 'i32' as const },
};
export const CROWD_WRITES = { cells: { type: 'i32' as const, count: CELLS } };
/** The fixture's logic@1 fields the base doesn't build: world pages, a between-step service and a mirror. */
export const FIXTURE_MORE = {
  pages: { max: 64, slots: 4, moves: 2, lead: 4, init: 'zero', written_max: 16, web_max: 16 },
  services: { 'physics.cast@1': { max_per_step: 1 } },
  mirrors: [{ array: 'crowd.cells', at: 'cells_at' }],
};
/** A step at which a page move is still queued once it ends: one at which the fixture asks for a page (k mod 7 = 3). */
export const queuesMove = (k: number): boolean => k % 7 === 3;
/** A step inside a search split across steps (one starts at k mod 50 = 10 and runs about ten steps). */
export const midSearch = (k: number): boolean => k % 50 >= 11 && k % 50 <= 18;
const SV = 24_576;
const PG = 65_536;
/**
 * Criterion 6: a fixture item at 20 Hz with
 *  - a linear write `pos` (f64, interpolate linear): 1 + k ÷ 4 at step k;
 *  - world pages (pages_at 65,536; 4 slots, 2 moves, lead 4): at each step k with k mod 7 = 3 it asks for page
 *    (k ÷ 7) mod 64 into slot (k ÷ 7) mod 4, so a move is queued for the four steps after; every step writes one
 *    byte into slot k mod 4; `paged` shows the page the slot table names for slot 0;
 *  - a mirror of `crowd.cells` at `cells_at` (16,384), whose pending ranges are the crowd's changes of the same step;
 *    `mirrored` is the sum of its first 8 cells;
 *  - a between-step service, physics.cast@1 (services_at 24,576, at most 1 a step): a ray down from (0, 5, 0) into
 *    the world `ground` at each step k with k mod 5 = 0, whose answer lands after the step and is read at the next,
 *    adding its result count to `seen`;
 *  - a search split across steps: from each step with k mod 50 = 10, 2,000 iterations a step until 20,000, its
 *    progress and accumulator in memory at 8192, then `found`;
 *  - `request`: 1 when the step read an entry of the `save` control.
 * Item: step_rate 20, reads ["save"], writes FIXTURE_WRITES, saves {request: "request"}, FIXTURE_MORE.
 */
export const fixture = (l: Layout): Program => {
  const save = entryAt(l, 'reads', 'save');
  const w = (n: string): number => 4096 + entryAt(l, 'writes', n);
  return assemble(`fixture_${save}_${w('pos')}_${w('request')}`, `
(module
  (memory (export "memory") 6 6)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global (export "cells_at") i32 (i32.const 16384))
  (global (export "services_at") i32 (i32.const ${SV}))
  (global (export "pages_at") i32 (i32.const ${PG}))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64) (local $i i32) (local $sum i32) (local $s i32)
    ;; the service's answer to the last step's ray: its result count, after the request count and one 72-byte request
    (i32.store (i32.const 8200) (i32.add (i32.load (i32.const 8200)) (i32.load (i32.const ${SV + 4 + 72}))))
    (if (i64.eqz (i64.rem_u (local.get $k) (i64.const 5)))
      (then
        (i32.store (i32.const ${SV}) (i32.const 1))
        (i32.store (i32.const ${SV + 4}) (i32.const 0))
        (i32.store (i32.const ${SV + 8}) (i32.const 0))
        (f64.store (i32.const ${SV + 12}) (f64.const 0)) (f64.store (i32.const ${SV + 20}) (f64.const 5)) (f64.store (i32.const ${SV + 28}) (f64.const 0))
        (f64.store (i32.const ${SV + 36}) (f64.const 0)) (f64.store (i32.const ${SV + 44}) (f64.const -1)) (f64.store (i32.const ${SV + 52}) (f64.const 0))
        (f64.store (i32.const ${SV + 60}) (f64.const 10))
        (i32.store (i32.const ${SV + 68}) (i32.const -1)))
      (else (i32.store (i32.const ${SV}) (i32.const 0))))
    ;; the search, split across steps
    (if (i64.eq (i64.rem_u (local.get $k) (i64.const 50)) (i64.const 10))
      (then (i32.store (i32.const 8192) (i32.const 1)) (i32.store (i32.const 8196) (i32.const 0))))
    (if (i32.ne (i32.load (i32.const 8192)) (i32.const 0))
      (then
        (local.set $i (i32.const 0))
        (loop $iter
          (i32.store (i32.const 8196) (i32.add (i32.mul (i32.load (i32.const 8196)) (i32.const 31)) (i32.load (i32.const 8192))))
          (i32.store (i32.const 8192) (i32.add (i32.load (i32.const 8192)) (i32.const 1)))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br_if $iter (i32.lt_u (local.get $i) (i32.const 2000))))
        (if (i32.gt_u (i32.load (i32.const 8192)) (i32.const 20000))
          (then (i32.store (i32.const ${w('found')}) (i32.load (i32.const 8196))) (i32.store (i32.const 8192) (i32.const 0))))))
    ;; world pages: one request at k mod 7 = 3, none otherwise (page 0xFFFFFFFF asks for nothing)
    (if (i64.eq (i64.rem_u (local.get $k) (i64.const 7)) (i64.const 3))
      (then
        (i32.store (i32.const ${PG}) (i32.wrap_i64 (i64.rem_u (i64.div_u (local.get $k) (i64.const 7)) (i64.const 64))))
        (i32.store (i32.const ${PG + 4}) (i32.wrap_i64 (i64.rem_u (i64.div_u (local.get $k) (i64.const 7)) (i64.const 4)))))
      (else (i32.store (i32.const ${PG}) (i32.const -1))))
    (i32.store (i32.const ${PG + 8}) (i32.const -1))
    (local.set $s (i32.wrap_i64 (i64.rem_u (local.get $k) (i64.const 4))))
    (i32.store8 (i32.add (i32.const ${PG + 48}) (i32.add (i32.shl (local.get $s) (i32.const 16))
      (i32.wrap_i64 (i64.rem_u (i64.mul (local.get $k) (i64.const 13)) (i64.const 65000))))) (i32.wrap_i64 (local.get $k)))
    (i32.store (i32.const ${w('paged')}) (i32.load (i32.const ${PG + 16})))
    ;; the mirror
    (local.set $i (i32.const 0)) (local.set $sum (i32.const 0))
    (loop $cell
      (local.set $sum (i32.add (local.get $sum) (i32.load (i32.add (i32.const 16384) (i32.shl (local.get $i) (i32.const 2))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $cell (i32.lt_u (local.get $i) (i32.const 8))))
    (i32.store (i32.const ${w('mirrored')}) (local.get $sum))
    (i32.store (i32.const ${w('seen')}) (i32.load (i32.const 8200)))
    (f64.store (i32.const ${w('pos')}) (f64.add (f64.const 1) (f64.div (f64.convert_i64_u (local.get $k)) (f64.const 4))))
    (i32.store (i32.const ${w('request')}) (i32.ne (i32.load (i32.const ${save})) (i32.const 0)))))`);
};
/** Criterion 6: the crowd item the fixture mirrors, at 20 Hz: each step adds 1 to cell (37k mod 256) and 3 to cell (101k mod 256). */
export const crowd = (l: Layout): Program => {
  const cells = 4096 + entryAt(l, 'writes', 'cells');
  return assemble(`crowd_${cells}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $add (param $at i32) (param $n i32)
    (i32.store (local.get $at) (i32.add (i32.load (local.get $at)) (local.get $n))))
  (func $step (export "step") (param $k i64)
    (call $add (i32.add (i32.const 8192) (i32.shl (i32.wrap_i64 (i64.rem_u (i64.mul (local.get $k) (i64.const 37)) (i64.const ${CELLS}))) (i32.const 2))) (i32.const 1))
    (call $add (i32.add (i32.const 8192) (i32.shl (i32.wrap_i64 (i64.rem_u (i64.mul (local.get $k) (i64.const 101)) (i64.const ${CELLS}))) (i32.const 2))) (i32.const 3))
    (memory.copy (i32.const ${cells}) (i32.const 8192) (i32.const ${4 * CELLS}))))`);
};

// ---------------------------------------------------------------------------------------------------
// Criterion 4: the budgets' programs.

export const BOIDS = 100;
export const FLOCK_WRITES = { pos: { type: 'vec2' as const, count: BOIDS } };
/** #532's 100-boid flock (copied from tests/acceptance/532/programs.ts, unchanged): reads ["wind"], writes FLOCK_WRITES. */
export const flock = (l: Layout): Program => {
  const wind = entryAt(l, 'reads', 'wind');
  const pos = 4096 + entryAt(l, 'writes', 'pos');
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

/**
 * Criterion 4: a 1 MB program: `functions` functions none of which runs, each a straight run of `adds` local adds of
 * an i32 constant (about 9 bytes each), beside an empty step. 120 × 1,000 adds is a little over 1 MB.
 */
export const big = (functions = 120, adds = 1000): Program => {
  const body = Array.from({ length: adds }, (_, i) => `(local.set $x (i32.add (local.get $x) (i32.const ${100_000 + i})))`).join('\n    ');
  const funcs = Array.from({ length: functions }, (_, f) => `(func $f${f} (param $x i32) (result i32)\n    ${body}\n    (local.get $x))`).join('\n  ');
  return assemble(`big_${functions}_${adds}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  ${funcs}
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);
};
