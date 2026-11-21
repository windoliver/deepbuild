// This folder's piece (README: Fixtures): the duel, one logic program in WebAssembly text built against the item's
// region map as `deep-logic`'s `check` reports it, as a `deep-logic` piece (the app's logic module, where each
// viewer's first session writes their profile record) and as a document with a two-seat net item (the match). Every
// expected value is this file's own function of the scripts below, never read from a run.

import { assemble, check, entry, sha256, type Checked, type JsonObject, type JsonValue, type Program } from './helpers.ts';

export const FLICKS = 705_600_000;
/** The match and the logic item: 60 Hz, delay 2, window 8 (net@1's defaults), a full-state hash at every logic
 * checkpoint (every 60 steps), 400 match steps. */
export const RATE = 60;
export const STEP = FLICKS / RATE;
export const DELAY = 2;
export const WINDOW = 8;
export const CHECKPOINT_EVERY = 60;
export const STEPS = 400;
/** Every checkpoint of a 400-step match: 0, 60, …, 360. */
export const CHECKPOINTS = Array.from({ length: Math.floor((STEPS - 1) / CHECKPOINT_EVERY) + 1 }, (_, i) => i * CHECKPOINT_EVERY);
/** The step that always asks for a profile record (1 into `ask`), in a viewer's first session and in the match. */
export const ASK_AT = 60;
/** The step that asks only when it reads no `poke` entry: player 2 pokes there, so only a run of it that predicted
 * player 2's input (a step past `confirmed`) asks. */
export const PAST_AT = 300;
/** A viewer's first session (the app, alone): 90 steps, so its record is the one of step 60. */
export const SOLO_STEPS = 90;

export const LOGIC = 'rules';
export const NET = 'match';
export const RELAY = 'https://relay.test/276';
export const GAIN = 'gain';
export const POKE = 'poke';

// ---------------------------------------------------------------------------------------------------
// The item's fields

/** The item's writes, in declaration order: `ask` the profile's request, `seen` what step 0 read in the profile entry
 * (two blocks of four i32), `stats` (pokes so far, the step) and `xp` (the sum of gain entries). */
export const WRITES: JsonObject = { ask: { type: 'i32' }, seen: { type: 'i32', count: 8 }, stats: { type: 'i32', count: 2 }, xp: { type: 'i32' } };
/** The profile (the issue's field): `stats` then `xp` (declaration order and name order agree), `ask` its request. */
export const PROFILE: JsonObject = { arrays: { stats: { type: 'i32', count: 2 }, xp: { type: 'i32', count: 1 } }, request: 'ask' };
/** One player's block of the profile entry (README: The read region): a u32, then stats (2 × i32), then xp (i32). */
export const BLOCK_BYTES = 4 + 4 * 2 + 4;
export const PLAYERS = 2;
export const READS = [GAIN, POKE] as const;
/** The item's init writes this over both blocks, so a module that leaves a block unfilled shows it. */
export const GARBAGE = 0xa5a5a5a5 | 0;

const slider = (label: string, range: [number, number]): JsonObject => ({ kind: 'slider', class: 'document', label, role: 'slider', range, default: 0, increment: 1 });
export const CONTROLS: JsonObject = { [GAIN]: slider('Gain', [0, 5000]), [POKE]: slider('Poke', [0, 1]) };

/** A record's arrays as this suite names them, which `profile.arrays` gives. */
export interface Arrays { stats: number[]; xp: number[] }
/** A block as step 0 reads it: the u32 1 and the record's arrays in `profile.arrays`' order. */
export const blockOf = (a: Arrays): number[] => [1, ...a.stats, ...a.xp];

// ---------------------------------------------------------------------------------------------------
// The scripts and what they give

