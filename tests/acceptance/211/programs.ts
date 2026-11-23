// This suite's programs, as an agent would write them (README: Programs), in WebAssembly text. Every logic program
// exports `memory` (its maximum equal to its minimum), `init(seed: i64)`, `step(k: i64)` and the immutable globals
// `reads_at` (0) and `writes_at` (4,096); one with world pages also `pages_at` (65,536). Its arrays sit in the write
// region in declaration order, each on an 8-byte boundary (#531's rule, helpers.ts' writeAddresses). The page region
// (README: The page region): at pages_at `moves` requests {page: u32, slot: u32}, then the slot table, `slots` ×
// {page: u32, fresh: u32}, in the region's first 64 KiB page; page slot s is the memory page at pages_at + 65,536 ×
// (1 + s). A program writes 0xFFFFFFFF into every request it doesn't use, every step. The provider exports `memory`,
// `gen(seed: i64) → i32` and the immutable globals `params_at`, `assets_at` and `out_at` (#192's form).

import { PAGES_AT, assemble, memoryPages, tableAt, writeAddresses, type Program, type Writes } from './helpers.ts';

const PG = PAGES_AT;
const head = (memory: number, paged: boolean): string => `
  (memory (export "memory") ${memory} ${memory})
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))${paged ? `
  (global (export "pages_at") i32 (i32.const ${PG}))` : ''}`;
/** Page slot s's first byte. */
const BASE = `
  (func $base (param $s i32) (result i32) (i32.shl (i32.add (local.get $s) (i32.const 2)) (i32.const 16)))`;
/** splitmix64's finalizer, after its increment. */
const MIX = `
  (func $mix (param $x i64) (result i64)
    (local.set $x (i64.add (local.get $x) (i64.const 0x9e3779b97f4a7c15)))
    (local.set $x (i64.mul (i64.xor (local.get $x) (i64.shr_u (local.get $x) (i64.const 30))) (i64.const 0xbf58476d1ce4e5b9)))
    (local.set $x (i64.mul (i64.xor (local.get $x) (i64.shr_u (local.get $x) (i64.const 27))) (i64.const 0x94d049bb133111eb)))
    (i64.xor (local.get $x) (i64.shr_u (local.get $x) (i64.const 31))))`;
/** Every request asks for nothing (page 0xFFFFFFFF, slot 0). */
const clear = (moves: number): string => `
  (func $clear${Array.from({ length: moves }, (_, i) => `
    (i32.store (i32.const ${PG + 8 * i}) (i32.const -1)) (i32.store (i32.const ${PG + 8 * i + 4}) (i32.const 0))`).join('')})`;
/** Asks request i for `page` into `slot`. */
const ask = (i: number, page: number, slot: number): string => `(i32.store (i32.const ${PG + 8 * i}) (i32.const ${page})) (i32.store (i32.const ${PG + 8 * i + 4}) (i32.const ${slot}))`;
/** `$ask8(first, group)`: requests 0 to 7 ask pages first … first + 7 into slots 8 × group … 8 × group + 7. */
const ASK8 = `
  (func $ask8 (param $first i32) (param $group i32) (local $i i32)
    (loop $a
      (i32.store (i32.add (i32.const ${PG}) (i32.shl (local.get $i) (i32.const 3))) (i32.add (local.get $first) (local.get $i)))
      (i32.store (i32.add (i32.const ${PG + 4}) (i32.shl (local.get $i) (i32.const 3))) (i32.add (i32.shl (local.get $group) (i32.const 3)) (local.get $i)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $a (i32.lt_u (local.get $i) (i32.const 8)))))`;

// ---------------------------------------------------------------------------------------------------
// The walker (criteria 1, 3 and 10)

