// This suite's logic programs, as an agent would write them (README: Programs), in WebAssembly text. Every one exports
// `memory`, `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at` and `writes_at` (Logic `logic@1`:
// Exports) and keeps to the logic subset. A program that reads or writes a region entry is built against the item's
// layout as `check` reports it (read first with `layoutProbe`), so its offsets are the item's.

import { STEP_60, assemble, entryAt, layoutFor, type Entry, type ItemSpec, type Layout, type Program, type WriteSpec, entry, seeded } from './helpers.ts';

/** A program built for no layout: `check` of an item naming it reports the item's layout. */
export const layoutProbe = (): Program => assemble('layout_probe', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 32768))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);

// ---------------------------------------------------------------------------------------------------
// The turn game (criteria 1, 2 and 4).

/** The turn game's item: it reads one choice control and writes these arrays (all i32, held). */
export const TURN_WRITES: Record<string, WriteSpec> = {
  k: { type: 'i32' },
  ran: { type: 'i32' },
  seed: { type: 'i32', count: 2 },
  moves: { type: 'i32' },
  move_at: { type: 'i32' },
  move_seed: { type: 'i32', count: 2 },
  due: { type: 'i32' },
  turn_done: { type: 'i32' },
  score: { type: 'i32' },
};
export const CHOICE = 'choice';
export const CONTROLS = { [CHOICE]: 'choice' };
/** The AI's turn after a move read at step m: W = 8 + (m mod 8) steps, m + 1 to m + W. */
export const work = (m: number): number => 8 + (m % 8);

let turnLayout: Layout | undefined;
/**
 * Criteria 1, 2 and 4: a turn game against an AI. Each step it adds 1 to its count of steps run and writes its step
 * number `k`, that count `ran` and its step's seed `seed` (the read region's seed, as two i32s). A step whose read
 * region holds any entry of the choice control is a move: it adds the entries to `moves`, writes `move_at` = k and
 * `move_seed` = this step's seed, starts the AI's turn of W = 8 + (k mod 8) steps of work, writes `turn_done` = 0 and
 * asks for the next step with `due` = k + 1. A step with no entry does one step of the AI's work while any is left:
 * a roll from a xorshift64 stream seeded by `init` (the mutable global $rng) added to `score`; while work is left it
 * writes `due` = k + 1, and on the last it writes `turn_done` = 1 and `due` = 0 (a value at or before the step asks for
 * none). A step with no entry and no work writes `due` = 0. Its state is memory (work left at 8192, steps run at
 * 8196, moves at 8200, score at 8204) and $rng.
 * Item: reads ["choice"], writes TURN_WRITES; on a turn clock, `due: "due"`.
 */
export function turnGame(): Program {
  turnLayout ??= layoutFor(layoutProbe(), [CHOICE], TURN_WRITES, CONTROLS);
  const l = turnLayout;
  const choice = entryAt(l, 'reads', CHOICE);
  const seed = entryAt(l, 'reads', 'seed');
  const w = (name: string): number => 4096 + entryAt(l, 'writes', name);
  return assemble(`turn_${choice}_${seed}_${l.digest}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (global $rng (mut i64) (i64.const 0))
  (func $init (export "init") (param $seed i64)
    (global.set $rng (i64.or (local.get $seed) (i64.const 1))))
  (func $roll (result i32)
    (global.set $rng (i64.xor (global.get $rng) (i64.shl (global.get $rng) (i64.const 13))))
    (global.set $rng (i64.xor (global.get $rng) (i64.shr_u (global.get $rng) (i64.const 7))))
    (global.set $rng (i64.xor (global.get $rng) (i64.shl (global.get $rng) (i64.const 17))))
    (i32.wrap_i64 (i64.and (global.get $rng) (i64.const 255))))
  (func $step (export "step") (param $k i64) (local $n i32) (local $w i32) (local $k32 i32)
    (local.set $k32 (i32.wrap_i64 (local.get $k)))
    (i32.store (i32.const 8196) (i32.add (i32.load (i32.const 8196)) (i32.const 1)))
    (local.set $n (i32.load (i32.const ${choice})))
    (if (i32.ne (local.get $n) (i32.const 0))
      (then
        (i32.store (i32.const 8200) (i32.add (i32.load (i32.const 8200)) (local.get $n)))
        (i32.store (i32.const ${w('move_at')}) (local.get $k32))
        (i64.store (i32.const ${w('move_seed')}) (i64.load (i32.const ${seed})))
        (i32.store (i32.const 8192) (i32.add (i32.const 8) (i32.and (local.get $k32) (i32.const 7))))
        (i32.store (i32.const ${w('turn_done')}) (i32.const 0))
        (i32.store (i32.const ${w('due')}) (i32.add (local.get $k32) (i32.const 1))))
      (else
        (local.set $w (i32.load (i32.const 8192)))
        (if (i32.gt_s (local.get $w) (i32.const 0))
          (then
            (i32.store (i32.const 8204) (i32.add (i32.load (i32.const 8204)) (call $roll)))
            (local.set $w (i32.sub (local.get $w) (i32.const 1)))
            (i32.store (i32.const 8192) (local.get $w))
            (if (i32.eqz (local.get $w))
              (then
                (i32.store (i32.const ${w('turn_done')}) (i32.const 1))
                (i32.store (i32.const ${w('due')}) (i32.const 0)))
              (else (i32.store (i32.const ${w('due')}) (i32.add (local.get $k32) (i32.const 1))))))
          (else (i32.store (i32.const ${w('due')}) (i32.const 0))))))
    (i32.store (i32.const ${w('k')}) (local.get $k32))
    (i32.store (i32.const ${w('ran')}) (i32.load (i32.const 8196)))
    (i64.store (i32.const ${w('seed')}) (i64.load (i32.const ${seed})))
    (i32.store (i32.const ${w('moves')}) (i32.load (i32.const 8200)))
    (i32.store (i32.const ${w('score')}) (i32.load (i32.const 8204)))))`);
}
/** The turn game's item: 60 Hz, on a turn clock with `due` unless `fixed`. */
export const turnItem = (clock: 'on_input' | 'fixed' = 'on_input'): ItemSpec =>
  ({ program: turnGame(), reads: [CHOICE], writes: TURN_WRITES, ...(clock === 'on_input' ? { clock: 'on_input', due: 'due' } : {}) });

