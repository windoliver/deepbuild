// This suite's pieces (README: Fixtures): chapter 1 (the giving piece) in two programs with two state layouts,
// chapter 2 (the taking piece), and the roguelike, each a logic program in WebAssembly text built against the item's
// region map as `deep-logic`'s `check` reports it, as a `deep-logic` piece (the app) and as a document for the web
// export. Every logic program exports `memory`, `init(seed: i64)`, `step(k: i64)` and the immutable globals
// `reads_at` and `writes_at` (Logic `logic@1`: Exports) and keeps to the logic subset. Expected values are this
// file's own functions of the step, never read from a run.

import { assemble, check, entry, piece, sha256, type Checked, type Doc, type JsonObject, type Program, type Writes } from './helpers.ts';

/** Chapter 1's steps (10 s at 60 Hz): it writes its carry record at its last step, 599. */
export const CHAPTER1_STEPS = 600;
export const LAST_STEP = CHAPTER1_STEPS - 1;
/** Chapter 1's roster at step k: 3 units of 4 values, element i = 1000 (unit + 1) + 100 (value + 1) + k. */
export const rosterAt = (k: number): number[] => Array.from({ length: 12 }, (_, i) => 1000 * (Math.floor(i / 4) + 1) + 100 * ((i % 4) + 1) + k);
/** Chapter 1's gold at step k. */
export const goldAt = (k: number): number => 7 * k + 5;

/** Chapter 1's state layout bytes (the bytes at `layout_at`, after a u32 of their length), as first written and in
 * the program with another layout; each layout is the sha256 of its bytes (Logic: saves across changes). */
export const LAYOUT_TEXT = { v1: 'campaign chapter 1 state: roster i32 x 12, gold i32; version 1', v2: 'campaign chapter 1 state: roster i32 x 12, gold i32; version 2' } as const;
export type Version = keyof typeof LAYOUT_TEXT;
export const layoutOf = (v: Version): string => sha256(Buffer.from(LAYOUT_TEXT[v], 'latin1'));

export const CHAPTER1 = 'chapter1';
export const CHAPTER2 = 'chapter2';
export const ROGUE = 'rogue';
export const CHAPTER1_WRITES: Writes = { roster: { type: 'i32', count: 12 }, gold: { type: 'i32' }, carry: { type: 'i32' } };
/** The giving item's `carry` (Logic: carry records): `carry` its request array, roster and gold the record's arrays. */
export const CARRY: JsonObject = { request: 'carry', out: ['roster', 'gold'] };
/** The taking item's `carry_in`: the record's shape, roster then gold, and chapter 1's first layout. */
export const CARRY_IN: JsonObject = { arrays: { roster: { type: 'i32', count: 12 }, gold: { type: 'i32', count: 1 } }, accepts: [layoutOf('v1')] };
/** The carry_in entry of the read region: a u32, then 12 i32 and 1 i32, end to end (README: The read region). */
export const CARRY_IN_BYTES = 4 + 4 * 12 + 4;
/** Chapter 2's writes: what step 0 read, each as an array of one element (the player's probe() gives a logic array's
 * value only when it holds one), and its purse, which moves every step. */
export const GOT = ['got_flag', ...Array.from({ length: 12 }, (_, i) => `got_roster${i}`), 'got_gold'] as const;
export const CHAPTER2_WRITES: Writes = { ...Object.fromEntries(GOT.map((n) => [n, { type: 'i32' as const }])), purse: { type: 'i32' } };
/** What chapter 2 reads at step 0 with a record of roster `r` and gold `g`, in GOT's order; without one, zeros. */
export const gotWith = (r: number[], g: number): number[] => [1, ...r, g];
export const GOT_WITHOUT = GOT.map(() => 0);
/** Chapter 2's init writes this over the carry_in entry, so a module that leaves the entry unfilled shows it. */
export const GARBAGE = 0xa5a5a5a5 | 0;
export const ROGUE_WRITES: Writes = { hp: { type: 'i32' }, request: { type: 'i32' }, ends: { type: 'i32' } };
export const ROGUE_SAVES: JsonObject = { slots: 1, request: 'request', ends: 'ends' };
export const EVERY = 60;

// ---------------------------------------------------------------------------------------------------
// Programs