export const walkWrites = (slots: number): Writes => ({ slots: { type: 'i32', count: slots }, page: { type: 'i32' }, asked: { type: 'i32' }, acc: { type: 'i32', count: 2 } });
export interface WalkerSpec {
  name: string;
  slots: number;
  moves: number;
  /** A w × h torus of pages (page = y × w + x), stepped to a neighbour each round; or a ring of n pages, stepped by one. */
  topology: { torus: [number, number] } | { ring: number };
  start: number;
  /** The xorshift64 stream's first state (a torus walk's directions), nonzero. */
  pathSeed?: bigint;
  /** visit: write hash(seed, page, step) into the page it is in, each step; generate: fill each page that arrives fresh
   * from the seed and its number alone; tree: generate, and also write a tree into the page east of it when that one is resident. */
  mode: 'visit' | 'generate' | 'tree';
}
/**
 * A walk in rounds of 8 steps. In round j (steps 8j … 8j + 7) the walker is in page p_j. At step 8j + 3 it picks p_{j+1}
 * (on a torus: a neighbour in the direction (the top 2 bits of its xorshift64 stream, from pathSeed) + steer,
 * mod 4, where steer is ⌊4 × the last `steer` entry's value⌋ mod 4; on a ring: the next page) and, unless p_{j+1} is in
 * a slot already, asks for it in request 0 into the next slot round-robin that doesn't hold p_j; the move lands at step
 * 8j + 7 (lead 4), so a move is queued in the states 8j + 4 … 8j + 7 of a round that asked. init asks for the start
 * page into slot 0 (landing at step 3). It finds a page among the slots it has filled by the slot table.
 * Each step it writes: `slots`, the slot table's page numbers as the step read them; `page`, p_j when it is resident
 * (else −1); `asked`, the page it asked for after this step (else −1); `acc`, an i64 (as two i32) folding in what it
 * read where it wrote (visit). It reads the control `steer` (its read slot at 0). Item: reads ["steer"], writes
 * walkWrites(slots), pages {slots, moves 8, lead 4}, memory 2 + slots pages.
 */