/** An entry on a `deep-logic` input track: one viewer's own, alone. */
const own = (step: number, control: string, value: number): JsonObject => ({ t: step * STEP, seq: 0, control, value, writer: 'you', player: 1 });
/** Viewer A (player 1 in the match) in their first session: gains 500 and 700, no poke. */
export const SOLO_A: JsonObject[] = [own(10, GAIN, 500), own(20, GAIN, 700)];
/** Viewer B (player 2 in the match) in their first session: a poke, then a gain of 3,400. */
export const SOLO_B: JsonObject[] = [own(5, POKE, 1), own(15, GAIN, 3400)];
/** The record each first session writes, at step 60: stats [pokes, 60], xp the gains. */
export const RECORD_A: Arrays = { stats: [0, ASK_AT], xp: [1200] };
export const RECORD_B: Arrays = { stats: [1, ASK_AT], xp: [3400] };
/** What every copy's step 0 reads in the match: player 1's block (A's record), then player 2's (B's). */
export const SEEN: number[] = [...blockOf(RECORD_A), ...blockOf(RECORD_B)];

/** `match`'s `plays` (#549's): an entry `{step: g}` is made when step g is the first its copy hasn't run, stamped
 * `delay` steps later. Player 1 gains 25 (at 32); player 2 gains 40 (at 42) and pokes at 60 and at 300. */
export type Plays = Record<string, { step: number; control: string; value: JsonValue }[]>;
export const PLAYS: Plays = {
  1: [{ step: 32 - DELAY, control: GAIN, value: 25 }],
  2: [{ step: 42 - DELAY, control: GAIN, value: 40 }, { step: ASK_AT - DELAY, control: POKE, value: 1 }, { step: PAST_AT - DELAY, control: POKE, value: 1 }],
};
/** The one record a confirmed step of the match asks for: step 60 as confirmed, with player 2's poke there (a run of
 * step 60 that predicted player 2's input, a step past `confirmed`, would hold stats [0, 60]). */
export const MATCH_RECORD: Arrays = { stats: [1, ASK_AT], xp: [65] };

// ---------------------------------------------------------------------------------------------------
// The program

const W = 4096;
/** Where step 0's two blocks are kept, and the state: xp at 8224, pokes so far at 8228. */
const KEPT = 8192;
const XP = 8224;
const POKES = 8228;

