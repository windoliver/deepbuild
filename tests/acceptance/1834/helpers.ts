// Test-side tools for the #1834 acceptance tests (README: The surface under test). They extend #522's suite, imported
// read only through ../522/helpers.ts (and through it #1918's, #2010's and #2009's): its ball-and-goal lab, the
// `deep-physics` runner and its `bake` with a `track`, deep-show built with no feature (the full set), #393's
// `deep-show run` scenario and #522's `physics_bake`; and #538's helpers (../538/helpers.ts, read only) for #544's
// WebAssembly text assembler and the evidence store that holds the logic program. Nothing here stands in for the logic
// module or the physics module: every entry, hash, state, value and refusal read here is the program's own; the expected
// values come from the issue's text, computed here, and from `deep-physics`'s own bakes of the same world.

import { expect } from 'vitest';
import {
  FLICKS, LAB_INPUTS, arr, camera, lab, markBox, obj, scenario, sceneDoc, show, type JsonObject, type JsonValue, type V3,
} from '../522/helpers.ts';
import { assemble, putEvidence, type Program } from '../538/helpers.ts';

export * from '../522/helpers.ts';
export { putEvidence, type Program };

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = {
  1: '#1834.9a12b06c',
  2: '#1834.0e85ef5d',
} as const;

/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB1834D0${String(n).padStart(16, '0')}`;

// ---------------------------------------------------------------------------------------------------
// Steps (README: Steps). The logic item steps at 70 Hz and the world at 120 Hz, so the time of the logic item's step 240
// falls between two world steps and "the world's first step at or after it" is a choice among three answers.

export const LOGIC_HZ = 70;
export const WORLD_HZ = 120;
/** The logic step the item fires its launch at (the issue's). */
export const FIRE_STEP = 240;
/** The world's first step at or after logic step k's time, k × FLICKS / 70 flicks, in whole flicks. */
export function firstWorldStep(k: number): number {
  const t = k * (FLICKS / LOGIC_HZ);
  const h = FLICKS / WORLD_HZ;
  return Math.floor((t + h - 1) / h);
}
/** 4 s at 120 Hz: the scene's span in world steps. */
export const STEPS = 480;

// ---------------------------------------------------------------------------------------------------
// The logic program (README: The program). One page of memory: the read region at 0, the item's one write (`k`, the
// step's number as an i32) at 4096, and the fire region at `fires_at`, 4352, laid out as the design's As built (#194)
// paragraph on `fires` says: for each input the item's `fires` lists, in declaration order, an i32 count and then one
// f64 for each number field its kind takes. A launch's one number field is `vertical`, so its slot is the count at +0
// and `vertical` at +4; its `linear` comes from the world input's own field.

const WRITES_AT = 4096;
export const FIRES_AT = 4352;
/** The coach: at its step 240 it leaves its first slot's count at 1 (and `vertical` 0); at every other step, 0. */
export function coachProgram(): Program {
  return assemble('coach_1834', `