export function walker(o: WalkerSpec): Program {
  const S = o.slots;
  const T = tableAt(o.moves, 0);
  const w = writeAddresses(walkWrites(S));
  const torus = 'torus' in o.topology ? o.topology.torus : null;
  const ring = 'ring' in o.topology ? o.topology.ring : 0;
  const gen = o.mode !== 'visit';
  const neighbour = torus ? `
  (func $neighbour (param $p i32) (param $d i32) (result i32) (local $x i32) (local $y i32)
    (local.set $x (i32.rem_u (local.get $p) (i32.const ${torus[0]})))
    (local.set $y (i32.div_u (local.get $p) (i32.const ${torus[0]})))
    (if (i32.eq (local.get $d) (i32.const 0)) (then (local.set $x (i32.rem_u (i32.add (local.get $x) (i32.const 1)) (i32.const ${torus[0]})))))
    (if (i32.eq (local.get $d) (i32.const 1)) (then (local.set $y (i32.rem_u (i32.add (local.get $y) (i32.const 1)) (i32.const ${torus[1]})))))
    (if (i32.eq (local.get $d) (i32.const 2)) (then (local.set $x (i32.rem_u (i32.add (local.get $x) (i32.const ${torus[0] - 1})) (i32.const ${torus[0]})))))
    (if (i32.eq (local.get $d) (i32.const 3)) (then (local.set $y (i32.rem_u (i32.add (local.get $y) (i32.const ${torus[1] - 1})) (i32.const ${torus[1]})))))
    (i32.add (i32.mul (local.get $y) (i32.const ${torus[0]})) (local.get $x)))` : '';
  const generate = gen ? `
  (func $generate (param $slot i32) (param $page i32) (local $i i32) (local $b i32)
    (local.set $b (call $base (local.get $slot)))
    (loop $w
      (i32.store (i32.add (local.get $b) (i32.shl (local.get $i) (i32.const 2)))
        (i32.wrap_i64 (call $mix (i64.add (i64.xor (global.get $seed) (i64.shl (i64.extend_i32_u (local.get $page)) (i64.const 20))) (i64.extend_i32_u (local.get $i))))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $w (i32.lt_u (local.get $i) (i32.const 1024))))${o.mode === 'tree' ? `
    ;; the planted generator: a tree in the page east of this one, whenever that page is resident
    (local.set $i (call $find (call $neighbour (local.get $page) (i32.const 0))))
    (if (i32.ge_s (local.get $i) (i32.const 0))
      (then (i32.store (i32.add (call $base (local.get $i)) (i32.const 8000)) (i32.const 2030))))` : ''})` : '';
  const pick = torus ? `
        (local.set $x (global.get $rng))
        (local.set $x (i64.xor (local.get $x) (i64.shl (local.get $x) (i64.const 13))))
        (local.set $x (i64.xor (local.get $x) (i64.shr_u (local.get $x) (i64.const 7))))
        (local.set $x (i64.xor (local.get $x) (i64.shl (local.get $x) (i64.const 17))))
        (global.set $rng (local.get $x))
        (local.set $d (i32.and (i32.add (i32.wrap_i64 (i64.shr_u (local.get $x) (i64.const 62))) (global.get $steer)) (i32.const 3)))
        (global.set $next (call $neighbour (global.get $cur) (local.get $d)))` : `
        (global.set $next (i32.rem_u (i32.add (global.get $cur) (i32.const 1)) (i32.const ${ring})))`;
  return assemble(o.name, `
(module${head(memoryPages(S), true)}
  (global $seed (mut i64) (i64.const 0))
  (global $rng (mut i64) (i64.const 0))
  (global $cur (mut i32) (i32.const 0))
  (global $next (mut i32) (i32.const 0))
  (global $rr (mut i32) (i32.const 0))
  (global $filled (mut i32) (i32.const 0))
  (global $lslot (mut i32) (i32.const -1))
  (global $lat (mut i64) (i64.const -1))
  (global $acc (mut i64) (i64.const 0))
  (global $steer (mut i32) (i32.const 0))${BASE}${MIX}${clear(o.moves)}
  (func $find (param $page i32) (result i32) (local $s i32)
    (block $none
      (loop $scan
        (br_if $none (i32.ge_u (local.get $s) (global.get $filled)))
        (if (i32.eq (i32.load (i32.add (i32.const ${T}) (i32.shl (local.get $s) (i32.const 3)))) (local.get $page))
          (then (return (local.get $s))))
        (local.set $s (i32.add (local.get $s) (i32.const 1)))
        (br $scan)))
    (i32.const -1))${neighbour}${generate}
  (func $plan (param $page i32) (param $land i64) (local $v i32) (local $cs i32)
    (if (i32.ge_s (call $find (local.get $page)) (i32.const 0)) (then (return)))
    (local.set $cs (call $find (global.get $cur)))
    (local.set $v (i32.rem_u (global.get $rr) (i32.const ${S})))
    (if (i32.eq (local.get $v) (local.get $cs))
      (then
        (global.set $rr (i32.add (global.get $rr) (i32.const 1)))
        (local.set $v (i32.rem_u (global.get $rr) (i32.const ${S})))))
    (global.set $rr (i32.add (global.get $rr) (i32.const 1)))
    (i32.store (i32.const ${PG}) (local.get $page))
    (i32.store (i32.const ${PG + 4}) (local.get $v))
    (global.set $lslot (local.get $v))
    (global.set $lat (local.get $land))
    (i32.store (i32.const ${w['asked']}) (local.get $page)))
  (func (export "init") (param $seed i64)
    (global.set $seed (local.get $seed))
    (global.set $rng (i64.const ${o.pathSeed ?? 1n}))
    (global.set $cur (i32.const ${o.start}))
    (global.set $next (i32.const ${o.start}))
    (call $clear)
    ${ask(0, o.start, 0)}
    (global.set $lslot (i32.const 0))
    (global.set $lat (i64.const 3))
    (global.set $rr (i32.const 1)))
  (func (export "step") (param $k i64) (local $r i32) (local $s i32) (local $n i32) (local $addr i32) (local $d i32) (local $x i64)
    (call $clear)
    (i32.store (i32.const ${w['asked']}) (i32.const -1))
    (local.set $n (i32.load (i32.const 0)))
    (if (i32.gt_u (local.get $n) (i32.const 0))
      (then (global.set $steer (i32.and (i32.trunc_sat_f64_s (f64.mul (f64.load (i32.shl (local.get $n) (i32.const 4))) (f64.const 4))) (i32.const 3)))))
    (local.set $r (i32.wrap_i64 (i64.and (local.get $k) (i64.const 7))))
    (if (i32.and (i32.eqz (local.get $r)) (i64.gt_s (local.get $k) (i64.const 0)))
      (then (global.set $cur (global.get $next))))
    (if (i64.eq (local.get $k) (global.get $lat))
      (then
        (if (i32.ge_u (global.get $lslot) (global.get $filled)) (then (global.set $filled (i32.add (global.get $lslot) (i32.const 1)))))${gen ? `
        (if (i32.eq (i32.load (i32.add (i32.const ${T + 4}) (i32.shl (global.get $lslot) (i32.const 3)))) (i32.const 1))
          (then (call $generate (global.get $lslot) (i32.load (i32.add (i32.const ${T}) (i32.shl (global.get $lslot) (i32.const 3)))))))` : ''}
        (global.set $lat (i64.const -1))))
    (loop $copy
      (i32.store (i32.add (i32.const ${w['slots']}) (i32.shl (local.get $s) (i32.const 2)))
        (i32.load (i32.add (i32.const ${T}) (i32.shl (local.get $s) (i32.const 3)))))
      (local.set $s (i32.add (local.get $s) (i32.const 1)))
      (br_if $copy (i32.lt_u (local.get $s) (i32.const ${S}))))
    (local.set $s (call $find (global.get $cur)))
    (i32.store (i32.const ${w['page']}) (select (global.get $cur) (i32.const -1) (i32.ge_s (local.get $s) (i32.const 0))))${o.mode === 'visit' ? `
    (if (i32.ge_s (local.get $s) (i32.const 0))
      (then
        (local.set $addr (i32.add (call $base (local.get $s)) (i32.and (i32.shl (i32.wrap_i64 (local.get $k)) (i32.const 3)) (i32.const 65535))))
        (global.set $acc (i64.add (i64.mul (global.get $acc) (i64.const 31)) (i64.load (local.get $addr))))
        (i64.store (local.get $addr) (call $mix (i64.xor (i64.xor (global.get $seed) (i64.shl (i64.extend_i32_u (global.get $cur)) (i64.const 32))) (local.get $k))))))` : ''}
    (i64.store (i32.const ${w['acc']}) (global.get $acc))
    (if (i32.eq (local.get $r) (i32.const 3))
      (then${pick}
        (call $plan (global.get $next) (i64.add (local.get $k) (i64.const 4)))))))`);
}

