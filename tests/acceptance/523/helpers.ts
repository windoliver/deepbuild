// Test-side tools for the #523 acceptance tests (README: The surface under test). They extend #2009's, #2010's and
// #1918's surface: the same `deep-physics` binary, built once per file through ../2009/helpers.ts (imported read only,
// through ../2010/helpers.ts), asked `bake`, `restore` and `check` with this suite's fields (joint readings sampled
// at 120 per second, crossing levels, faults, breaks, jams, the gear and pulley joints and the mass-ratio issue), and
// started with this suite's planted names. Nothing here stands in for the physics module: every reading, row, hash and
// issue read here is the program's own; every expected value comes from the issue's text, or from the fixtures'
// statics worked out here (README: The fixtures).

import { spawnSync } from 'node:child_process';
import { expect } from 'vitest';
import {
  G, REPO, TIMEOUT, arr, box, isObject, num, obj, physicsBin, show, sphere, world, type JsonObject, type JsonValue,
} from '../2010/helpers.ts';

export * from '../2010/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = {
  1: '#523.b6499735',
  2: '#523.93bf83d7',
  3: '#523.959eb1ca',
  4: '#523.188f7266',
  5: '#523.46a838d3',
  6: '#523.c74d0c1b',
  7: '#523.84b7ab39',
} as const;

const MIB = 1024 * 1024;

// ---------------------------------------------------------------------------------------------------
// Time (Time and the flick): 705,600,000 flicks a second; a 120 Hz step is 5,880,000. Readings are sampled at
// `frame_rate: "120/1"`, so frame k is the state after step k (Physics output: k = ⌊t ÷ step⌋, α = 0 at every frame).

export const FLICKS = 705_600_000;
export const RATE = 120;
export const STEP = FLICKS / RATE;
export const PER_STEP = '120/1';
export const stepAt = (seconds: number): number => Math.round(seconds * RATE);

// ---------------------------------------------------------------------------------------------------
// `deep-physics` (#2009's JSON lines), the checkout's build or one of this suite's planted wrong programs.

/** `deep-physics --planted <name>` (README: Planted twins). */
export type Planted =
  | 'hinge_coordinate_wraps'
  | 'checkpoint_drops_turns'
  | 'speed_cap_silent'
  | 'joint_force_per_step'
  | 'solve_cap_reports_success'
  | 'mass_ratio_declared_only';

