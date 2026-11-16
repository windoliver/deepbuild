// Test-side tools for the #251 acceptance tests (README: The surface under test). They extend #2009's, #2010's,
// #1918's and #522's surface, imported read only through ../522/helpers.ts (and through it ../1918, ../2010 and
// ../2009): the same `deep-physics` binary, built once per file, asked `check`, `bake`, `restore`, `golden` and
// `golden_verify` of world documents holding a vehicle body, with this suite's fields (a vehicle body's `vehicle`, the
// inputs drive, steer, brake and place, outputs on a wheel's address `<body>#<wheel>`, a bake's `vehicles`), and run
// under this suite's planted names. #191's builds and runner (../191/helpers.ts) give the test-backends build, the
// release build, the merge base's build and the reference-Mac gate; #2012's (../2012/helpers.ts) the Linux x86_64
// leg; #138's (../138/helpers.ts) the conformance kit's report; #2009's api.ts the public-API scan. Nothing here stands
// in for the physics module: every state, pose, row, hash, issue, result and verdict read here is the program's own;
// every expected value is the issue's, or computed here from the issue's formulas.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  G, TARGET, arr, box, cargoError, num, obj, physics, show, statesOf, vec, world,
  type JsonObject, type JsonValue, type PhysicsPlanted, type Row, type State,
} from '../522/helpers.ts';
import {
  physics as onBuild, type PhysicsBuild, type Planted as Planted191, type TestBackend as Backend191,
} from '../191/helpers.ts';
import type { Doc } from '../2009/api.ts';

export * from '../522/helpers.ts';
export { CONTAINER_TIMEOUT, LINUX_X86, matchFailures, onLane, referenceMac } from '../2012/helpers.ts';
export {
  backendOf, fixturesOf, gate, judgeRuns, kitReport, median, mergeBase, mergeBasePhysics, prebuild as prebuildBuilds, settle,
  type KitReport, type KitResult,
} from '../191/helpers.ts';
export { failuresIn, kit, moduleOf, partIn } from '../138/helpers.ts';
export { leaks } from '../2009/api.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = {
  1: '#251.1571a36a',
  2: '#251.acf8ab9a',
  3: '#251.d72490eb',
  4: '#251.0d1641fc',
  5: '#251.eadd341f',
  6: '#251.2e102906',
  7: '#251.9fb00bb4',
  8: '#251.25f1d712',
  9: '#251.a96ef62b',
  10: '#251.74b37407',
} as const;

// ---------------------------------------------------------------------------------------------------
// deep-physics under this suite's planted names (README: Planted twins), or a test backend in the test-backends build.

export type Planted =
  | 'spring_on_whole_mass' | 'brake_whole_force_each_wheel' | 'steer_clamps_angle' | 'steer_parallel'
  | 'contact_names_body_only' | 'checkpoint_drops_steer' | 'check_counts_wheels_only' | 'kit_counts_excluded_passed'
  | 'place_keeps_spin_rate' | 'place_keeps_angular_velocity';
/** `deep-physics --backend no_vehicle_controller`: Rapier with `vehicle_controller` left out of its caps() (README). */
export type TestBackend = 'no_vehicle_controller';
export const VEHICLE_CAP = 'vehicle_controller';

/** Runs `calls` through one shipped deep-physics process (#2009's build), under `planted` when given. */
export function ask(calls: JsonObject[], planted?: Planted, where = ''): JsonObject[] {
  return physics(calls, { ...(planted ? { planted: planted as unknown as PhysicsPlanted } : {}), where: where || (planted ?? '') });
}
/** Runs `calls` through #191's builds: `--backend` (the test-backends build) and `--planted` as given. */
export function onTest(calls: JsonObject[], o: { backend?: TestBackend; planted?: Planted; build?: PhysicsBuild } = {}): JsonObject[] {
  return onBuild(calls, {
    ...(o.backend ? { backend: o.backend as unknown as Backend191 } : {}),
    ...(o.planted ? { planted: o.planted as unknown as Planted191 } : {}),
    build: o.build ?? (o.backend ? 'test' : 'shipped'),
  });
}