// ---------------------------------------------------------------------------------------------------
// Scripted pages (criteria 2, 4 and 9)

export interface ScriptSpec {
  name: string;
  slots: number;
  moves: number;
  /** Requests after init, each {page, slot}, in request order. */
  init?: { page: number; slot: number }[];
  /** At step k: requests (in request order) and writes into a slot's bytes. */
  at: Record<number, ({ ask: { page: number; slot: number } } | { write: { slot: number; offset: number; value: number; bytes: 1 | 4 } })[]>;
  /** Read each step, after that step's writes, into `seen` (an i32 each). */
  reads: { slot: number; offset: number; bytes: 1 | 4 }[];
}
export const scriptWrites = (reads: number): Writes => ({ seen: { type: 'i32', count: reads } });
/** A program that does exactly what its script says, at the steps it names. Item: writes scriptWrites(reads), memory 2 + slots pages. */
export function script(o: ScriptSpec): Program {
  const w = writeAddresses(scriptWrites(o.reads.length));
  const acts = Object.entries(o.at).map(([k, list]) => {
    let i = 0;
    const body = list.map((a) => {
      if ('ask' in a) return ask(i++, a.ask.page, a.ask.slot);
      const { slot, offset, value, bytes } = a.write;
      return `(i32.${bytes === 1 ? 'store8' : 'store'} (i32.add (call $base (i32.const ${slot})) (i32.const ${offset})) (i32.const ${value | 0}))`;
    }).join('\n        ');
    return `
    (if (i64.eq (local.get $k) (i64.const ${k}))
      (then
        ${body}))`;
  }).join('');
  const reads = o.reads.map((r, j) => `
    (i32.store (i32.const ${w['seen']! + 4 * j}) (i32.${r.bytes === 1 ? 'load8_u' : 'load'} (i32.add (call $base (i32.const ${r.slot})) (i32.const ${r.offset}))))`).join('');
  return assemble(o.name, `
(module${head(memoryPages(o.slots), true)}${BASE}${clear(o.moves)}
  (func (export "init") (param $seed i64)
    (call $clear)
    ${(o.init ?? []).map((a, i) => ask(i, a.page, a.slot)).join('\n    ')})
  (func (export "step") (param $k i64)
    (call $clear)${acts}${reads}))`);
}