/** Runs `calls` through one deep-physics process: exit 0, one JSON reply per call, in order. */
export function physics(calls: JsonObject[], planted?: Planted, where = ''): JsonObject[] {
  const args = planted ? ['--planted', planted] : [];
  const what = `deep-physics${args.length ? ` ${args.join(' ')}` : ''}${where ? ` (${where})` : ''}`;
  const run = spawnSync(physicsBin(), args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 4096 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished in time`).toBe('');
  if (run.error && code !== 'EPIPE') throw Error(`${what}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(run.status, `${what} exits 0; stdout: ${stdout.slice(0, 1000)}; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call`).toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 120)})`));
}

/** A bake of a world document, its joint readings sampled once a step, no body states. */
export const bakeSteps = (w: JsonObject, steps: number, extra: JsonObject = {}): JsonObject => ({ call: 'bake', world: w, steps, frame_rate: PER_STEP, read: [], ...extra });
/** A bake of world `id` of a scene (#1918's form), its readings sampled once a step. */
export const bakeScene = (scene: JsonObject, id: string, steps: number): JsonObject => ({ call: 'bake', scene, world: id, steps, frame_rate: PER_STEP, read: [] });

/** The reply is a bake (or a check) that ran: `ok: true`. */
export function baked(reply: JsonObject | undefined, what: string): JsonObject {
  expect(reply?.['ok'], `${what} is baked, not refused: ${show(reply)}`).toBe(true);
  return reply!;
}

// ---------------------------------------------------------------------------------------------------
// Readings (README: Readings): `outputs.series.<output ID>`, one sample per frame.

/** One sample of a joint reading: its value (deg for joint_coordinate, N for joint_force's force) and, where the sample carries one, joint_force's torque (N·m). */
export interface Sample { value: number; torque: number | null }
function sample(v: JsonValue | undefined, what: string): Sample {
  if (typeof v === 'number') return { value: num(v, what), torque: null };
  if (Array.isArray(v) && v.length === 1) return { value: num(v[0], `${what}[0]`), torque: null };
  expect(isObject(v) && typeof v['force'] === 'number', `${what} is a number, [number] or {force: N, torque: N·m}, got ${show(v)}`).toBe(true);
  const o = v as JsonObject;
  return { value: num(o['force'], `${what}.force`), torque: o['torque'] === undefined ? null : num(o['torque'], `${what}.torque`) };
}
/** Output `id`'s samples in a bake sampled at 120/1: `count` of them, index k the reading after step k. */
export function readingsOf(reply: JsonObject, id: string, count: number, what: string): Sample[] {
  const o = obj(baked(reply, what)['outputs'], `${what}: outputs`);
  const series = arr(obj(o['series'], `${what}: outputs.series`)[id], `${what}: outputs.series.${id} (the output's reading at each frame)`);
  expect(series.length, `${what}: outputs.series.${id} holds ${count} samples (step 0, then one per step at 120/1)`).toBe(count);
  return series.map((v, k) => sample(v, `${what}: outputs.series.${id}[${k}]`));
}
/** Output `id`'s positions (a body's `position` read), index k after step k. */
export function positionsOf(reply: JsonObject, id: string, count: number, what: string): number[][] {
  const o = obj(baked(reply, what)['outputs'], `${what}: outputs`);
  const series = arr(obj(o['series'], `${what}: outputs.series`)[id], `${what}: outputs.series.${id}`);
  expect(series.length, `${what}: outputs.series.${id} holds ${count} positions`).toBe(count);
  return series.map((v, k) => {
    const a = arr(v, `${what}: outputs.series.${id}[${k}]`);
    expect(a.length, `${what}: outputs.series.${id}[${k}] is a position, 3 numbers`).toBe(3);
    return a.map((x, i) => num(x, `${what}: outputs.series.${id}[${k}][${i}]`));
  });
}

// ---------------------------------------------------------------------------------------------------
// Occurrence lists (#1918's Row, README: Rows this suite reads)

export interface Row { step: number; kind: string; a: string | null; raw: JsonObject }
/** A bake's occurrence list, row by row. Kinds aren't held to #1918's twelve: a jam may be its own kind. */
export function rowsOf(reply: JsonObject, what: string): Row[] {
  return arr(baked(reply, what)['occurrences'], `${what}: occurrences`).map((v, i) => {
    const o = obj(v, `${what}: occurrences[${i}]`);
    expect(Number.isSafeInteger(o['step']), `${what}: occurrences[${i}].step is a step, got ${show(o['step'])}`).toBe(true);
    expect(typeof o['kind'], `${what}: occurrences[${i}].kind is a kind's name, got ${show(o['kind'])}`).toBe('string');
    return { step: o['step'] as number, kind: o['kind'] as string, a: typeof o['a'] === 'string' ? o['a'] : null, raw: o };
  });
}
export const rowText = (r: Row): string => show(r.raw).slice(0, 300);
/** The row names `id`: as `a`, `b`, or a `joint` field. */
export const names = (r: Row, id: string): boolean => r.a === id || r.raw['b'] === id || r.raw['joint'] === id;
/**
 * A `fault {kind: <name>}` row: the row's own `kind` is `fault`, so the fault's kind sits in another field, which this
 * suite doesn't pin: any field but `kind`, `a` and `b` whose value is `<name>`, or is an object whose `kind` is.
 */
export function isFault(r: Row, name: string): boolean {
  return r.kind === 'fault' && Object.entries(r.raw).some(([k, v]) => !['kind', 'a', 'b'].includes(k) && (v === name || (isObject(v) && v['kind'] === name)));
}
/** A jam: a row of kind `jam`, or a fault whose kind is `jam`. */
export const isJam = (r: Row): boolean => r.kind === 'jam' || isFault(r, 'jam');
export const isBreak = (r: Row): boolean => r.kind === 'break';