/** A program built for no layout: `check` of an item naming it reports the item's region map. */
const probe = (): Program => assemble('layout_probe', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);
/** The region map `check` gives an item with these writes and fields. */
const regions = (writes: Writes, more: JsonObject): Checked => check(piece(189, { probe: { program: probe(), writes, more } }), `check of a layout probe with ${Object.keys(more).join(', ')}`)['probe']!;
export const chapter1Regions = (): Checked => regions(CHAPTER1_WRITES, { carry: CARRY });
export const chapter2Regions = (): Checked => regions(CHAPTER2_WRITES, { carry_in: CARRY_IN });
export const rogueRegions = (): Checked => regions(ROGUE_WRITES, { saves: ROGUE_SAVES });
const W = 4096;
const at = (c: Checked, name: string): number => W + entry(c, 'writes', name).offset;
/** Bytes as a WebAssembly text string. */
const bytesText = (b: Buffer): string => [...b].map((x) => `\\${x.toString(16).padStart(2, '0')}`).join('');

/**
 * Chapter 1 (criteria 7 and 9): writes its roster (rosterAt(k)) and gold (goldAt(k)) at every step and 1 into its
 * request array `carry` at its last step only, so its one carry record holds step 599's roster and gold. It exports
 * the state layout `layout_at` = 1024: a u32 of the length, then LAYOUT_TEXT[v], in an active data segment.
 */
export function chapter1(c: Checked, v: Version): Program {
  const text = Buffer.from(LAYOUT_TEXT[v], 'latin1');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(text.length);
  return assemble(`chapter1_${v}_${at(c, 'roster')}_${at(c, 'gold')}_${at(c, 'carry')}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${W}))
  (global (export "layout_at") i32 (i32.const 1024))
  (data (i32.const 1024) "${bytesText(Buffer.concat([len, text]))}")
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64) (local $i i32) (local $k32 i32)
    (local.set $k32 (i32.wrap_i64 (local.get $k)))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (i32.const 12)))
      (i32.store (i32.add (i32.const ${at(c, 'roster')}) (i32.shl (local.get $i) (i32.const 2)))
        (i32.add (local.get $k32)
          (i32.add (i32.mul (i32.add (i32.shr_u (local.get $i) (i32.const 2)) (i32.const 1)) (i32.const 1000))
                   (i32.mul (i32.add (i32.and (local.get $i) (i32.const 3)) (i32.const 1)) (i32.const 100)))))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $each)))
    (i32.store (i32.const ${at(c, 'gold')}) (i32.add (i32.mul (local.get $k32) (i32.const 7)) (i32.const 5)))
    (i32.store (i32.const ${at(c, 'carry')}) (i64.eq (local.get $k) (i64.const ${LAST_STEP})))))`);
}

/**
 * Chapter 2 (criteria 7 and 9): its init writes GARBAGE over the read region's carry_in entry; at step 0 it copies
 * the entry (the u32 and the 13 values) into its state at 8192, and its purse starts at the gold it read. Every step
 * adds 1 to the purse and writes what step 0 read (GOT) and the purse. It reads nothing else.
 */
export function chapter2(c: Checked): Program {
  const e = entry(c, 'reads', 'carry_in');
  const from = e.offset;
  const writes = GOT.map((n, i) => `(i32.store (i32.const ${at(c, n)}) (i32.load (i32.const ${8192 + 4 * i})))`).join('\n    ');
  return assemble(`chapter2_${from}_${at(c, 'got_flag')}_${at(c, 'purse')}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${W}))
  (func $init (export "init") (param $seed i64) (local $i i32)
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (i32.const ${CARRY_IN_BYTES})))
      (i32.store (i32.add (i32.const ${from}) (local.get $i)) (i32.const ${GARBAGE}))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br $each))))
  (func $step (export "step") (param $k i64)
    (if (i64.eqz (local.get $k)) (then
      (memory.copy (i32.const 8192) (i32.const ${from}) (i32.const ${CARRY_IN_BYTES}))
      (i32.store (i32.const 8256) (i32.load (i32.const ${8192 + 4 * 13})))))
    (i32.store (i32.const 8256) (i32.add (i32.load (i32.const 8256)) (i32.const 1)))
    ${writes}
    (i32.store (i32.const ${at(c, 'purse')}) (i32.load (i32.const 8256)))))`);
}

/** The roguelike's steps (56 s at 60 Hz), its saves and its end (criterion 9): it asks for slot 1 at the ends of steps
 * 1,799 (a save at 1,800) and 3,299 (after its end, which the ended slot takes no save of), and writes slot 1 into
 * `ends` at the end of step 2,999, where its hero's hp reaches 0: an ended save at step 3,000. */