// ---------------------------------------------------------------------------------------------------
// Fresh pages in batches (criteria 4, 7 and 8)

export const floodWrites: Writes = { written: { type: 'i32' } };
/**
 * Batch b is `moves` pages, moves × b … moves × b + moves − 1, asked into slot group b mod 8 (slots moves × (b mod 8) +
 * i): init asks batch 0 and step k asks batch k + 1 while k + 1 ≤ last, so batch b lands at step b + 3. When a batch
 * lands, the program writes page + 1 into the first word of each of its pages p with p ≤ limit and p not in `skip`
 * (fewer than `write` per batch when `write` is set: only its first `write` pages), counting them in `written`.
 * Item: writes floodWrites, pages {slots: 8 × moves, moves}, memory 2 + 8 × moves pages.
 */
export function flood(o: { name: string; moves: 8 | 16; last: number; limit: number; skip?: [number, number]; write?: number }): Program {
  const M = o.moves;
  const w = writeAddresses(floodWrites);
  const shift = M === 16 ? 4 : 3;
  const skip = o.skip ?? [1, 0];
  return assemble(o.name, `
(module${head(memoryPages(8 * M), true)}${BASE}${clear(M)}
  (func $batch (param $b i32) (local $i i32)
    (loop $a
      (i32.store (i32.add (i32.const ${PG}) (i32.shl (local.get $i) (i32.const 3))) (i32.add (i32.shl (local.get $b) (i32.const ${shift})) (local.get $i)))
      (i32.store (i32.add (i32.const ${PG + 4}) (i32.shl (local.get $i) (i32.const 3))) (i32.add (i32.shl (i32.and (local.get $b) (i32.const 7)) (i32.const ${shift})) (local.get $i)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $a (i32.lt_u (local.get $i) (i32.const ${M})))))
  (func (export "init") (param $seed i64) (call $clear) (call $batch (i32.const 0)))
  (func (export "step") (param $k i64) (local $b i32) (local $i i32) (local $p i32)
    (call $clear)
    (if (i64.ge_s (local.get $k) (i64.const 3))
      (then
        (local.set $b (i32.wrap_i64 (i64.sub (local.get $k) (i64.const 3))))
        (if (i32.le_s (local.get $b) (i32.const ${o.last}))
          (then
            (loop $w
              (local.set $p (i32.add (i32.shl (local.get $b) (i32.const ${shift})) (local.get $i)))
              (if (i32.and (i32.and (i32.le_u (local.get $p) (i32.const ${o.limit})) (i32.lt_u (local.get $i) (i32.const ${o.write ?? M})))
                    (i32.or (i32.lt_u (local.get $p) (i32.const ${skip[0]})) (i32.gt_u (local.get $p) (i32.const ${skip[1]}))))
                (then
                  (i32.store (call $base (i32.add (i32.shl (i32.and (local.get $b) (i32.const 7)) (i32.const ${shift})) (local.get $i))) (i32.add (local.get $p) (i32.const 1)))
                  (i32.store (i32.const ${w['written']}) (i32.add (i32.load (i32.const ${w['written']})) (i32.const 1)))))
              (local.set $i (i32.add (local.get $i) (i32.const 1)))
              (br_if $w (i32.lt_u (local.get $i) (i32.const ${M}))))))))
    (if (i64.lt_s (local.get $k) (i64.const ${o.last}))
      (then (call $batch (i32.add (i32.wrap_i64 (local.get $k)) (i32.const 1)))))))`);
}

// ---------------------------------------------------------------------------------------------------
// The save's world (criterion 5)