// ---------------------------------------------------------------------------------------------------
// Fixtures (README: The fixtures). Fields are the issue's and #2009's; the shapes the base has no field for are named
// as the issue and the design name them.

/** The flywheel's level (criterion 1): 90°, crossed once at 0.25 s at 360 deg/s. */
export const LEVEL = 90;
/**
 * The flywheel (criteria 1 and 2): a balanced 10 kg cylinder, 0.5 m in radius, on the hinge `axle` to the world about
 * +y through its centre, started at `degPerS` about +y, with no motor and no damping; checkpoints every 70 steps, so
 * a seek to step 300 restores step 280 and steps 20 more. With `reading`, the output `spin` reads the hinge's
 * joint_coordinate and watches the level 90°.
 */
export function flywheel(degPerS: number, reading: boolean): JsonObject {
  return world({
    checkpoint: { every: 70 },
    shapes: { wheel: { kind: 'cylinder', half_height: 0.05, radius: 0.5 } },
    bodies: { flywheel: { kind: 'dynamic', shapes: [{ shape: 'wheel' }], pose: { pos: [0, 0, 0] }, mass: 10, velocity: { angular: [0, degPerS, 0] }, sleep: false } },
    joints: { axle: { kind: 'hinge', a: 'world', b: 'flywheel', frame_a: { anchor: [0, 0, 0], axis: [0, 1, 0] }, frame_b: { anchor: [0, 0, 0], axis: [0, 1, 0] } } },
    ...(reading ? { outputs: { spin: { from: 'axle', read: 'joint_coordinate', crossings: [LEVEL] } } } : {}),
  });
}

/** Criterion 3's arm: a 1 m bar of 100 ÷ g kg, so its weight is 100 N and 50 N·m about the hinge at its end. */
export const ARM_MASS = 100 / G;
export const ARM_WEIGHT = 100;
export const ARM_TORQUE = 50;
/** Criterion 3's threshold, and the over_steps criteria 3 and 4 use. */
export const BREAK_TORQUE = 20;
export const OVER_STEPS = 6;
/** The wall's contact on the pressed arm is 0.8 m from the hinge, so the motor's 50 N·m presses 62.5 N there and the pin holds 62.5 N. */
export const WALL_LEVER = 0.8;
export const PIN_FORCE = ARM_TORQUE / WALL_LEVER;
const elbow = (limits: [number, number], extra: JsonObject = {}): JsonObject => ({
  kind: 'hinge', a: 'world', b: 'arm', frame_a: { anchor: [0, 0, 0], axis: [0, 0, 1] }, frame_b: { anchor: [-0.5, 0, 0], axis: [0, 0, 1] },
  limits: { min: limits[0], max: limits[1] }, breaks_at: { torque: BREAK_TORQUE, over_steps: OVER_STEPS }, ...extra,
});
/**
 * Criterion 3, held: no gravity; the arm along +x from the hinge `elbow` (about +z, limits ±90°, far from where it
 * stands), whose velocity motor (target 90 deg/s, max_torque 50 N·m, 10 Hz) presses it up against `wall`, a static
 * 5 cm ball touching its top face 0.8 m from the hinge. Output `load` reads the hinge's joint_force.
 */
export function pressedArm(): JsonObject {
  return world({
    gravity: [0, 0, 0],
    shapes: { bar: box([0.5, 0.05, 0.05]), stop: sphere(0.05) },
    bodies: {
      arm: { kind: 'dynamic', shapes: [{ shape: 'bar' }], pose: { pos: [0.5, 0, 0] }, mass: ARM_MASS, sleep: false },
      wall: { kind: 'static', shapes: [{ shape: 'stop' }], pose: { pos: [WALL_LEVER, 0.1, 0] } },
    },
    joints: { elbow: elbow([-90, 90], { motor: { mode: 'velocity', target: 90, max_torque: ARM_TORQUE, hz: 10, damping_ratio: 1 } }) },
    outputs: { load: { from: 'elbow', read: 'joint_force' } },
  });
}
/** Criterion 3, broken: the same arm and hinge under gravity, no motor, resting level on its lower limit (limits 0° to 90°). */
export function restingArm(): JsonObject {
  return world({
    shapes: { bar: box([0.5, 0.05, 0.05]) },
    bodies: { arm: { kind: 'dynamic', shapes: [{ shape: 'bar' }], pose: { pos: [0.5, 0, 0] }, mass: ARM_MASS, sleep: false } },
    joints: { elbow: elbow([0, 90]) },
    outputs: { load: { from: 'elbow', read: 'joint_force' } },
  });
}

