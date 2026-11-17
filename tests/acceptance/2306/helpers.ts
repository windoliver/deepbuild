// Test-side tools for the #2306 acceptance tests (README: The surface under test). They extend #251's surface, imported
// read only through ../251/helpers.ts (and through it #522's, #1918's, #2010's, #2009's and #191's): the same
// `deep-physics` binary, built once per file, asked `bake` of world documents (and of a scene's world, #1918's form, for
// a kinematic body that follows a channel) holding #251's car on ground that moves, and run under this suite's two
// planted names; #191's builds for the behavior kit, the test backend and the merge base. #523's reader gives a joint's
// readings. Nothing here stands in for the physics module: every state, reading, hash and result read here is the
// program's own; every expected value is the issue's, or computed here from the issue's numbers.

import { expect } from 'vitest';
import {
  FLICKS, G, HALF, MASS, MATERIALS, PER_STEP, RATE, SETTLED_Y, arr, box, camera, kart, markBox, obj, physics, rotate, sceneDoc,
  show, statesOf, vehicleInputs, world, type JsonObject, type PhysicsPlanted, type State, type V3,
} from '../251/helpers.ts';
import { readingsOf } from '../523/helpers.ts';

export * from '../251/helpers.ts';
export { readingsOf };

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = {
  1: '#2306.9d2f70ed',
  2: '#2306.b6a098d0',
  3: '#2306.f80ef2cc',
  4: '#2306.5f9f29ae',
  5: '#2306.61717c4c',
  6: '#2306.0821d427',
  7: '#2306.174ffd09',
} as const;

// ---------------------------------------------------------------------------------------------------
// deep-physics under this suite's planted names (README: Planted twins)

/**
 * `controller_as_is`: the wrapper leaves the backend's vehicle controller as it is (nothing returned to the body under
 * a wheel, grip reading a kinematic body's speed as nothing). `grip_reads_chassis_only`: each wheel's grip reads the
 * chassis's velocity alone, whatever body it touches.
 */
export type Planted = 'controller_as_is' | 'grip_reads_chassis_only';
/** Runs `calls` through one shipped deep-physics process (#2009's build), under `planted` when given. */
export function ask(calls: JsonObject[], planted?: Planted, where = ''): JsonObject[] {
  return physics(calls, { ...(planted ? { planted: planted as unknown as PhysicsPlanted } : {}), where: where || (planted ?? '') });
}

// ---------------------------------------------------------------------------------------------------
// The fixtures (README: The fixtures): #251's car (`kart`, 1,000 kg, heading +Z, axle X) with sleep off, set down at its
// settled height on whatever lies under it, on #2009's world defaults at 120 Hz and 4 substeps.

/** The kart set down settled at (x, ·, z), heading +Z, on a surface whose top is y = `top`: the slab, the beam or the platform. */
export const kartOn = (top: number, x = 0, z = 0, extra: JsonObject = {}): JsonObject => kart([x, top + SETTLED_Y, z], { sleep: false, ...extra });
/** A quaternion `[x, y, z, w]` turning `deg` about +Y. */
export const aboutY = (deg: number): number[] => [0, Math.sin((deg * Math.PI) / 360), 0, Math.cos((deg * Math.PI) / 360)];
export const ICE: JsonObject = { friction: 0, restitution: 0, density: 1000 };
/** A world holding the kart, its drive, steer and brake inputs, and `parts` (shapes, bodies, joints, outputs). */
export function vehicleWorld(kartBody: JsonObject, parts: { shapes?: JsonObject; bodies?: JsonObject; joints?: JsonObject; outputs?: JsonObject } = {}): JsonObject {
  return world({
    contact_materials: { ...MATERIALS, ice: ICE },
    shapes: { chassis: box(HALF), ...(parts.shapes ?? {}) },
    bodies: { kart: kartBody, ...(parts.bodies ?? {}) },
    inputs: vehicleInputs(),
    ...(parts.joints ? { joints: parts.joints } : {}),
    ...(parts.outputs ? { outputs: parts.outputs } : {}),
  });
}
/** A static floor, the world's shape `floor`, whose top is y = 0, of contact material `material`. */
const floorOf = (material: string): JsonObject => ({ kind: 'static', shapes: [{ shape: 'floor', contact_material: material }], pose: { pos: [0, -0.5, 0] } });
const slabOf = (mass: number, material: string): JsonObject =>
  ({ kind: 'dynamic', shapes: [{ shape: 'slab', contact_material: material }], pose: { pos: [0, 0.1, 0] }, mass, sleep: false });