export const TOUCHED = 300;
export const touchWrites: Writes = { request: { type: 'i32' }, read: { type: 'i32', count: 16 } };
/**
 * Pages {max 2,048, slots 64, moves 8}. Phase 1: batch b (pages 8b … 8b + 7, slots 8 × (b mod 8) …) is asked after
 * step b − 1 (init asks batch 0) through batch 45 and lands at step b + 3; each of its pages p < 300 is filled when it
 * lands: word 0 is p, words 1 … 16,383 an xorshift32 stream seeded by init's seed and p, so the 300 touched pages are
 * 300 distinct, incompressible 64 KiB pages. By the moves before step 48 every touched page has been moved out (batches
 * 38 to 45 of untouched pages took their slots). Step 48 writes 1 into `request` (a save of slot 1 once it ends).
 * Phase 2: step 50 + i asks pages 8i … 8i + 7 (i = 0 … 37) into slot group i mod 8, landing at 54 + i, when the step
 * copies each landed page's first two words into `read` (16 i32). Item: writes touchWrites, saves {slots 1, request},
 * memory 66 pages.
 */
export function toucher(): Program {
  const w = writeAddresses(touchWrites);
  return assemble('toucher', `
(module${head(memoryPages(64), true)}
  (global $seed32 (mut i32) (i32.const 0))${BASE}${clear(8)}${ASK8}
  (func $fill (param $slot i32) (param $page i32) (local $b i32) (local $i i32) (local $x i32)
    (local.set $b (call $base (local.get $slot)))
    (i32.store (local.get $b) (local.get $page))
    (local.set $x (i32.or (i32.xor (global.get $seed32) (i32.mul (local.get $page) (i32.const 0x9E3779B1))) (i32.const 1)))
    (local.set $i (i32.const 4))
    (loop $w
      (local.set $x (i32.xor (local.get $x) (i32.shl (local.get $x) (i32.const 13))))
      (local.set $x (i32.xor (local.get $x) (i32.shr_u (local.get $x) (i32.const 17))))
      (local.set $x (i32.xor (local.get $x) (i32.shl (local.get $x) (i32.const 5))))
      (i32.store (i32.add (local.get $b) (local.get $i)) (local.get $x))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br_if $w (i32.lt_u (local.get $i) (i32.const 65536)))))
  (func (export "init") (param $seed i64)
    (global.set $seed32 (i32.wrap_i64 (local.get $seed)))
    (call $clear)
    (call $ask8 (i32.const 0) (i32.const 0)))
  (func (export "step") (param $k i64) (local $kk i32) (local $b i32) (local $i i32) (local $p i32)
    (call $clear)
    (local.set $kk (i32.wrap_i64 (local.get $k)))
    (i32.store (i32.const ${w['request']}) (select (i32.const 1) (i32.const 0) (i32.eq (local.get $kk) (i32.const 48))))
    (if (i32.and (i32.ge_s (local.get $kk) (i32.const 3)) (i32.le_s (local.get $kk) (i32.const 48)))
      (then
        (local.set $b (i32.sub (local.get $kk) (i32.const 3)))
        (loop $f
          (local.set $p (i32.add (i32.shl (local.get $b) (i32.const 3)) (local.get $i)))
          (if (i32.lt_u (local.get $p) (i32.const ${TOUCHED}))
            (then (call $fill (i32.add (i32.shl (i32.and (local.get $b) (i32.const 7)) (i32.const 3)) (local.get $i)) (local.get $p))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br_if $f (i32.lt_u (local.get $i) (i32.const 8))))))
    (if (i32.lt_s (local.get $kk) (i32.const 45))
      (then (call $ask8 (i32.shl (i32.add (local.get $kk) (i32.const 1)) (i32.const 3)) (i32.and (i32.add (local.get $kk) (i32.const 1)) (i32.const 7)))))
    (if (i32.and (i32.ge_s (local.get $kk) (i32.const 50)) (i32.le_s (local.get $kk) (i32.const 87)))
      (then (call $ask8 (i32.shl (i32.sub (local.get $kk) (i32.const 50)) (i32.const 3)) (i32.and (i32.sub (local.get $kk) (i32.const 50)) (i32.const 7)))))
    (if (i32.and (i32.ge_s (local.get $kk) (i32.const 54)) (i32.le_s (local.get $kk) (i32.const 91)))
      (then
        (local.set $i (i32.const 0))
        (local.set $b (i32.and (i32.sub (local.get $kk) (i32.const 54)) (i32.const 7)))
        (loop $r
          (i64.store (i32.add (i32.const ${w['read']}) (i32.shl (local.get $i) (i32.const 3)))
            (i64.load (call $base (i32.add (i32.shl (local.get $b) (i32.const 3)) (local.get $i)))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br_if $r (i32.lt_u (local.get $i) (i32.const 8))))))))`);
}
// ---------------------------------------------------------------------------------------------------
// Criterion 6: the provider's pages, their reader, and moves as fuel