/** Criterion 4: a 2 kg body's weight, m·g. */
export const BOB_WEIGHT = 2 * G;
export const BREAK_FORCE = 15;
/**
 * Criterion 4's hanging body: a 2 kg, 0.1 m ball hanging still from the world by the fixed joint `hook` at its top, at
 * `substeps`; with `breaks`, the hook's breaks_at is force 15 N over 6 steps. Output `load` reads its joint_force.
 */
export function hanging(substeps: number, breaks: boolean): JsonObject {
  return world({
    substeps,
    shapes: { bob: sphere(0.1) },
    bodies: { bob: { kind: 'dynamic', shapes: [{ shape: 'bob' }], pose: { pos: [0, 1, 0] }, mass: 2, sleep: false } },
    joints: { hook: { kind: 'fixed', a: 'world', b: 'bob', frame_a: { anchor: [0, 1.1, 0] }, frame_b: { anchor: [0, 0.1, 0] }, ...(breaks ? { breaks_at: { force: BREAK_FORCE, over_steps: OVER_STEPS } } : {}) } },
    outputs: { load: { from: 'hook', read: 'joint_force' } },
  });
}

/** Criterion 5: the backend's caps at 120 Hz, 45° a step and 400 m/s. */
export const ANGULAR_CAP = 5400;
export const LINEAR_CAP = 400;
/** Criterion 5's disc: a 1 kg disc, 0.2 m in radius, on the hinge `axle` about +y, launched at 7,200 deg/s (60° a step); output `turn` reads the hinge's joint_coordinate. */
export function disc(): JsonObject {
  return world({
    shapes: { plate: { kind: 'cylinder', half_height: 0.02, radius: 0.2 } },
    bodies: { disc: { kind: 'dynamic', shapes: [{ shape: 'plate' }], pose: { pos: [0, 0, 0] }, mass: 1, velocity: { angular: [0, 7200, 0] }, sleep: false } },
    joints: { axle: { kind: 'hinge', a: 'world', b: 'disc', frame_a: { anchor: [0, 0, 0], axis: [0, 1, 0] }, frame_b: { anchor: [0, 0, 0], axis: [0, 1, 0] } } },
    outputs: { turn: { from: 'axle', read: 'joint_coordinate' } },
  });
}
/** Criterion 5's shot: a free 1 kg ball with no gravity, launched at 500 m/s along +x. */
export function shot(): JsonObject {
  return world({
    gravity: [0, 0, 0],
    shapes: { ball: sphere(0.05) },
    bodies: { shot: { kind: 'dynamic', shapes: [{ shape: 'ball' }], pose: { pos: [0, 0, 0] }, mass: 1, velocity: { linear: [500, 0, 0] }, sleep: false } },
  });
}