/** Criterion 1: a dynamic slab of 100 kg, 8 × 0.2 × 6 m (x × y × z), lying on static ground, the kart set down on it. */
export const WEIGHT_SLAB = 100;
export const weightWorld = (): JsonObject => vehicleWorld(kartOn(0.2), {
  shapes: { floor: box([10, 0.5, 10]), slab: box([4, 0.1, 3]) },
  bodies: { ground: floorOf('ground'), slab: slabOf(WEIGHT_SLAB, 'ground') },
});

/**
 * Criterion 2: a level beam of 200 kg, 10 m along z, 3 m wide and 0.2 m thick, its middle hinged to the world at
 * y = 2 m about x (`pivot`, limits ±15°), nothing under it; the kart parked on it heading +Z with its centre 2.5 m from
 * the pivot. Output `tilt` reads the hinge's joint_coordinate.
 */
export const PIVOT_Y = 2;
export const BEAM_HALF = 5;
export const beamWorld = (): JsonObject => vehicleWorld(kartOn(PIVOT_Y + 0.1, 0, 2.5), {
  shapes: { beam: box([1.5, 0.1, BEAM_HALF]) },
  bodies: { beam: { kind: 'dynamic', shapes: [{ shape: 'beam', contact_material: 'ground' }], pose: { pos: [0, PIVOT_Y, 0] }, mass: 200, sleep: false } },
  joints: {
    pivot: {
      kind: 'hinge', a: 'world', b: 'beam', frame_a: { anchor: [0, PIVOT_Y, 0], axis: [1, 0, 0] }, frame_b: { anchor: [0, 0, 0], axis: [1, 0, 0] },
      limits: { min: -15, max: 15 },
    },
  },
  outputs: { tilt: { from: 'pivot', read: 'joint_coordinate' } },
});

/** Criterion 3: a dynamic slab of 1,000 kg, 60 m along z, 0.2 m thick and 6 m wide, on a static floor, both of friction 0. */
export const DRIVE_SLAB = 1000;
export const slabWorld = (): JsonObject => vehicleWorld(kartOn(0.2), {
  shapes: { floor: box([10, 0.5, 40]), slab: box([3, 0.1, 30]) },
  bodies: { ground: floorOf('ice'), slab: slabOf(DRIVE_SLAB, 'ice') },
});

/**
 * Criterion 5: a dynamic disc of 20,000 kg, radius 8 m and 0.2 m thick, hinged to the world about the vertical through
 * its centre (`axle`), whose velocity motor turns it at 30°/s (max torque 400,000 N·m, so it takes about 0.85 s to
 * reach it); nothing under it. The kart parked on it 3 m from the axis, at (3, ·, 0), heading +X, away from the axis.
 */
export const DISC_RATE = 30;
export const DISC_AT = 3;
export const discWorld = (): JsonObject => vehicleWorld(kart([DISC_AT, 0.2 + SETTLED_Y, 0], { sleep: false, pose: { pos: [DISC_AT, 0.2 + SETTLED_Y, 0], rot: aboutY(90) } }), {
  shapes: { disc: { kind: 'cylinder', half_height: 0.1, radius: 8 } },
  bodies: { disc: { kind: 'dynamic', shapes: [{ shape: 'disc', contact_material: 'ground' }], pose: { pos: [0, 0.1, 0] }, mass: 20000, sleep: false } },
  joints: {
    axle: {
      kind: 'hinge', a: 'world', b: 'disc', frame_a: { anchor: [0, 0.1, 0], axis: [0, 1, 0] }, frame_b: { anchor: [0, 0, 0], axis: [0, 1, 0] },
      motor: { mode: 'velocity', target: DISC_RATE, max_torque: 400000, hz: 10, damping_ratio: 1 },
    },
  },
});

// ---------------------------------------------------------------------------------------------------
// Criterion 4's platform: a kinematic body following the channel `deck` of a scene (#1918's form), so a bake names
// the scene and its world `ride`. The platform is 20 × 0.2 × 20 m, its top at y = 0.2, nothing under it.