export const PROVIDED = 64;
/** FNV-1a over a page's 16,384 little-endian u32 words, as `reader64` computes it. */
export function fnvPage(b: Buffer): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < 65_536; i += 4) h = Math.imul((h ^ b.readUInt32LE(i)) >>> 0, 16777619) >>> 0;
  return h | 0;
}
export const readerWrites: Writes = { sums: { type: 'i32', count: PROVIDED } };
/**
 * Pages {max 1,024, slots 64, moves 8}, four pages a step so each step stays well under its ceiling: batch b is pages
 * 4b … 4b + 3, asked into slots 4b … 4b + 3 (init asks batch 0, step k < 15 batch k + 1), so page p lands at step
 * ⌊p ÷ 4⌋ + 3 in slot p, by step 18; when it lands the step writes FNV-1a of its 64 KiB into sums[p].
 * Item: writes readerWrites, memory 66 pages.
 */
export function reader64(): Program {
  const w = writeAddresses(readerWrites);
  return assemble('reader64', `
(module${head(memoryPages(64), true)}${BASE}${clear(8)}
  (func $ask4 (param $b i32) (local $i i32)
    (loop $a
      (i32.store (i32.add (i32.const ${PG}) (i32.shl (local.get $i) (i32.const 3))) (i32.add (i32.shl (local.get $b) (i32.const 2)) (local.get $i)))
      (i32.store (i32.add (i32.const ${PG + 4}) (i32.shl (local.get $i) (i32.const 3))) (i32.add (i32.shl (local.get $b) (i32.const 2)) (local.get $i)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br_if $a (i32.lt_u (local.get $i) (i32.const 4)))))
  (func $fnv (param $b i32) (result i32) (local $h i32) (local $i i32)
    (local.set $h (i32.const 0x811c9dc5))
    (loop $w
      (local.set $h (i32.mul (i32.xor (local.get $h) (i32.load (i32.add (local.get $b) (local.get $i)))) (i32.const 16777619)))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br_if $w (i32.lt_u (local.get $i) (i32.const 65536))))
    (local.get $h))
  (func (export "init") (param $seed i64) (call $clear) (call $ask4 (i32.const 0)))
  (func (export "step") (param $k i64) (local $kk i32) (local $b i32) (local $i i32) (local $s i32)
    (call $clear)
    (local.set $kk (i32.wrap_i64 (local.get $k)))
    (if (i32.lt_s (local.get $kk) (i32.const 15))
      (then (call $ask4 (i32.add (local.get $kk) (i32.const 1)))))
    (if (i32.and (i32.ge_s (local.get $kk) (i32.const 3)) (i32.le_s (local.get $kk) (i32.const 18)))
      (then
        (local.set $b (i32.sub (local.get $kk) (i32.const 3)))
        (loop $p
          (local.set $s (i32.add (i32.shl (local.get $b) (i32.const 2)) (local.get $i)))
          (i32.store (i32.add (i32.const ${w['sums']}) (i32.shl (local.get $s) (i32.const 2))) (call $fnv (call $base (local.get $s))))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br_if $p (i32.lt_u (local.get $i) (i32.const 4))))))))`);
}
/**
 * The provider `pagegen.region` (out: pages {first 0, count 64}): at out_at a pages@1 asset of pages 0 to 63 (`PAGS`,
 * version 1, count 64, then each page's number and its 64 KiB; the base's decoding of an out: pages range, which needs
 * no length word), word i of page p the low 32 bits of mix(seed ^ (tone << 40) ^ (p << 20 | i)); `tone` (u32) is its one
 * param, at params_at as an i64 (#192's layout).
 */