// ---------------------------------------------------------------------------------------------------
// Time: 120 Hz, 4 substeps. A bake sampled at `frame_rate: "120/1"` holds frame k as the state after step k.

export const RATE = 120;
export const DT = 1 / RATE;
export const PER_STEP = '120/1';
export const stepAt = (seconds: number): number => Math.round(seconds * RATE);

// ---------------------------------------------------------------------------------------------------
// The car the issue describes (README: The car): 1,000 kg on four wheels at the corners of a 2.5 m wheelbase and a
// 1.6 m track, centred under its centre of mass; springs of 2 Hz, damping ratio 0.3, rest 0.3 m, travel 0.2 m; front
// wheels steering, rear wheels driving, all braking (the default). Heading +Z, axle X, up +Y: left is +X.

export type V3 = [number, number, number];
export type WheelName = 'fl' | 'fr' | 'rl' | 'rr';
export const WHEEL_NAMES: WheelName[] = ['fl', 'fr', 'rl', 'rr'];
export const FRONT: WheelName[] = ['fl', 'fr'];
export const REAR: WheelName[] = ['rl', 'rr'];
export const MASS = 1000;
export const WHEELBASE = 2.5;
export const TRACK = 1.6;
export const RADIUS = 0.3;
export const REST = 0.3;
export const TRAVEL = 0.2;
export const HZ = 2;
export const DAMPING_RATIO = 0.3;
/** The chassis box's half extents; its centre is the body's origin and its centre of mass. */
export const HALF: V3 = [0.8, 0.15, 1.5];
/** Each wheel's mount `at` (local): the chassis's bottom corners, the wheelbase and track centred on the centre of mass. */
export const AT: Record<WheelName, V3> = {
  fl: [TRACK / 2, -HALF[1], WHEELBASE / 2],
  fr: [-TRACK / 2, -HALF[1], WHEELBASE / 2],
  rl: [TRACK / 2, -HALF[1], -WHEELBASE / 2],
  rr: [-TRACK / 2, -HALF[1], -WHEELBASE / 2],
};
/** The chassis centre's height over level ground at y = 0 with every spring at rest length: each ray, rest + radius long, just reaching it. */
export const REST_Y = HALF[1] + REST + RADIUS;
/** The issue's sag, g ÷ (2π × 2)², as printed, and its 2%. */
export const SAG = 0.0621;
export const SAG_TOLERANCE = 0.02;
/** The chassis centre's height once settled: each spring the exact sag shorter. */
export const SETTLED_Y = REST_Y - G / (2 * Math.PI * HZ) ** 2;

export const wheel = (name: WheelName, extra: JsonObject = {}): JsonObject => ({
  at: AT[name], radius: RADIUS, suspension: { rest: REST, travel: TRAVEL, hz: HZ, damping_ratio: DAMPING_RATIO },
  ...(FRONT.includes(name) ? { steers: true } : { drives: true }), ...extra,
});
/** The `vehicle` field: the four wheels, `steer_max` 35° (the default, written out). */
export const vehicleField = (extraWheels: JsonObject = {}): JsonObject => ({
  wheels: { ...Object.fromEntries(WHEEL_NAMES.map((n) => [n, wheel(n)])), ...extraWheels }, steer_max: 35,
});
/** The vehicle body `kart` at `pos`, heading +Z unless `rot` (deg about X, Y, Z) is given. */
export function kart(pos: V3, extra: JsonObject = {}): JsonObject {
  return { kind: 'vehicle', shapes: [{ shape: 'chassis', contact_material: 'shell' }], pose: { pos }, mass: MASS, vehicle: vehicleField(), ...extra };
}
/** The world's inputs: the vehicle's three, and with `reset` place and launch. `on` derives them from a logic item. */
export function vehicleInputs(o: { on?: JsonObject; reset?: boolean } = {}): JsonObject {
  const input = (kind: string, on?: JsonObject): JsonObject => ({ kind, targets: ['kart'], ...(on ? { on } : {}) });
  return {
    drive: input('drive', o.on), steer: input('steer', o.on), brake: input('brake', o.on),
    ...(o.reset ? { place: input('place'), launch: input('launch') } : {}),
  };
}
/** Outputs on each wheel's address: `wheel_<name>` reads its pose and, with `contacts`, `contact_<name>` its contact count. */
export function wheelOutputs(contacts = false): JsonObject {
  const out: JsonObject = {};
  for (const n of WHEEL_NAMES) {
    out[`wheel_${n}`] = { from: `kart#${n}`, read: 'pose' };
    if (contacts) out[`contact_${n}`] = { from: `kart#${n}`, read: 'contact_count' };
  }
  return out;
}
export const MATERIALS: JsonObject = {
  ground: { friction: 0.8, restitution: 0, density: 1000 },
  shell: { friction: 0.3, restitution: 0, density: 100 },
};
export const GROUND_HALF = 100;
/** A static level floor whose top is y = 0. */
export const ground = (): JsonObject => ({ kind: 'static', shapes: [{ shape: 'ground', contact_material: 'ground' }], pose: { pos: [0, -0.5, 0] } });
/** A world on level ground holding `kartBody` and `bodies`, with the vehicle's inputs and its wheels' outputs. */
export function carWorld(kartBody: JsonObject, parts: JsonObject = {}, o: { contacts?: boolean; bodies?: JsonObject; shapes?: JsonObject } = {}): JsonObject {
  return world({
    contact_materials: MATERIALS,
    shapes: { ground: box([GROUND_HALF, 0.5, GROUND_HALF]), chassis: box(HALF), ...(o.shapes ?? {}) },
    bodies: { ground: ground(), kart: kartBody, ...(o.bodies ?? {}) },
    inputs: vehicleInputs(),
    outputs: wheelOutputs(o.contacts ?? false),
    checkpoint: { every: 60 },
    ...parts,
  });
}