/** A program built for no layout: `check` of an item naming it reports the item's region map. */
const probe = (): Program => assemble('layout_probe', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${W}))
  (func $init (export "init") (param $seed i64))
  (func $step (export "step") (param $k i64)))`);

/** A piece as `deep-logic` takes it (#531's, with #189's fields): the controls, the one item and its program. */
export function piece(program: Program): JsonObject {
  return {
    seed: 276_04, controls: CONTROLS,
    items: { [LOGIC]: { kind: 'logic@1', params: { program: program.sha, step_rate: RATE, reads: [...READS], writes: WRITES, checkpoint: { every: CHECKPOINT_EVERY }, profile: PROFILE } } },
    assets: { [program.sha]: program.bytes.toString('base64') },
  };
}
/** The item's region map, from `check` of a layout probe with the item's fields (a base without `profile` fails
 * here, before deep-show is built). */
export const regions = (): Checked => check(piece(probe()), 'check of a layout probe whose logic item declares a profile')[LOGIC]!;

/**
 * The duel's rules. Its init writes GARBAGE over both blocks of the profile entry. Step 0 copies the two blocks (32
 * bytes) into its state; every step adds each gain entry's value to xp and counts the poke entries, then writes `seen`
 * (the two blocks step 0 read), `xp`, `stats` = [pokes so far, k] and `ask` = 1 at step 60, and at step 300 only when
 * that step read no poke entry.
 */
export function rulesProgram(c: Checked): Program {
  const gain = entry(c, 'reads', GAIN).offset;
  const poke = entry(c, 'reads', POKE).offset;
  const profile = entry(c, 'reads', 'profile').offset;
  const at = (n: string): number => W + entry(c, 'writes', n).offset;
  const seen = Array.from({ length: 8 }, (_, i) => `(i32.store (i32.const ${at('seen') + 4 * i}) (i32.load (i32.const ${KEPT + 4 * i})))`).join('\n    ');
  return assemble(`duel_${gain}_${poke}_${profile}_${at('ask')}_${at('seen')}_${at('stats')}_${at('xp')}`, `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${W}))
  (func $init (export "init") (param $seed i64) (local $i i32)
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $i) (i32.const ${PLAYERS * BLOCK_BYTES})))
      (i32.store (i32.add (i32.const ${profile}) (local.get $i)) (i32.const ${GARBAGE}))
      (local.set $i (i32.add (local.get $i) (i32.const 4)))
      (br $each))))
  (func $step (export "step") (param $k i64) (local $n i32) (local $e i32) (local $pokes i32)
    (if (i64.eqz (local.get $k)) (then
      (memory.copy (i32.const ${KEPT}) (i32.const ${profile}) (i32.const ${PLAYERS * BLOCK_BYTES}))))
    (local.set $n (i32.load (i32.const ${gain})))
    (block $done (loop $each
      (br_if $done (i32.ge_u (local.get $e) (local.get $n)))
      (i32.store (i32.const ${XP}) (i32.add (i32.load (i32.const ${XP}))
        (i32.trunc_f64_s (f64.load (i32.add (i32.const ${gain + 16}) (i32.shl (local.get $e) (i32.const 4)))))))
      (local.set $e (i32.add (local.get $e) (i32.const 1)))
      (br $each)))
    (local.set $pokes (i32.load (i32.const ${poke})))
    (i32.store (i32.const ${POKES}) (i32.add (i32.load (i32.const ${POKES})) (local.get $pokes)))
    ${seen}
    (i32.store (i32.const ${at('xp')}) (i32.load (i32.const ${XP})))
    (i32.store (i32.const ${at('stats')}) (i32.load (i32.const ${POKES})))
    (i32.store (i32.const ${at('stats') + 4}) (i32.wrap_i64 (local.get $k)))
    (i32.store (i32.const ${at('ask')})
      (i32.or (i64.eq (local.get $k) (i64.const ${ASK_AT}))
              (i32.and (i64.eq (local.get $k) (i64.const ${PAST_AT})) (i32.eqz (local.get $pokes)))))))`);
}

// ---------------------------------------------------------------------------------------------------
// The document (#391's envelope, as #549's suite writes its lockstep piece)

export const DOC_ID = '01JB276M000000000000000001';
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #276 match acceptance tests.' };
/** The duel: a 3D scene with a camera, a box, the sliders gain and poke, the logic item `rules` (60 Hz, reading
 * both, with its profile) and the net item `match` (2 players, 60 Hz, delay 2, window 8, a hash every 60 steps). */
export function duelDoc(program: Program): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 3, 12], target: [0, 0.5, 0], fov: 40 } },
    block: { kind: 'mark.box@1', params: { size: [1, 1, 1] }, at: { pos: [0, 0.5, 0] } },
    [LOGIC]: { kind: 'logic@1', params: { program: program.sha, step_rate: RATE, reads: [...READS], writes: WRITES, checkpoint: { every: CHECKPOINT_EVERY }, profile: PROFILE } },
    [NET]: { kind: 'net@1', params: { relay: RELAY, players: PLAYERS, step_rate: RATE, delay: DELAY, window: WINDOW, hash_every: CHECKPOINT_EVERY } },
  };
  const withIds: JsonObject = {};
  let k = 0;
  for (const [id, item] of Object.entries(items)) withIds[id] = { id, name: id, order: `a${String(k++).padStart(4, '0')}`, ...item };
  return {
    format: 1, id: DOC_ID, profile: 'scene', title: 'A duel with profiles', description: 'A two-seat piece the #276 match acceptance tests play.', size: [640, 360], camera: 'cam', seed: 276,
    transport: { span: '20s', frame_rate: [60, 1] },
    requires: { modules: { scene3d: '^1', input: '^1', logic: '^1', net: '^1' } },
    controls: CONTROLS,
    assets: { rules_program: { sha256: program.sha, license: LICENSE } },
    items: withIds,
  };
}

export { sha256 };