export function pagegen(): Program {
  return assemble('pagegen', `
(module
  (memory (export "memory") 66 66)
  (global (export "params_at") i32 (i32.const 0))
  (global (export "assets_at") i32 (i32.const 64))
  (global (export "out_at") i32 (i32.const 65536))${MIX}
  (func (export "gen") (param $seed i64) (result i32) (local $p i32) (local $i i32) (local $at i32) (local $tone i64)
    (local.set $tone (i64.load (i32.const 0)))
    (i32.store (i32.const 65536) (i32.const 0x53474150))
    (i32.store (i32.const 65540) (i32.const 1))
    (i32.store (i32.const 65544) (i32.const ${PROVIDED}))
    (local.set $at (i32.const 65548))
    (loop $page
      (i32.store (local.get $at) (local.get $p))
      (local.set $at (i32.add (local.get $at) (i32.const 4)))
      (local.set $i (i32.const 0))
      (loop $word
        (i32.store (local.get $at) (i32.wrap_i64 (call $mix (i64.xor (i64.xor (local.get $seed) (i64.shl (local.get $tone) (i64.const 40)))
          (i64.or (i64.shl (i64.extend_i32_u (local.get $p)) (i64.const 20)) (i64.extend_i32_u (local.get $i)))))))
        (local.set $at (i32.add (local.get $at) (i32.const 4)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br_if $word (i32.lt_u (local.get $i) (i32.const 16384))))
      (local.set $p (i32.add (local.get $p) (i32.const 1)))
      (br_if $page (i32.lt_u (local.get $p) (i32.const ${PROVIDED}))))
    (i32.const 0)))`);
}
/** The provider run in Node's own WebAssembly (unmetered): its out: pages bytes, the 64 pages' pages@1 asset. */
export function pagegenInNode(p: Program, seed: bigint, tone: number): Buffer {
  const inst = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(p.bytes)), {});
  const mem = Buffer.from((inst.exports['memory'] as WebAssembly.Memory).buffer);
  mem.writeBigInt64LE(BigInt(tone), (inst.exports['params_at'] as WebAssembly.Global).value as number);
  (inst.exports['gen'] as (s: bigint) => number)(seed);
  const out = (inst.exports['out_at'] as WebAssembly.Global).value as number;
  return Buffer.from(mem.subarray(out, out + 12 + PROVIDED * 65_540));
}

export const kWrites: Writes = { k: { type: 'i32' } };
/**
 * Pages {max 64, slots 8, moves 8}. At step `at` it writes 8 requests (pages 0 … 7 into slots 0 … 7 when `moves`, else
 * eight requests for nothing): the same instructions either way, so its own fuel is the same at every step; the moves
 * land at step at + 4. At step `spinAt` it spins `spin` times. It writes `k`. Item: writes kWrites, memory 10 pages.
 */
export function mover(o: { name: string; moves: boolean; at: number; spinAt?: number; spin?: number }): Program {
  const w = writeAddresses(kWrites);
  const requests = Array.from({ length: 8 }, (_, i) => ask(i, o.moves ? i : -1, i)).join('\n        ');
  return assemble(o.name, `
(module${head(memoryPages(8), true)}${clear(8)}
  (func (export "init") (param $seed i64) (call $clear))
  (func (export "step") (param $k i64) (local $i i32) (local $acc i32)
    (call $clear)
    (if (i64.eq (local.get $k) (i64.const ${o.at}))
      (then
        ${requests}))${o.spin ? `
    (if (i64.eq (local.get $k) (i64.const ${o.spinAt}))
      (then
        (loop $spin
          (local.set $acc (i32.add (local.get $acc) (local.get $i)))
          (local.set $i (i32.add (local.get $i) (i32.const 1)))
          (br_if $spin (i32.lt_u (local.get $i) (i32.const ${o.spin}))))))` : ''}
    (i32.store (i32.const ${w['k']}) (i32.add (i32.wrap_i64 (local.get $k)) (i32.and (local.get $acc) (i32.const 0))))))`);
}

/** An item without pages (criterion 8): each step writes k into `k`. Item: writes kWrites, memory 1 page. */
export function idle(): Program {
  const w = writeAddresses(kWrites);
  return assemble('idle', `
(module${head(1, false)}
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64) (i32.store (i32.const ${w['k']}) (i32.wrap_i64 (local.get $k)))))`);
}