// Track entries (Input track entries: `{step, kind, target, data}`); an entry stamped k applies in the step from the
// state after k steps to the state after k + 1 (#522's step convention).
export const entryOf = (step: number, kind: string, data: JsonObject): JsonObject => ({ step, kind, target: 'kart', data });
export const drive = (step: number, force: number): JsonObject => entryOf(step, 'drive', { force });
export const steer = (step: number, angle: number): JsonObject => entryOf(step, 'steer', { angle });
export const brake = (step: number, force: number): JsonObject => entryOf(step, 'brake', { force });
export const place = (step: number, pos: V3, rot: V3): JsonObject => entryOf(step, 'place', { pose: { pos, rot } });

/** A bake sampled once a step, reading the kart's states and every output. */
export const bakeRun = (w: JsonObject, steps: number, track: JsonObject[] = [], extra: JsonObject = {}): JsonObject =>
  ({ call: 'bake', world: w, track, steps, frame_rate: PER_STEP, read: ['kart'], ...extra });
export const checkCall = (w: JsonObject): JsonObject => ({ call: 'check', world: w });

// ---------------------------------------------------------------------------------------------------
// Reading a bake

export function baked(reply: JsonObject | undefined, what: string): JsonObject {
  expect(reply?.['ok'], `${what} is baked, not refused: ${show(reply)}`).toBe(true);
  return reply!;
}
/** The kart's states, index k the state after k steps (#2009's `bodies`). */
export const kartOf = (reply: JsonObject, count: number, what: string): State[] => statesOf(baked(reply, what), 'kart', count, what);