export const ROGUE_STEPS = 3360;
export const ROGUE_SAVED_AT = 1800;
export const ROGUE_ENDS_AT = 3000;
export const ROGUE_ASKS_AFTER = 3300;
/** The roguelike: hp a mutable global, 3,000 after init and 1 less each step until it is 0. */
export function rogue(c: Checked): Program {
  return assemble(`rogue_${at(c, 'hp')}_${at(c, 'request')}_${at(c, 'ends')}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${W}))
  (global $hp (mut i32) (i32.const 0))
  (func $init (export "init") (param $seed i64) (global.set $hp (i32.const ${ROGUE_ENDS_AT})))
  (func $step (export "step") (param $k i64)
    (if (i32.gt_s (global.get $hp) (i32.const 0)) (then (global.set $hp (i32.sub (global.get $hp) (i32.const 1)))))
    (i32.store (i32.const ${at(c, 'hp')}) (global.get $hp))
    (i32.store (i32.const ${at(c, 'request')}) (i32.or (i64.eq (local.get $k) (i64.const ${ROGUE_SAVED_AT - 1})) (i64.eq (local.get $k) (i64.const ${ROGUE_ASKS_AFTER - 1}))))
    (i32.store (i32.const ${at(c, 'ends')}) (i64.eq (local.get $k) (i64.const ${ROGUE_ENDS_AT - 1})))))`);
}

// ---------------------------------------------------------------------------------------------------
// The pieces as `deep-logic` takes them (the app), and as documents for the web export

export const SEED = 189_07;
export interface Programs { chapter1: Record<Version, Program>; chapter2: Program; rogue: Program }
/** Every program, built against the region maps `check` reports: the logic calls a test makes first. */
export function programs(): Programs {
  const c1 = chapter1Regions();
  return { chapter1: { v1: chapter1(c1, 'v1'), v2: chapter1(c1, 'v2') }, chapter2: chapter2(chapter2Regions()), rogue: rogue(rogueRegions()) };
}
export const chapter1Piece = (p: Programs, v: Version): JsonObject => piece(SEED, { [CHAPTER1]: { program: p.chapter1[v], writes: CHAPTER1_WRITES, checkpoint: { every: EVERY }, more: { carry: CARRY } } });
export const chapter2Piece = (p: Programs): JsonObject => piece(SEED + 1, { [CHAPTER2]: { program: p.chapter2, writes: CHAPTER2_WRITES, checkpoint: { every: EVERY }, more: { carry_in: CARRY_IN } } });

const ulid = (k: number): string => `01JB0189C${String(k).padStart(17, '0')}`;
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Made by the #189 carry acceptance tests at test time.' };
/** A document as #1041's pieces are: a 2D film at 60 frames a second of `seconds`, a figure a driver walks along x with
 * time, and one logic item `id` at 60 Hz with `params` beside its program, writes and checkpoints. */
function film(k: number, title: string, seconds: number, id: string, program: Program, writes: Writes, params: JsonObject): Doc {
  const rect = (rid: string, box: number[], role: string, n: number, part: string): JsonObject =>
    ({ id: rid, kind: 'rect@1', name: rid, order: `a${String(n).padStart(4, '0')}`, role: part, params: { box, paint: { fill: { role } } }, at: { pos: [0, 0, 0] } });
  const items: JsonObject[] = [
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000cam', params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } },
    rect('back', [0, 0, 320, 180], 'ground', 1, 'decoration'),
    rect('wall', [0, 120, 320, 60], 'ink', 2, 'decoration'),
    rect('hero', [0, 100, 12, 12], 'accent', 3, 'part'),
    { id, kind: 'logic@1', name: 'The rules', order: 'a0004', params: { program: program.sha, step_rate: 60, writes: writes as unknown as JsonObject, checkpoint: { every: EVERY }, ...params } },
  ];
  const document: JsonObject = {
    format: 1, id: ulid(k), profile: 'film', title, description: `${title}: a piece for the #189 carry acceptance tests.`, size: [320, 180], camera: 'cam', seed: SEED + k,
    transport: { span: `${seconds}s`, frame_rate: [60, 1] }, requires: { modules: { logic: '^1' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), i])),
    drivers: { walk: { target: 'items/hero/at/pos/0', expr: '10 + 7 * t', vars: { t: 'time' } } },
    assets: { rules: { sha256: program.sha, license: LICENSE } },
  };
  return { id: ulid(k), title, document, programs: [program] };
}
export const chapter1Doc = (p: Programs): Doc => film(1, 'Chapter 1', CHAPTER1_STEPS / 60, CHAPTER1, p.chapter1.v1, CHAPTER1_WRITES, { carry: CARRY });
export const chapter2Doc = (p: Programs): Doc => film(2, 'Chapter 2', 10, CHAPTER2, p.chapter2, CHAPTER2_WRITES, { carry_in: CARRY_IN });
export const rogueDoc = (p: Programs): Doc => film(3, 'The roguelike', ROGUE_STEPS / 60, ROGUE, p.rogue, ROGUE_WRITES, { saves: ROGUE_SAVES });