export const DECK_Y = 0.1;
const STEP_FLICKS = FLICKS / RATE;
/** A path as `[step, position]` points, linear between them, held after the last. */
export type Path = [number, V3][];
/** From rest to 2 m/s along `axis` (0: x, the car's axle; 2: z, its heading) over 1 s, then 2 m/s for 2 s: 5 m in all; a key at every step of the first second (t² m there) and one at 3 s. */
export function ramp(axis: 0 | 2): Path {
  const at = (s: number): V3 => { const p: V3 = [0, DECK_Y, 0]; p[axis] = s; return p; };
  const path: Path = [];
  for (let k = 0; k <= RATE; k++) path.push([k, at((k / RATE) ** 2)]);
  path.push([3 * RATE, at(5)]);
  return path;
}
/** 2 m/s along x from the start: 6 m in 3 s. */
export const steady = (): Path => [[0, [0, DECK_Y, 0]], [3 * RATE, [6, DECK_Y, 0]]];
/** The scene holding the world `ride`: the kart set down on the platform, which follows the channel `deck` along `path`. */
export function rideScene(path: Path, kartExtra: JsonObject = {}): JsonObject {
  const keys = Object.fromEntries(path.map(([k, v], i) => [`k${String(i).padStart(3, '0')}`, { t: k * STEP_FLICKS, value: v, interp: 'linear' }]));
  const ride = vehicleWorld(kartOn(2 * DECK_Y, 0, 0, kartExtra), {
    shapes: { deck: box([10, DECK_Y, 10]) },
    bodies: { platform: { kind: 'kinematic', shapes: [{ shape: 'deck', contact_material: 'ground' }], pose: { pos: [0, DECK_Y, 0] }, follow: 'items/platform/at/pos' } },
  });
  return sceneDoc('A car on a moving platform', '4s', { cam: camera([0, 12, 24], [0, 0, 0]), platform: markBox([20, 2 * DECK_Y, 20], [0, DECK_Y, 0]) }, {
    channels: { deck: { target: 'items/platform/at/pos', type: 'vec3', keys } },
    worlds: { ride },
  });
}

// ---------------------------------------------------------------------------------------------------
// Calls and readings

/** A bake sampled once a step, reading `read`'s states and every output. */
export const bakeOf = (w: JsonObject, steps: number, track: JsonObject[], read: string[]): JsonObject =>
  ({ call: 'bake', world: w, track, steps, frame_rate: PER_STEP, read });
/** A bake of the scene's world `ride`, sampled once a step. */
export const rideBake = (scene: JsonObject, steps: number, track: JsonObject[]): JsonObject =>
  ({ call: 'bake', scene, world: 'ride', track, steps, frame_rate: PER_STEP, read: ['kart', 'platform'] });

/** Body `id`'s states in a bake of `steps` steps, index k the state after step k. */
export function bodyOf(reply: JsonObject | undefined, id: string, steps: number, what: string): State[] {
  expect(reply?.['ok'], `${what} is baked, not refused: ${show(reply)}`).toBe(true);
  return statesOf(reply!, id, steps + 1, what);
}
/** The bake's step hashes, as the program wrote them. */
export function hashesIn(reply: JsonObject | undefined, what: string): string[] {
  expect(reply?.['ok'], `${what} is baked, not refused: ${show(reply)}`).toBe(true);
  return arr(obj(reply, what)['step_hashes'], `${what}: step_hashes`).map((h) => String(h));
}

/** The horizontal (x, z) distance between two points. */
export const flat = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0]! - b[0]!, a[2]! - b[2]!);
/** A body's angle about +Y, deg: of its position around the axis (`atan2(−z, x)`), so a turn about +Y adds to it. */
export const around = (p: readonly number[]): number => (Math.atan2(-p[2]!, p[0]!) * 180) / Math.PI;
/** A body's own turn about +Y, deg: where its local +X points, measured as `around` measures a position. */
export const turnOf = (s: State): number => around(rotate(s.rot, [1, 0, 0]));
/** Angles unwrapped step to step: each step's change taken within (−180°, 180°], summed from the first. */
export function unwrapped(angles: readonly number[]): number[] {
  const out = [0];
  for (let k = 1; k < angles.length; k++) {
    let d = angles[k]! - angles[k - 1]!;
    while (d > 180) d -= 360;
    while (d <= -180) d += 360;
    out.push(out[k - 1]! + d);
  }
  return out;
}

/** The load (1,000 + 100) × 9.81 N criterion 1 names, and the slab's own weight its planted wrapper reads. */
export const LOAD = (MASS + WEIGHT_SLAB) * G;
export const SLAB_WEIGHT = WEIGHT_SLAB * G;