/** The 40 moves over 10 minutes (criteria 2 and 4): move i (1 to 40) near 15 i s, pulled back by up to 5 s at a seeded
 * flick that is rarely on a step, the last exactly at 600 s; values are option indices 0 to 3. */
export function fortyMoves(): Entry[] {
  const r = seeded(545_02);
  return Array.from({ length: 40 }, (_, i) => {
    const at = (i + 1) * 15 * 705_600_000;
    const back = i === 39 ? 0 : Math.floor(r() * 5 * 705_600_000);
    return entry(CHOICE, at - back, i % 4);
  });
}
/** The first step at or after an entry stamped at flick t, at 60 Hz. */
export const stepAtOrAfter = (t: number): number => Math.ceil(t / STEP_60);

// ---------------------------------------------------------------------------------------------------
// The 10 Hz mover and its reader (criteria 3 and 5).

export const MOVER_WRITES = (interpolate: 'linear' | 'hold'): Record<string, WriteSpec> => ({ pos: { type: 'vec3', interpolate } });
let moverLayout: Layout | undefined;
/** Criteria 3 and 5: step k writes x = k m into its vec3 array `pos`: [k, 0, 0]. Item: 10 Hz, writes {pos: vec3}. */
export function mover(): Program {
  moverLayout ??= layoutFor(layoutProbe(), [], { pos: { type: 'vec3' } });
  const pos = 4096 + entryAt(moverLayout, 'writes', 'pos');
  return assemble(`mover_${pos}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (f64.store (i32.const ${pos}) (f64.convert_i64_s (local.get $k)))
    (f64.store (i32.const ${pos + 8}) (f64.const 0))
    (f64.store (i32.const ${pos + 16}) (f64.const 0))))`);
}
export const moverItem = (interpolate: 'linear' | 'hold', every?: number): ItemSpec =>
  ({ program: mover(), step_rate: 10, writes: MOVER_WRITES(interpolate), ...(every ? { checkpoint: { every } } : {}) });

let readerLayout: Layout | undefined;
/** Criterion 3: another logic item that reads the mover's array and writes what it read into its own `seen` (vec3,
 * held). Item: 60 Hz, reads ["mover.pos"], writes {seen: vec3}. */
export function reader(): Program {
  readerLayout ??= layoutFor(layoutProbe(), ['mover.pos'], { seen: { type: 'vec3' } }, {}, { mover: moverItem('hold') });
  const read = entryAt(readerLayout, 'reads', 'mover.pos');
  const seen = 4096 + entryAt(readerLayout, 'writes', 'seen');
  return assemble(`reader_${read}_${seen}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)
    (memory.copy (i32.const ${seen}) (i32.const ${read}) (i32.const 24))))`);
}
export const readerItem = (): ItemSpec => ({ program: reader(), reads: ['mover.pos'], writes: { seen: { type: 'vec3' } } });

/** √½, a quarter turn's half-angle sine and cosine. */
export const SQRT_HALF = Math.SQRT1_2;
export const BLEND_WRITES: Record<string, WriteSpec> = { x: { type: 'f64', interpolate: 'linear' }, xy: { type: 'vec2', interpolate: 'linear' }, q: { type: 'quat', interpolate: 'linear' } };
let blendLayout: Layout | undefined;
/** Criterion 3, the issue's comment: step k writes x = k into an f64, [k, 0] into a vec2 and, into a quat, the
 * identity [0, 0, 0, 1] at step 0 and a quarter turn about z, [0, 0, √½, √½], at every later step.
 * Item: 10 Hz, writes BLEND_WRITES (all linear). */
export function blend(): Program {
  blendLayout ??= layoutFor(layoutProbe(), [], { x: { type: 'f64' }, xy: { type: 'vec2' }, q: { type: 'quat' } });
  const x = 4096 + entryAt(blendLayout, 'writes', 'x');
  const xy = 4096 + entryAt(blendLayout, 'writes', 'xy');
  const q = 4096 + entryAt(blendLayout, 'writes', 'q');
  return assemble(`blend_${x}_${xy}_${q}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64) (local $v f64)
    (local.set $v (f64.convert_i64_s (local.get $k)))
    (f64.store (i32.const ${x}) (local.get $v))
    (f64.store (i32.const ${xy}) (local.get $v))
    (f64.store (i32.const ${xy + 8}) (f64.const 0))
    (f64.store (i32.const ${q}) (f64.const 0))
    (f64.store (i32.const ${q + 8}) (f64.const 0))
    (if (i64.eqz (local.get $k))
      (then
        (f64.store (i32.const ${q + 16}) (f64.const 0))
        (f64.store (i32.const ${q + 24}) (f64.const 1)))
      (else
        (f64.store (i32.const ${q + 16}) (f64.const ${SQRT_HALF}))
        (f64.store (i32.const ${q + 24}) (f64.const ${SQRT_HALF}))))))`);
}

// ---------------------------------------------------------------------------------------------------
// The follow camera (criterion 6): only its declarations matter to the check.

/** Criterion 6: a step that does nothing, for an item whose writes a check reads. */
export const still = (): Program => assemble('still', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const 4096))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);