/** Criterion 6: each pulley weight hangs 2 m under its ground point, so the two lengths' sum is 4 m. */
export const GROUND_A = [-1, 2, 0];
export const GROUND_B = [1, 2, 0];
export const ROPE = 4;
/** The arm's joints, any of which a jam may name. */
export const ARM_JOINTS = ['shoulder', 'elbow', 'grip', 'reach'];
const SIN60 = Math.sqrt(3) / 2;
const kinematic = (parts: JsonObject): JsonObject => world({ mode: 'kinematic', gravity: [0, 0, 0], ...parts });
const hinge = (a: string, b: string, at: number[]): JsonObject => ({ kind: 'hinge', a, b, frame_a: { anchor: at, axis: [0, 0, 1] }, frame_b: { anchor: [0, 0, 0], axis: [0, 0, 1] } });
const slider = (b: string, at: number[], axis: number[]): JsonObject => ({ kind: 'slider', a: 'world', b, frame_a: { anchor: at, axis }, frame_b: { anchor: [0, 0, 0], axis } });
const mark = (id: string, order: string, pos: number[]): JsonObject => ({ id, kind: 'mark.box@1', name: id, order, params: { size: [0.1, 0.1, 0.1] }, at: { pos } });
const linear = (from: number, to: number, at: string): JsonObject => ({ k0: { t: '0s', value: from, interp: 'linear' }, k1: { t: at, value: to, interp: 'hold' } });
/**
 * Criterion 6's scene (#1918's form): three kinematic worlds whose solves read its channels at each step's time.
 * - `gears`: cogs on the hinges `drive` (at x = −1) and `driven` (at x = 1), both about +z, coupled by the gear `mesh`
 *   of ratio 2; the solve drives `drive` from `crank`, 0° rising 90°/s. Outputs `turn_in`, `turn_out`: their joint_coordinate.
 * - `pulley`: weights `left` and `right` on vertical sliders under (−1, 2, 0) and (1, 2, 0), 2 m below each, joined by
 *   the pulley `rope` of ratio 1; the solve lowers `left` from `lower`, 0 m to −0.5 m over 2 s. Outputs `left_at`, `right_at`: positions.
 * - `arm`: links `upper` and `fore`, 1 m each, on `shoulder` (to the world at the origin) and `elbow`, the tip of `fore`
 *   held by `grip` to `hand`, which the slider `reach` moves along +x; the solve sets `reach` from `reach`, 1 m rising
 *   0.5 m/s, so the arm is straight at 2 s and can't follow after.
 */
export function machines(): JsonObject {
  return {
    format: 1,
    id: '01JB0523KS0000000000000001',
    profile: 'scene',
    title: 'Kinematic machines',
    description: 'Issue #523 criterion 6: a gear, a pulley and a two-link arm in kinematic worlds, each driven by a channel.',
    size: [640, 360],
    camera: 'cam',
    transport: { span: '3s', frame_rate: [60, 1] },
    requires: { modules: { scene3d: '^1' } },
    items: {
      cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', position: [0, 2, 10], target: [0, 0, 0], fov: 40 } },
      crank: mark('crank', 'a1', [0, 0, 5]),
      lower: mark('lower', 'a2', [0, 0, -5]),
      reach: mark('reach', 'a3', [1, 0, 6]),
    },
    channels: {
      crank: { target: 'items/crank/at/pos/0', type: 'f32', keys: linear(0, 360, '4s') },
      lower: { target: 'items/lower/at/pos/0', type: 'f32', keys: linear(0, -0.5, '2s') },
      reach: { target: 'items/reach/at/pos/0', type: 'f32', keys: linear(1, 3, '4s') },
    },
    worlds: {
      gears: kinematic({
        shapes: { cog: box([0.3, 0.3, 0.05]) },
        bodies: {
          cog_in: { kind: 'dynamic', shapes: [{ shape: 'cog' }], pose: { pos: [-1, 0, 0] }, mass: 1 },
          cog_out: { kind: 'dynamic', shapes: [{ shape: 'cog' }], pose: { pos: [1, 0, 0] }, mass: 1 },
        },
        joints: { drive: hinge('world', 'cog_in', [-1, 0, 0]), driven: hinge('world', 'cog_out', [1, 0, 0]), mesh: { kind: 'gear', a: 'cog_in', b: 'cog_out', of: ['drive', 'driven'], ratio: 2 } },
        solve: { drivers: [{ joint: 'drive', channel: 'items/crank/at/pos/0' }], iterations: 20, tolerance: 1e-5 },
        outputs: { turn_in: { from: 'drive', read: 'joint_coordinate' }, turn_out: { from: 'driven', read: 'joint_coordinate' } },
      }),
      pulley: kinematic({
        shapes: { weight: box([0.1, 0.1, 0.1]) },
        bodies: {
          left: { kind: 'dynamic', shapes: [{ shape: 'weight' }], pose: { pos: [-1, 0, 0] }, mass: 1 },
          right: { kind: 'dynamic', shapes: [{ shape: 'weight' }], pose: { pos: [1, 0, 0] }, mass: 1 },
        },
        joints: {
          left_rail: slider('left', [-1, 0, 0], [0, 1, 0]),
          right_rail: slider('right', [1, 0, 0], [0, 1, 0]),
          rope: { kind: 'pulley', a: 'left', b: 'right', ratio: 1, pulley: { ground_a: GROUND_A, ground_b: GROUND_B, length_min: 0.5, length_max: 3.5 } },
        },
        solve: { drivers: [{ joint: 'left_rail', channel: 'items/lower/at/pos/0' }], iterations: 20, tolerance: 1e-5 },
        outputs: { left_at: { from: 'left', read: 'position' }, right_at: { from: 'right', read: 'position' } },
      }),
      arm: kinematic({
        shapes: { link: box([0.5, 0.03, 0.03]), palm: box([0.05, 0.05, 0.05]) },
        bodies: {
          upper: { kind: 'dynamic', shapes: [{ shape: 'link', offset: { pos: [0.5, 0, 0] } }], pose: { pos: [0, 0, 0], rot: [0, 0, 60] }, mass: 1 },
          fore: { kind: 'dynamic', shapes: [{ shape: 'link', offset: { pos: [0.5, 0, 0] } }], pose: { pos: [0.5, SIN60, 0], rot: [0, 0, -60] }, mass: 1 },
          hand: { kind: 'dynamic', shapes: [{ shape: 'palm' }], pose: { pos: [1, 0, 0] }, mass: 1 },
        },
        joints: {
          shoulder: hinge('world', 'upper', [0, 0, 0]),
          elbow: hinge('upper', 'fore', [1, 0, 0]),
          grip: hinge('fore', 'hand', [1, 0, 0]),
          reach: slider('hand', [0, 0, 0], [1, 0, 0]),
        },
        solve: { drivers: [{ joint: 'reach', channel: 'items/reach/at/pos/0' }], iterations: 20, tolerance: 1e-5 },
      }),
    },
  };
}