(module
  (memory (export "memory") 1 1)
  (global (export "reads_at") i32 (i32.const 0))
  (global (export "writes_at") i32 (i32.const ${WRITES_AT}))
  (global (export "fires_at") i32 (i32.const ${FIRES_AT}))
  (func (export "init") (param $seed i64))
  (func (export "step") (param $k i64)
    (i32.store (i32.const ${WRITES_AT}) (i32.wrap_i64 (local.get $k)))
    (if (i64.eq (local.get $k) (i64.const ${FIRE_STEP}))
      (then
        (i32.store (i32.const ${FIRES_AT}) (i32.const 1))
        (f64.store (i32.const ${FIRES_AT + 4}) (f64.const 0)))
      (else (i32.store (i32.const ${FIRES_AT}) (i32.const 0))))))`);
}

// ---------------------------------------------------------------------------------------------------
// The lab fixture (README: The lab fixture): #522's ball-and-goal lab with its ball at rest at the kick spot, its grab
// and release, and `kick`, a launch of the ball at (6, 3, 0.4) m/s that takes the entries the logic item `coach` fires.

export const COACH = 'coach';
export const WORLD = 'lab';
export const LINEAR: V3 = [6, 3, 0.4];
export const KICK: JsonObject = { kick: { kind: 'launch', targets: ['ball'], on: { logic: COACH }, linear: LINEAR } };
/** The coach's `fires` in AC1: the lab's kick. */
export const FIRES: JsonObject = { [WORLD]: ['kick'] };

/** The lab with its ball at rest, taking `inputs` beside its grab and release, and `outputs`. */
export function launchWorld(inputs: JsonObject, outputs: JsonObject): JsonObject {
  const w = lab();
  const bodies = obj(w['bodies'], 'bodies');
  return {
    ...w,
    bodies: { ...bodies, ball: { ...obj(bodies['ball'], 'ball'), velocity: { linear: [0, 0, 0] } } },
    inputs: { ...LAB_INPUTS, ...inputs },
    outputs,
  };
}
/** The scene's ball's position, which the world's output sets (`eval`'s path). */
export const BALL_PATH = 'items/ball/at/pos';
/** The world `deep-physics` replays: the lab taking the kick, its ball's position an output of its own. */
export const REPLAY = launchWorld(KICK, { ball: { from: 'ball', read: 'position' } });

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #1834 acceptance tests.' };
/** The coach: a logic item at 70 Hz running `program`, writing `k`, and with `fires` when given. */
export function coachItem(program: Program, fires?: JsonObject): JsonObject {
  return { kind: 'logic@1', params: { program: program.sha, step_rate: LOGIC_HZ, writes: { k: { type: 'i32' } }, ...(fires ? { fires } : {}) } };
}
/** The lab as a 4 s scene: its world `lab` taking `inputs` (the kick by default), its ball's pose bound to the scene's ball, and the coach. */
export function labScene(program: Program, o: { fires?: JsonObject; inputs?: JsonObject } = {}): JsonObject {
  const w = launchWorld(o.inputs ?? KICK, { ball: { from: 'ball', read: 'pose', to: 'items/ball/at' } });
  return sceneDoc('Ball and goal, kicked by logic', '4s', {
    cam: camera([4, 3, 12], [4, 0.5, 0]),
    ball: markBox([0.22, 0.22, 0.22]),
    [COACH]: coachItem(program, o.fires),
  }, {
    seed: 1834,
    requires: { modules: { scene3d: '^1', logic: '^1', physics: '^1' } },
    worlds: { [WORLD]: w },
    assets: { coach_program: { sha256: program.sha, license: LICENSE } },
  });
}

// ---------------------------------------------------------------------------------------------------
// deep-show (README: deep-show)

/** The planted logic module of criterion 1 (README: The planted twin). */
export const LATE = 'fire_one_step_late';
/** #1918's scenario, with `planted` when given (a deep-show scenario's planted twin, as #538's and #194's suites pass it). */
export function plantedScenario(evidence: string, docs: string[], calls: JsonObject[], planted?: string): JsonObject {
  return { ...scenario(evidence, docs, calls), ...(planted ? { planted } : {}) };
}
export const physicsBakeCall = (doc: string): JsonObject => ({ call: 'physics_bake', doc, world: WORLD });

/** An entry a world's bake keeps (#522's `Kept`). */
export interface Kept { step: number; kind: string; target: string; input: string; from: string; written: number; data: JsonObject }
export interface Baked { key: string; hashes: string[]; kept: Kept[] }
const HEX16 = /^[0-9a-f]{16}$/;
/** A `physics_bake` reply: its step hashes (index k: the state after k steps) and the entries it keeps, in the order they apply. */
export function bakedOf(reply: JsonObject | undefined, what: string): Baked {
  expect(reply?.['ok'], `${what}: physics_bake answers the lab's bake: ${show(reply)}`).toBe(true);
  const hashes = arr(reply!['step_hashes'], `${what}: step_hashes`).map((h, i) => {
    expect(typeof h === 'string' && HEX16.test(h), `${what}: step_hashes[${i}] is a u64 as 16 hex, got ${show(h)}`).toBe(true);
    return h as string;
  });
  expect(hashes.length, `${what}: the bake runs the scene's 4 s, ${STEPS} steps`).toBe(STEPS + 1);
  const kept = arr(reply!['inputs'], `${what}: the entries the bake keeps`).map((v: JsonValue, i) => {
    const o = obj(v, `${what}: inputs[${i}]`);
    return {
      step: o['step'] as number, kind: String(o['kind']), target: String(o['target']), input: String(o['input']), from: String(o['from']),
      written: o['written'] as number, data: obj(o['data'] ?? {}, `${what}: inputs[${i}].data`),
    };
  });
  return { key: String(reply!['key']), hashes, kept };
}
/** The kept entries as `deep-physics`'s track. */
export const asTrack = (kept: readonly Kept[]): JsonObject[] => kept.map((k) => ({ step: k.step, kind: k.kind, target: k.target, data: k.data }));
/** Kept entries as text, for messages. */
export const keptText = (kept: readonly Kept[]): string => kept.map((k) => `${k.kind} of ${k.target} at step ${k.step} to ${k.input} from ${k.from}`).join(', ') || 'none';