/** A wheel's pose sample (README: outputs): `{pos: [x, y, z], rot: [x, y, z, w]}`, or the same as seven numbers. */
export interface Pose { pos: V3; rot: number[] }
function poseSample(v: JsonValue | undefined, what: string): Pose {
  if (Array.isArray(v) && v.length === 7) {
    const n = vec(v, 7, what);
    return { pos: [n[0]!, n[1]!, n[2]!], rot: n.slice(3) };
  }
  const o = obj(v, what);
  return { pos: vec(o['pos'], 3, `${what}.pos`) as V3, rot: vec(o['rot'], 4, `${what}.rot`) };
}
function seriesOf(reply: JsonObject, id: string, count: number, what: string): JsonValue[] {
  const o = obj(baked(reply, what)['outputs'], `${what}: outputs`);
  const s = arr(obj(o['series'], `${what}: outputs.series`)[id], `${what}: outputs.series.${id}`);
  expect(s.length, `${what}: outputs.series.${id} holds ${count} samples (step 0, then one per step at 120/1)`).toBe(count);
  return s;
}
/** Each wheel's pose output, index k after step k. */
export function wheelPoses(reply: JsonObject, count: number, what: string): Record<WheelName, Pose[]> {
  const out = {} as Record<WheelName, Pose[]>;
  for (const n of WHEEL_NAMES) out[n] = seriesOf(reply, `wheel_${n}`, count, what).map((v, k) => poseSample(v, `${what}: wheel_${n}[${k}]`));
  return out;
}
/** Each wheel's contact_count output (0 or 1), index k after step k. */
export function wheelContacts(reply: JsonObject, count: number, what: string): Record<WheelName, number[]> {
  const out = {} as Record<WheelName, number[]>;
  for (const n of WHEEL_NAMES) {
    out[n] = seriesOf(reply, `contact_${n}`, count, what).map((v, k) => num(Array.isArray(v) && v.length === 1 ? v[0] : v, `${what}: contact_${n}[${k}]`));
  }
  return out;
}