/** Criterion 7's torso mass and the hand's derived one: 0.1 × 0.1 × 0.02 m at 1,000 kg/m³. */
export const TORSO_MASS = 40;
export const HAND_MASS = 0.1 * 0.1 * 0.02 * 1000;
/**
 * Criterion 7: the torso (declared 40 kg; at the shared material's density it would be 36 kg) and the hand box
 * 0.1 × 0.1 × 0.02 m, its mass declared when `handMass` is given, else density × volume, joined by the hinge `wrist`.
 */
export function wrist(handMass?: number): JsonObject {
  return world({
    contact_materials: { skin: { friction: 0.5, restitution: 0, density: 1000 } },
    shapes: { palm: box([0.05, 0.05, 0.01]), chest: box([0.15, 0.3, 0.1]) },
    bodies: {
      torso: { kind: 'dynamic', shapes: [{ shape: 'chest', contact_material: 'skin' }], pose: { pos: [0, 1, 0] }, mass: TORSO_MASS },
      hand: { kind: 'dynamic', shapes: [{ shape: 'palm', contact_material: 'skin' }], pose: { pos: [0, 0.65, 0] }, ...(handMass === undefined ? {} : { mass: handMass }) },
    },
    joints: { wrist: { kind: 'hinge', a: 'torso', b: 'hand', frame_a: { anchor: [0, -0.3, 0], axis: [1, 0, 0] }, frame_b: { anchor: [0, 0.05, 0], axis: [1, 0, 0] } } },
  });
}

// ---------------------------------------------------------------------------------------------------
// Judging

/** Within `tol` of `want`, relative. */
export const near = (x: number, want: number, tol: number): boolean => Math.abs(x - want) <= Math.abs(want) * tol;
export const fmt = (x: number): string => (Number.isFinite(x) ? Number(x.toPrecision(7)).toString() : String(x));
/** Steps from `from` to `to` that fail `ok`, listed up to eight. */
export function stepFailures(from: number, to: number, ok: (k: number) => boolean, say: (k: number) => string): string[] {
  const bad: number[] = [];
  for (let k = from; k <= to; k++) if (!ok(k)) bad.push(k);
  return bad.length ? [`${bad.length} of steps ${from} to ${to}: ${bad.slice(0, 8).map(say).join('; ')}${bad.length > 8 ? '; …' : ''}`] : [];
}