/** A vehicle body's own state (README: `vehicles`): its wheels by name, and the drive, steer and brake it holds. */
export interface WheelState { name: string; spin: number; spinRate: number; touching: boolean }
export interface VehicleState { drive: number; steer: number; brake: number; wheels: WheelState[] }
function wheelState(v: JsonValue | undefined, name: string | undefined, what: string): WheelState {
  const o = obj(v, what);
  const n = typeof o['name'] === 'string' ? o['name'] : name;
  expect(typeof n, `${what} names its wheel (an entry's name, or the key it is under): ${show(o)}`).toBe('string');
  expect(typeof o['touching'], `${what}.touching is a bool`).toBe('boolean');
  return { name: n!, spin: num(o['spin'], `${what}.spin`), spinRate: num(o['spin_rate'], `${what}.spin_rate`), touching: o['touching'] as boolean };
}
/** A bake's or restore's `vehicles.<id>`: `count` states, index j the state after j steps from the reply's first. */
export function vehiclesOf(reply: JsonObject, id: string, count: number, what: string): VehicleState[] {
  const series = arr(obj(baked(reply, what)['vehicles'], `${what}: vehicles (each vehicle body's own state)`)[id], `${what}: vehicles.${id}`);
  expect(series.length, `${what}: vehicles.${id} holds ${count} states`).toBe(count);
  return series.map((v, j) => {
    const o = obj(v, `${what}: vehicles.${id}[${j}]`);
    const w = o['wheels'];
    const wheels = Array.isArray(w)
      ? w.map((x, i) => wheelState(x, undefined, `${what}: vehicles.${id}[${j}].wheels[${i}]`))
      : Object.entries(obj(w, `${what}: vehicles.${id}[${j}].wheels`)).map(([n, x]) => wheelState(x, n, `${what}: vehicles.${id}[${j}].wheels.${n}`));
    return { drive: num(o['drive'], `${what}: vehicles.${id}[${j}].drive`), steer: num(o['steer'], `${what}: vehicles.${id}[${j}].steer`), brake: num(o['brake'], `${what}: vehicles.${id}[${j}].brake`), wheels };
  });
}
/** The fields of two vehicle states that differ, named as the design names them (`steer`, `wheels.fl.spin_rate`). */
export function vehicleDifferences(a: VehicleState, b: VehicleState): string[] {
  const out: string[] = [];
  for (const f of ['drive', 'steer', 'brake'] as const) if (!Object.is(a[f], b[f])) out.push(`${f} is ${b[f]} after the seek and ${a[f]} in the straight run`);
  for (const w of a.wheels) {
    const o = b.wheels.find((x) => x.name === w.name);
    if (!o) { out.push(`wheels.${w.name} is missing after the seek`); continue; }
    if (!Object.is(w.spin, o.spin)) out.push(`wheels.${w.name}.spin is ${o.spin} after the seek and ${w.spin} in the straight run`);
    if (!Object.is(w.spinRate, o.spinRate)) out.push(`wheels.${w.name}.spin_rate is ${o.spinRate} after the seek and ${w.spinRate} in the straight run`);
    if (w.touching !== o.touching) out.push(`wheels.${w.name}.touching is ${o.touching} after the seek and ${w.touching} in the straight run`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Geometry over poses: quaternions `[x, y, z, w]`.

export const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
export const add = (a: readonly number[], b: readonly number[]): V3 => [a[0]! + b[0]!, a[1]! + b[1]!, a[2]! + b[2]!];
export const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
export const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
export const length = (a: readonly number[]): number => Math.hypot(a[0]!, a[1]!, a[2]!);
export const DEG = 180 / Math.PI;
/** `v` turned by the unit quaternion `q`. */
export function rotate(q: readonly number[], v: readonly number[]): V3 {
  const [x, y, z, w] = q as [number, number, number, number];
  const u: V3 = [x, y, z];
  const t = cross(u, v).map((c) => 2 * c) as V3;
  return add(add(v, t.map((c) => c * w)), cross(u, t));
}
/** A body's local point in the world. */
export const worldPoint = (s: { pos: readonly number[]; rot: readonly number[] }, local: readonly number[]): V3 => add(s.pos, rotate(s.rot, local));
/** How far up its own +Y points (1 upright, −1 on its roof). */
export const upness = (s: State): number => rotate(s.rot, [0, 1, 0])[1];
/** Its speed along its heading (+Z), m/s; negative backwards. */
export const forward = (s: State): number => dot(s.linear, rotate(s.rot, [0, 0, 1]));
/** Its heading's turn about +Y from +Z, deg. */
export function yaw(s: State): number {
  const h = rotate(s.rot, [0, 0, 1]);
  return Math.atan2(h[0], h[2]) * DEG;
}
/** A wheel's suspension length: from its mount, in the world, to its hub (its pose), along the chassis's +Y. */
export const springLength = (s: State, name: WheelName, hub: Pose): number => dot(sub(worldPoint(s, AT[name]), hub.pos), rotate(s.rot, [0, 1, 0]));
/**
 * A front wheel's turn, deg: the signed angle from the same side's rear wheel's axle (local X of its pose) to its own,
 * positive about +Y (to the left) on an upright chassis. Rear wheels never steer, so their axle is the chassis's at the
 * same step whatever their spin, and two outputs of one step can't be a step apart.
 */
export function turnOf(front: Pose, rear: Pose): number {
  const a = rotate(rear.rot, [1, 0, 0]);
  const b = rotate(front.rot, [1, 0, 0]);
  const c = cross(a, b);
  return Math.atan2(Math.sign(c[1]) * length(c), dot(a, b)) * DEG;
}
/** The least-squares circle through points in a plane (x, z): its radius. */
export function circleRadius(points: readonly [number, number][]): number {
  // x² + z² + D x + E z + F = 0, linear in D, E, F; normal equations solved by Cramer's rule.
  let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, n = 0, sxr = 0, szr = 0, sr = 0;
  for (const [x, z] of points) {
    const r = -(x * x + z * z);
    sxx += x * x; sxz += x * z; szz += z * z; sx += x; sz += z; n += 1; sxr += x * r; szr += z * r; sr += r;
  }
  const m = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]];
  const rhs = [sxr, szr, sr];
  const det = (a: number[][]): number => a[0]![0]! * (a[1]![1]! * a[2]![2]! - a[1]![2]! * a[2]![1]!) - a[0]![1]! * (a[1]![0]! * a[2]![2]! - a[1]![2]! * a[2]![0]!) + a[0]![2]! * (a[1]![0]! * a[2]![1]! - a[1]![1]! * a[2]![0]!);
  const d = det(m);
  const col = (i: number): number[][] => m.map((row, r) => row.map((v, c) => (c === i ? rhs[r]! : v)));
  const [D, E, F] = [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
  return Math.sqrt((D * D + E * E) / 4 - F);
}

// ---------------------------------------------------------------------------------------------------
// Rows (#1918's): a wheel's contact names the body and the wheel (README: Rows this suite reads).

/** The wheel of `body` a row names: its `wheel` field beside the body, or an ID `<body>#<wheel>` as `a` or `b`. */
export function wheelNamed(r: Row, body: string): string | null {
  const ids = [r.a, r.b, r.raw['body']];
  if (typeof r.raw['wheel'] === 'string' && ids.includes(body)) return r.raw['wheel'];
  for (const id of [r.a, r.b]) {
    const m = typeof id === 'string' ? /^(.+)#([^#]+)$/.exec(id) : null;
    if (m && m[1] === body) return m[2]!;
  }
  return null;
}
/** The row names `body`: as `a`, `b` or `body`, or a part of it, `<body>#…`. */
export const namesBody = (r: Row, body: string): boolean => [r.a, r.b, r.raw['body']].some((x) => x === body || (typeof x === 'string' && x.startsWith(`${body}#`)));

// ---------------------------------------------------------------------------------------------------
// Judging

/** Within `tol` of `want`, relative. */
export const near = (x: number, want: number, tol: number): boolean => Math.abs(x - want) <= Math.abs(want) * tol;
export const fmt = (x: number, digits = 6): string => (Number.isFinite(x) ? Number(x.toPrecision(digits)).toString() : String(x));
/** Some failure matches `test`: the judge's failure names what the criterion says it names. */
export function naming(failures: readonly string[], test: RegExp, what: string): void {
  expect(failures.some((f) => test.test(f)), `${what}: a failure matches ${String(test)}; the failures: ${failures.join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// The course (criteria 5, 9 and 10): level ground with four corner posts, the kart starting settled at the origin,
// heading +Z, its drive, steer and brake derived from the logic item `driver` (README: The lap).

export const LAP_STEPS = 1200;
export const POST_HALF: V3 = [0.5, 1, 0.5];
export const LAP_ON: JsonObject = { logic: 'driver' };
/** The lap's 1,200 steps of drive, steer and brake: the entries the logic item `driver` fires, as a bake keeps them. */
export const LAP_TRACK: JsonObject[] = [
  drive(0, 1500), steer(180, 20), steer(420, 0), steer(540, -15), steer(720, 0), brake(720, 3000),
  brake(780, 0), drive(780, 2500), steer(900, 25), drive(1080, 0), steer(1080, 0), brake(1080, 2000),
];
/** The course world: the kart with sleep off, so it never sleeps under a reading, and the posts. */
export function lapWorld(o: { on?: boolean } = {}): JsonObject {
  const post = (x: number, z: number): JsonObject => ({ kind: 'static', shapes: [{ shape: 'post', contact_material: 'ground' }], pose: { pos: [x, POST_HALF[1], z] } });
  return carWorld(kart([0, SETTLED_Y, 0], { sleep: false }), { inputs: vehicleInputs({ ...(o.on === false ? {} : { on: LAP_ON }), reset: true }) }, {
    contacts: true,
    shapes: { post: box(POST_HALF) },
    bodies: { post_ne: post(90, 90), post_nw: post(-90, 90), post_se: post(90, -90), post_sw: post(-90, -90) },
  });
}

// ---------------------------------------------------------------------------------------------------
// The physics crates' public API (criterion 6), rustdoc's JSON as #2009's ac4 reads it.

const DOC_TARGET = join(TARGET, 'acceptance-251-doc');
export function rustdoc(crate: string, features: string[] = []): Doc {
  const error = cargoError(['rustdoc', '--locked', '-p', crate, '--lib', ...(features.length ? ['--features', features.join(',')] : []), '--', '-Z', 'unstable-options', '--output-format', 'json'],
    { RUSTC_BOOTSTRAP: '1', CARGO_TARGET_DIR: DOC_TARGET });
  expect(error, `rustdoc JSON of ${crate}${features.length ? ` with ${features.join(',')}` : ''}`).toBe('');
  const file = join(DOC_TARGET, 'doc', `${crate.replace(/-/g, '_')}.json`);
  expect(existsSync(file), `rustdoc wrote ${file}`).toBe(true);
  return JSON.parse(readFileSync(file, 'utf8')) as Doc;
}
/** The names of a crate's documented items. */
export function itemNames(doc: Doc): Set<string> {
  const names = new Set<string>();
  for (const item of Object.values(doc.index)) if (typeof item['name'] === 'string') names.add(item['name']);
  return names;
}
