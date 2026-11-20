// Test-side tools for the #2310 acceptance tests (README: The surface under test). They drive the physics runner
// `deep-physics` (JSON lines in, one reply a line) through #191's builds, as #2241's and #2243's suites do: the release
// build for checks, bakes, seeks, goldens, the behavior kit and the planted programs, the `test-backends` build for the
// test backend, and the merge base's release build. They add this issue's worlds, its planted names, its test backend
// and its judges. Nothing here stands in for the reader, the check, the wrapper, the kit or a backend: every issue,
// body state, row, hash and kit row read here is the program's own, and every expected value is the issue's, copied or
// worked here from the closed form it gives.
//
// No function here asserts. What a program answers and what a judge finds wrong with it both come back as text, so
// each test's failing assertion is in its own file. A process that can't start says `BLOCKED:`, one that doesn't
// finish or a run that can't be measured says `INCONCLUSIVE:`: nothing unrun passes.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach } from 'vitest';
import {
  REPO, TIMEOUT, mergeBase, mergeBasePhysics, physicsBin, type JsonObject, type JsonValue, type PhysicsBuild,
} from '../191/helpers.ts';

export { TIMEOUT, prebuild, type JsonObject, type JsonValue } from '../191/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const AC = {
  1: '#2310.e54abd92', 2: '#2310.4ec9a54e', 3: '#2310.7b0715e2', 4: '#2310.96ed9c5c', 5: '#2310.df957af4', 6: '#2310.d9ba72ca',
  7: '#2310.648e6d3e',
} as const;

// ---------------------------------------------------------------------------------------------------
// The names this suite chooses (README: The surface under test)

/**
 * This suite's planted names (`deep-physics --planted <name>`), each one criterion's wrong program.
 * `articulated_built_separate`: the wrapper builds every articulated joint as a separate constraint (criteria 1, 2).
 * `articulated_drops_limits`: the wrapper builds an articulated joint without its limits (criterion 3).
 * `articulated_tree_counts_only`: the check of the articulated joints' trees only counts joints against bodies (criterion 4).
 * `articulated_starts_at_zero`: the wrapper leaves every articulated joint at coordinate 0 (criterion 5).
 * `checkpoint_drops_joint_coordinates`: a restore leaves the articulated joints' coordinates out (criterion 7).
 */
export type Planted =
  | 'articulated_built_separate' | 'articulated_drops_limits' | 'articulated_tree_counts_only' | 'articulated_starts_at_zero'
  | 'checkpoint_drops_joint_coordinates';
/** This suite's test backend (`deep-physics --backend <name>`, the `test-backends` build only): Rapier with articulations left out of its caps(). */
export type TestBackend = 'no_articulations';
export const NO_ARTICULATIONS: TestBackend = 'no_articulations';
/** The cap a backend that has articulations lists in `backend`'s `caps`. */
export const CAP = 'articulations';
/** The joint field, as the issue drafts it. */
export const FIELD = 'articulated';
/** The refusal of an articulated joint that makes a body the `b` of two of them, or closes a loop: it names the joint. */
export const TREE = 'physics.articulation_tree';
/** The refusal of an articulated joint whose anchors are more than 1 mm apart as written: it names the joint and the gap. */
export const GAP = 'physics.articulation_gap';
/** #523's lint, and the code of a refusal by a backend's caps. */
export const MASS_RATIO = 'physics.mass_ratio';
export const BACKEND_CAP = 'physics.backend_cap';
/** The reference backend's name in a kit row. */
export const REFERENCE = 'rapier3d';

// ---------------------------------------------------------------------------------------------------
// The runner: this checkout's release build, its `test-backends` build, and the merge base's.

export interface Runner { planted?: Planted; backend?: TestBackend; build?: PhysicsBuild }
/**
 * What one process answered: `problem` is '' and `replies` holds one object a call (a refusal is a reply, `ok: false`),
 * or `problem` says what the program did instead (a name it doesn't know exits 2 with `bad_input`).
 */
export interface Asked { what: string; problem: string; replies: JsonObject[] }

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, most = 900): string => (JSON.stringify(v) ?? 'undefined').slice(0, most);

function runOn(bin: string, args: string[], calls: JsonObject[], what: string): Asked {
  const run = spawnSync(bin, args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  const no = (problem: string): Asked => ({ what, problem, replies: [] });
  if (code === 'ETIMEDOUT') return no(`INCONCLUSIVE: ${what} didn't finish within its timeout; this is not a pass`);
  if (run.error && code !== 'EPIPE') return no(`BLOCKED: ${what} couldn't be run: ${run.error.message}; this is not a pass`);
  const stdout = run.stdout ?? '';
  if (run.status !== 0) return no(`${what} exits ${String(run.status)}, not 0; stdout: ${stdout.trim().slice(0, 600)}; stderr: ${(run.stderr ?? '').trim().slice(-600)}`);
  const lines = stdout.split('\n').filter((l) => l !== '');
  if (lines.length !== calls.length) return no(`${what} wrote ${lines.length} replies to ${calls.length} calls; stdout: ${stdout.slice(0, 600)}`);
  const replies: JsonObject[] = [];
  for (const [i, line] of lines.entries()) {
    let v: JsonValue;
    try { v = JSON.parse(line) as JsonValue; } catch { return no(`${what}: reply ${i} isn't JSON: ${line.slice(0, 300)}`); }
    if (!isObject(v)) return no(`${what}: reply ${i} isn't an object: ${line.slice(0, 300)}`);
    replies.push(v);
  }
  return { what, problem: '', replies };
}

/**
 * Runs `calls` through one `deep-physics [--backend b] [--planted p]` process of this checkout: the release build, or
 * the `test-backends` build for a test backend. It asserts nothing.
 */
export function ask(calls: JsonObject[], r: Runner = {}): Asked {
  const args = [...(r.backend ? ['--backend', r.backend] : []), ...(r.planted ? ['--planted', r.planted] : [])];
  return runOn(physicsBin(r.build ?? (r.backend ? 'test' : 'release')), args, calls, `deep-physics ${args.join(' ')}`.trim());
}

let baseDir = '';
let base: { sha: string; bin: string; problem: string } | undefined;
/** A file that reads the merge base calls this once: its copy of the merge base's binary goes when the file ends. */
export function withBase(): void {
  afterAll(() => { if (baseDir) rmSync(baseDir, { recursive: true, force: true }); baseDir = ''; base = undefined; }, TIMEOUT);
}
/**
 * Runs `calls` through the merge base's release deep-physics (#191's `mergeBasePhysics`, as #2241's suite does),
 * built once for the file. With no merge base to name, or none that builds, nothing was compared: `BLOCKED:`.
 */
export function askBase(calls: JsonObject[]): Asked & { sha: string } {
  if (!base) {
    let sha = '';
    let problem = '';
    try { sha = mergeBase(); } catch (e) { problem = `git merge-base HEAD origin/main names no merge base: ${(e as Error).message.split('\n')[0] ?? ''}`; }
    let bin = '';
    if (sha !== '') {
      baseDir = mkdtempSync(join(tmpdir(), 'deep-2310-base-'));
      bin = join(baseDir, 'deep-physics-base');
      let error: string;
      try { error = mergeBasePhysics(sha, bin); } catch (e) { error = (e as Error).message; }
      if (error !== '') problem = `the merge base ${sha.slice(0, 12)} gives no release deep-physics: ${error.replace(/^BLOCKED: /, '')}`;
    }
    base = { sha, bin, problem };
  }
  const what = `the merge base's deep-physics (${base.sha.slice(0, 12)})`;
  if (base.problem !== '') return { what, problem: `BLOCKED: ${base.problem}; this is not a pass`, replies: [], sha: base.sha };
  return { ...runOn(base.bin, [], calls, what), sha: base.sha };
}

/** A fresh folder per call (a bake's store), deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); }, TIMEOUT);
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-2310-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// Vectors and turns (Units and axes: metres, +Y up; a body's `rot` is a quaternion [x, y, z, w], or degrees about X,
// then Y, then Z in fixed axes).

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const far = (a: Vec3, b: Vec3): number => norm(sub(a, b));
/** `v` turned by the quaternion `q`. */
function turned(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const t: Vec3 = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])];
}
const times = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const RAD = Math.PI / 180;
/** Degrees about X, then Y, then Z in fixed axes, R = Rz·Ry·Rx, as a quaternion. */
function fromDegrees(d: Vec3): Quat {
  const about = (axis: 0 | 1 | 2, deg: number): Quat => { const q: Quat = [0, 0, 0, Math.cos((deg * RAD) / 2)]; q[axis] = Math.sin((deg * RAD) / 2); return q; };
  return times(about(2, d[2]), times(about(1, d[1]), about(0, d[0])));
}
const numbers = (v: JsonValue | undefined, n: number): number[] | null =>
  (Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : null);

// ---------------------------------------------------------------------------------------------------
// The issue's numbers. Each is the issue's, or its closed form worked here.

export const G = 9.81;
/** 120 Hz and 4 substeps; "over 4 s" is 480 steps, and a body's state after step k is at index k. */
export const RATE = 120;
export const SUBSTEPS = 4;
export const SECONDS = 4;
export const STEPS = SECONDS * RATE;
/** A chain of ten 0.1 kg links of 0.1 m, and a bob of radius 0.05 m at its end. */
export const LINKS = 10;
export const LINK_MASS = 0.1;
export const LINK = 0.1;
export const BOB_RADIUS = 0.05;
/** 10 × 0.1 + 0.05 = 1.05 m: from the fixed point to the bob's centre. */
export const REACH = LINKS * LINK + BOB_RADIUS;
/** No joint's two anchors are more than 0.1 mm apart, and the bob's centre stays 1.05 m from the fixed point within 0.1 mm. */
export const OPEN = 1e-4;
/** √(2 × 9.81 × 1.05) = 4.539 m/s: the speed a bob on a rod of that length passes its lowest point at, let go level. */
export const LOWEST_SPEED = Math.sqrt(2 * G * REACH);
/** Within 1%. */
export const WITHIN = 0.01;
/** The bob's centre is never more than 1 mm past the place where it touches the wall. */
export const PAST = 1e-3;
/** 2π√(L/g) × (1 + θ²/16) = 2.010 s: a 1 m pendulum released from 10°. */
export const SWING = 10;
export const PERIOD = 2 * Math.PI * Math.sqrt(1 / G) * (1 + (SWING * RAD) ** 2 / 16);
/** A hinge limited to ±30° is never past 30.5°; a hinge motor set to 90°/s turns within 1% of it after 0.5 s (step 60). */
export const LIMIT = 30;
export const NEVER_PAST = 30.5;
export const MOTOR = 90;
export const MOTOR_STEP = RATE / 2;
/** The planted wrapper that builds the joints as separate ones opens a joint 17.5 mm: read to half a unit of that last digit. */
export const SEPARATE_OPENS = 0.0175;
export const PRINTED_MM = 0.00005;
/** The articulated hinge's body is written 45° from straight down, 1 m from the hinge: (0.7071, −0.7071) m from it. */
export const WRITTEN = 45;
export const PLACE: Vec3 = [Math.sin(WRITTEN * RAD), -Math.cos(WRITTEN * RAD), 0];
/** The same body written 2 mm off its anchor. */
export const OFF = 0.002;
/** #523's hand, 0.1 × 0.1 × 0.02 m at 1,000 kg/m³, and its torso. */
export const HAND_MASS = 0.1 * 0.1 * 0.02 * 1000;
export const TORSO_MASS = 40;

export const mm = (x: number): string => (x * 1000).toFixed(2);
export const fmt = (x: number): string => (Number.isFinite(x) ? String(+x.toFixed(4)) : String(x));

// ---------------------------------------------------------------------------------------------------
// The worlds (README: The worlds). Every one is at 120 Hz and 4 substeps with g = 9.81 m/s², on the world's defaults;
// a joint is written `articulated: true`, or with the field left out (a separate joint, as the base builds every joint).

export function world(parts: JsonObject): JsonObject {
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: RATE, substeps: SUBSTEPS, gravity: [0, -G, 0], seed: 2310, mode: 'dynamic',
    capacity: { bodies: 16, shapes: 16, joints: 16, contacts: 64, particles: 0 },
    contact_materials: { m: { friction: 0.5, restitution: 0, density: 1000 } },
    ...parts,
  };
}
const use = (shape: string): JsonObject => ({ shape, contact_material: 'm' });
const jointed = (articulated: boolean): JsonObject => (articulated ? { [FIELD]: true } : {});
const pad = (n: number): string => String(n).padStart(2, '0');

/** The chain's fixed point, its bodies and its joints: `joint_01` holds `link_01` to the world, `joint_11` the bob to `link_10`. */
export const FIXED: Vec3 = [0, 0, 0];
export const BOB = 'bob';
export const WALL = 'wall';
export const linkId = (i: number): string => `link_${pad(i)}`;
export const jointId = (i: number): string => `joint_${pad(i)}`;
/** Along the chain as written, from the fixed point to the bob: straight down. */
export const ALONG: Vec3 = [0, -1, 0];
/** Gravity turned square to the chain: along +X, so the chain as written is level and its lowest point is at +X. */
export const SQUARE: Vec3 = [G, 0, 0];
/**
 * The wall: a static box over x 1.02 to 1.42 m whose lower face is the plane y = 0.05, so the bob's surface meets
 * that face as its centre passes its lowest point, (1.05, 0, 0), moving along +Y, and no link reaches the wall.
 */
export const WALL_AT: Vec3 = [1.22, BOB_RADIUS + 0.1, 0];
export const WALL_HALF: Vec3 = [0.2, 0.1, 0.2];

export interface ChainParts {
  /** The bob's mass, kg. */
  bob: number;
  /** Every joint `articulated: true` (the default), or the field left out. */
  articulated?: boolean;
  /** Gravity turned square to the chain, so it is let go level. */
  level?: boolean;
  /** A static wall whose face the bob touches as it passes its lowest point. */
  wall?: boolean;
}
/**
 * The chain: ten links of 0.1 kg, each a capsule 0.1 m long on its local Y, hang in a line from the fixed point, each
 * on a ball joint at its top to the link above (the first to the world), and a bob of radius 0.05 m hangs from the
 * last by a ball joint at its top, its centre 1.05 m from the fixed point. With `wall`, a static box whose lower face
 * is the plane y = 0.05 over x 1.02 to 1.42 m, which only the bob reaches.
 */
export function chain(o: ChainParts): JsonObject {
  const articulated = o.articulated ?? true;
  const bodies: JsonObject = {};
  const joints: JsonObject = {};
  for (let i = 1; i <= LINKS; i++) {
    bodies[linkId(i)] = { kind: 'dynamic', shapes: [use('link')], pose: { pos: [0, -(LINK / 2 + LINK * (i - 1)), 0] }, mass: LINK_MASS };
    joints[jointId(i)] = {
      kind: 'ball', a: i === 1 ? 'world' : linkId(i - 1), b: linkId(i),
      frame_a: { anchor: i === 1 ? [...FIXED] : [0, -LINK / 2, 0] }, frame_b: { anchor: [0, LINK / 2, 0] }, ...jointed(articulated),
    };
  }
  bodies[BOB] = { kind: 'dynamic', shapes: [use('bob')], pose: { pos: [0, -REACH, 0] }, mass: o.bob };
  joints[jointId(LINKS + 1)] = {
    kind: 'ball', a: linkId(LINKS), b: BOB, frame_a: { anchor: [0, -LINK / 2, 0] }, frame_b: { anchor: [0, BOB_RADIUS, 0] }, ...jointed(articulated),
  };
  if (o.wall) bodies[WALL] = { kind: 'static', shapes: [use('wall')], pose: { pos: [...WALL_AT] } };
  return world({
    ...(o.level ? { gravity: [...SQUARE] } : {}),
    checkpoint: { every: 60 },
    shapes: { link: { kind: 'capsule', half_height: LINK / 2 - 0.01, radius: 0.01 }, bob: { kind: 'sphere', radius: BOB_RADIUS }, ...(o.wall ? { wall: { kind: 'box', half: [...WALL_HALF] } } : {}) },
    bodies,
    joints,
  });
}

/** Criterion 3's bodies and joints: the kit's pendulum, hinge limit and hinge motor, on an articulated joint. */
export const ROD = 'rod';
export const PIN = 'pin';
export const BAR = 'bar';
const ANCHOR: Vec3 = [0, 2, 0];
/** A 1 kg ball on a 1 m ball joint `rod` to the world, released from 10°. */
export function pendulum(articulated = true): JsonObject {
  const [s, c] = [Math.sin(SWING * RAD), Math.cos(SWING * RAD)];
  return world({
    shapes: { bob: { kind: 'sphere', radius: BOB_RADIUS } },
    bodies: { [BOB]: { kind: 'dynamic', shapes: [use('bob')], pose: { pos: [s, ANCHOR[1] - c, 0] }, mass: 1, sleep: false } },
    joints: { [ROD]: { kind: 'ball', a: 'world', b: BOB, frame_a: { anchor: [...ANCHOR] }, frame_b: { anchor: [-s, c, 0] }, ...jointed(articulated) } },
  });
}
/** A 1 m bar held level at one end by the hinge `pin` to the world about `axis`, `joint` its other fields. */
function hinged(axis: Vec3, joint: JsonObject, articulated: boolean): JsonObject {
  return world({
    shapes: { bar: { kind: 'box', half: [0.5, 0.05, 0.05] } },
    bodies: { [BAR]: { kind: 'dynamic', shapes: [use('bar')], pose: { pos: [0.5, ANCHOR[1], 0] }, sleep: false } },
    joints: { [PIN]: { kind: 'hinge', a: 'world', b: BAR, frame_a: { anchor: [...ANCHOR], axis: [...axis] }, frame_b: { anchor: [-0.5, 0, 0], axis: [...axis] }, ...joint, ...jointed(articulated) } },
  });
}
/** A hinge about +Z limited to ±30°, its bar let go level under gravity. */
export const hingeLimit = (articulated = true): JsonObject => hinged([0, 0, 1], { limits: { min: -LIMIT, max: LIMIT } }, articulated);
/** A hinge about +Y, which gravity doesn't turn, with a velocity motor set to 90°/s and torque to spare (1,000 N·m at 10 Hz). */
export const hingeMotor = (articulated = true): JsonObject =>
  hinged([0, 1, 0], { motor: { mode: 'velocity', target: MOTOR, max_torque: 1000, hz: 10 } }, articulated);

/** Criterion 4's square: four 1 m bars, `side_1` to `side_4`, around the corners (0, 0), (1, 0), (1, 1) and (0, 1), each corner a hinge about +Z. */
export const SIDES = ['side_1', 'side_2', 'side_3', 'side_4'] as const;
export const CORNERS = ['corner_1', 'corner_2', 'corner_3', 'corner_4'] as const;
/** The hinge that closes the loop: the last of the four in canonical (ID) order. */
export const CLOSES = 'corner_4';
/**
 * The square: hinge `corner_i` joins the far end of `side_i` (its `a`) to the near end of the next side (its `b`), and
 * `corner_4` joins `side_4` back to `side_1`, so every body is the `b` of exactly one hinge and the four close a loop.
 * Each hinge in `separate` leaves `articulated` out; the others are articulated.
 */
export function square(separate: readonly string[] = []): JsonObject {
  const centres: Vec3[] = [[0.5, 0, 0], [1, 0.5, 0], [0.5, 1, 0], [0, 0.5, 0]];
  const bodies: JsonObject = {};
  const joints: JsonObject = {};
  SIDES.forEach((id, i) => {
    bodies[id] = { kind: 'dynamic', shapes: [use('bar')], pose: { pos: [...centres[i]!], rot: [0, 0, 90 * i] }, mass: 1, sleep: false };
    joints[CORNERS[i]!] = {
      kind: 'hinge', a: id, b: SIDES[(i + 1) % 4]!, frame_a: { anchor: [0.5, 0, 0], axis: [0, 0, 1] }, frame_b: { anchor: [-0.5, 0, 0], axis: [0, 0, 1] },
      ...jointed(!separate.includes(CORNERS[i]!)),
    };
  });
  return world({ shapes: { bar: { kind: 'box', half: [0.5, 0.02, 0.02] } }, bodies, joints });
}
/** Criterion 4's body held twice: `load` is the `b` of both `hold_1` (from `left`) and `hold_2` (from `right`), both articulated hinges. */
export const HOLDS = ['hold_1', 'hold_2'] as const;
export function heldTwice(): JsonObject {
  const bar = (x: number): JsonObject => ({ kind: 'dynamic', shapes: [use('bar')], pose: { pos: [x, 0, 0] }, mass: 1, sleep: false });
  const hold = (a: string, from: number, to: number): JsonObject =>
    ({ kind: 'hinge', a, b: 'load', frame_a: { anchor: [from, 0, 0], axis: [0, 0, 1] }, frame_b: { anchor: [to, 0, 0], axis: [0, 0, 1] }, [FIELD]: true });
  return world({
    shapes: { bar: { kind: 'box', half: [0.5, 0.02, 0.02] } },
    bodies: { left: bar(-1), load: bar(0), right: bar(1) },
    joints: { [HOLDS[0]]: hold('left', 0.5, -0.5), [HOLDS[1]]: hold('right', -0.5, 0.5) },
  });
}
/** Criterion 4's `breaks_at`: the pendulum's ball joint `rod`, with `breaks_at` when `breaks`. */
export function breakable(articulated: boolean, breaks: boolean): JsonObject {
  const w = pendulum(articulated);
  const joints = w['joints'] as JsonObject;
  if (breaks) joints[ROD] = { ...(joints[ROD] as JsonObject), breaks_at: { force: 1000, over_steps: 1 } };
  return w;
}

/** Criterion 5's hinge and its body. */
export const HINGE = 'hinge';
export const ARM = 'arm';
/**
 * A 1 kg ball `arm` on the hinge `hinge` to the world at the origin, about +Z, with no gravity: its anchor is 1 m
 * above its centre in its own frame, and it is written turned 45° about +Z, 45° from straight down, so its centre is
 * at (0.7071, −0.7071) m and its anchors are together. `off` moves it that far along the line from the hinge.
 */
export function written(articulated = true, off = 0): JsonObject {
  const at = (x: number): number => x * (1 + off);
  return world({
    gravity: [0, 0, 0],
    shapes: { ball: { kind: 'sphere', radius: BOB_RADIUS } },
    bodies: { [ARM]: { kind: 'dynamic', shapes: [use('ball')], pose: { pos: [at(PLACE[0]), at(PLACE[1]), 0], rot: [0, 0, WRITTEN] }, mass: 1, sleep: false } },
    joints: { [HINGE]: { kind: 'hinge', a: 'world', b: ARM, frame_a: { anchor: [0, 0, 0], axis: [0, 0, 1] }, frame_b: { anchor: [0, 1, 0], axis: [0, 0, 1] }, ...jointed(articulated) } },
  });
}

/** Criterion 6's bodies and joints. */
export const HAND = 'hand';
export const TORSO = 'torso';
export const GRIP = 'grip';
export const WRIST = 'wrist';
/**
 * #523's hand and torso (its `wrist` world's shapes, masses and material), the torso hanging from the hand: the hand,
 * a box 0.1 × 0.1 × 0.02 m of density 1,000 kg/m³ and no declared mass (0.2 kg), hangs from the world by the ball
 * joint `grip` at its top, and the torso, a box 0.3 × 0.6 × 0.2 m declared 40 kg, hangs from the hand by the hinge
 * `wrist` about +X.
 */
export function handAndTorso(articulated = true): JsonObject {
  return world({
    contact_materials: { skin: { friction: 0.5, restitution: 0, density: 1000 } },
    shapes: { palm: { kind: 'box', half: [0.05, 0.05, 0.01] }, chest: { kind: 'box', half: [0.15, 0.3, 0.1] } },
    bodies: {
      [HAND]: { kind: 'dynamic', shapes: [{ shape: 'palm', contact_material: 'skin' }], pose: { pos: [0, -0.05, 0] } },
      [TORSO]: { kind: 'dynamic', shapes: [{ shape: 'chest', contact_material: 'skin' }], pose: { pos: [0, -0.4, 0] }, mass: TORSO_MASS },
    },
    joints: {
      [GRIP]: { kind: 'ball', a: 'world', b: HAND, frame_a: { anchor: [0, 0, 0] }, frame_b: { anchor: [0, 0.05, 0] }, ...jointed(articulated) },
      [WRIST]: { kind: 'hinge', a: HAND, b: TORSO, frame_a: { anchor: [0, -0.05, 0], axis: [1, 0, 0] }, frame_b: { anchor: [0, 0.3, 0], axis: [1, 0, 0] }, ...jointed(articulated) },
    },
  });
}

// ---------------------------------------------------------------------------------------------------
// Calls (all the base's)

const section = (w: JsonObject, key: string): JsonObject => (isObject(w[key]) ? w[key] : {});
export const bodyIds = (w: JsonObject): string[] => Object.keys(section(w, 'bodies')).sort();
export const jointIds = (w: JsonObject): string[] => Object.keys(section(w, 'joints')).sort();
export const check = (w: JsonObject): JsonObject => ({ call: 'check', world: w });
/** A bake of `steps` steps reading every body, a state a step. */
export const bake = (w: JsonObject, steps = STEPS, extra: JsonObject = {}): JsonObject => ({ call: 'bake', world: w, steps, read: bodyIds(w), ...extra });
/** A seek of the bake kept in `store` to step `to`, played on to the bake's end. */
export const seek = (w: JsonObject, store: string, to: number, steps = STEPS): JsonObject =>
  ({ call: 'seek', world: w, steps, store, to, play: steps - to, read: bodyIds(w) });

// ---------------------------------------------------------------------------------------------------
// Reading a bake (the base's `bake`: `bodies.<ID>[k]` is the state after step k, index 0 the world as built;
// `occurrences` its rows; `step_hashes[k]` the hash after step k).

export interface State { pos: Vec3; rot: Quat; linear: Vec3; angular: Vec3 }
export interface Row { step: number; kind: string; a: string; b: string | null; raw: JsonObject }
export interface Run { states: Record<string, State[]>; rows: Row[]; hashes: string[] }

/** Why a reply isn't what was asked for, in its own words: its issues' codes, paths and sentences. */
export function refusal(reply: JsonObject | undefined): string {
  const issues = reply && Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  return issues.length ? issues.slice(0, 3).map((i) => `${String(i['code'])} at ${String(i['path'])}: ${String(i['what'])}`).join('; ') + (issues.length > 3 ? `; and ${issues.length - 3} more` : '') : show(reply, 400);
}
function statesOf(series: JsonValue | undefined): State[] | null {
  if (!Array.isArray(series)) return null;
  const out: State[] = [];
  for (const v of series) {
    const s = isObject(v) ? v : {};
    const [pos, rot, linear, angular] = [numbers(s['pos'], 3), numbers(s['rot'], 4), numbers(s['linear'], 3), numbers(s['angular'], 3)];
    if (!pos || !rot || !linear || !angular) return null;
    out.push({ pos: pos as Vec3, rot: rot as Quat, linear: linear as Vec3, angular: angular as Vec3 });
  }
  return out;
}
/**
 * A bake (or a seek) of `w` as a run of `count` states of every body from `reply`; or, as text, why it isn't one: the
 * world refused, or a body's states or the step hashes short of `count`, which can't be measured.
 */
export function runOf(w: JsonObject, reply: JsonObject | undefined, what: string, count = STEPS + 1): Run | string {
  if (reply?.['ok'] !== true) return `${what} isn't baked: ${refusal(reply)}`;
  const states: Record<string, State[]> = {};
  for (const id of bodyIds(w)) {
    const s = statesOf(isObject(reply['bodies']) ? reply['bodies'][id] : undefined);
    if (!s) return `INCONCLUSIVE: ${what} holds no states {pos, rot, linear, angular} of ${id}; this is not a pass`;
    if (s.length !== count) return `INCONCLUSIVE: ${what} holds ${s.length} states of ${id}, not ${count}; this is not a pass`;
    states[id] = s;
  }
  const h = reply['step_hashes'];
  if (!Array.isArray(h) || h.length !== count || !h.every((x) => typeof x === 'string' && /^[0-9a-f]{16}$/.test(x))) {
    return `INCONCLUSIVE: ${what} holds ${Array.isArray(h) ? h.length : 'no'} step hashes, not ${count} of 16 hex digits each; this is not a pass`;
  }
  const rows = (Array.isArray(reply['occurrences']) ? reply['occurrences'] : []).filter(isObject).map((o) => ({
    step: typeof o['step'] === 'number' ? o['step'] : -1, kind: String(o['kind']), a: String(o['a']), b: typeof o['b'] === 'string' ? o['b'] : null, raw: o,
  }));
  return { states, rows, hashes: h as string[] };
}
/** A run's failures, or the one reason it can't be judged. */
export const judged = (run: Run | string, judge: (r: Run) => string[]): string[] => (typeof run === 'string' ? [run] : judge(run));

// ---------------------------------------------------------------------------------------------------
// A joint's opening: the distance between its two anchors, each worked out from its body's state (the world's own
// point for an end that is the world) and the joint's frame.

interface End { body: string | null; anchor: Vec3 }
function endOf(w: JsonObject, joint: JsonObject, side: 'a' | 'b'): End {
  const name = typeof joint[side] === 'string' ? joint[side] : '';
  const frame = joint[`frame_${side}`];
  let anchor = (numbers(isObject(frame) ? frame['anchor'] : undefined, 3) ?? [0, 0, 0]) as Vec3;
  if (name === 'world') return { body: null, anchor };
  const [id, named] = name.split('#') as [string, string | undefined];
  const body = section(w, 'bodies')[id];
  const anchors = isObject(body) && isObject(body['anchors']) ? body['anchors'] : {};
  if (named !== undefined) anchor = (numbers(anchors[named], 3) ?? anchor) as Vec3;
  return { body: id, anchor };
}
const pointAt = (e: End, run: Run, k: number): Vec3 => {
  if (e.body === null) return e.anchor;
  const s = run.states[e.body]?.[k];
  return s ? add(s.pos, turned(s.rot, e.anchor)) : [NaN, NaN, NaN];
};
/** A body's pose as its world document writes it. */
function writtenPose(body: JsonValue | undefined): { pos: Vec3; rot: Quat } {
  const pose = isObject(body) && isObject(body['pose']) ? body['pose'] : {};
  const rot = numbers(pose['rot'], 4) ?? (numbers(pose['rot'], 3) ? fromDegrees(pose['rot'] as Vec3) : [0, 0, 0, 1]);
  return { pos: (numbers(pose['pos'], 3) ?? [0, 0, 0]) as Vec3, rot: rot as Quat };
}
/** Where a joint's end is as the document writes it. */
function writtenPoint(w: JsonObject, e: End): Vec3 {
  if (e.body === null) return e.anchor;
  const p = writtenPose(section(w, 'bodies')[e.body]);
  return add(p.pos, turned(p.rot, e.anchor));
}

/** One joint over a run: the first step its anchors are more than 0.1 mm apart (−1: never) and how far there, and its widest opening and that step. */
export interface Opening { joint: string; first: number; at: number; worst: number; step: number }
/** Every joint of `w` over `run`, in canonical (ID) order. A gap that isn't a number counts as open. */
export function openings(w: JsonObject, run: Run): Opening[] {
  const count = run.hashes.length;
  return jointIds(w).map((joint) => {
    const j = section(w, 'joints')[joint] as JsonObject;
    const [a, b] = [endOf(w, j, 'a'), endOf(w, j, 'b')];
    const o: Opening = { joint, first: -1, at: 0, worst: 0, step: 0 };
    for (let k = 0; k < count; k++) {
      const gap = far(pointAt(a, run, k), pointAt(b, run, k));
      if (!(gap <= OPEN) && o.first < 0) [o.first, o.at] = [k, gap];
      if (!(gap <= o.worst)) [o.worst, o.step] = [gap, k];
    }
    return o;
  });
}
/** The joint whose anchors are farthest apart over the run. */
export const widest = (all: Opening[]): Opening => all.reduce((x, y) => (!(y.worst <= x.worst) ? y : x));
/** The first joint to open: the one whose anchors are first more than 0.1 mm apart, the earlier in canonical order on a tie; none when no joint opens. */
export function firstToOpen(all: Opening[]): Opening | undefined {
  return all.filter((o) => o.first >= 0).sort((x, y) => x.first - y.first || (x.joint < y.joint ? -1 : 1))[0];
}
/**
 * "No joint's two anchors are more than 0.1 mm apart at any step": a failure for each joint that opens, the first to
 * open first, each starting with the joint and the first step it is open at.
 */
export function openFailures(w: JsonObject, run: Run): string[] {
  return openings(w, run).filter((o) => o.first >= 0).sort((x, y) => x.first - y.first || (x.joint < y.joint ? -1 : 1))
    .map((o) => `${o.joint}: step ${o.first}: its two anchors are ${mm(o.at)} mm apart, more than 0.1 mm; ${mm(o.worst)} mm at the most, at step ${o.step}`);
}

// ---------------------------------------------------------------------------------------------------
// The chain's judges (criteria 1 and 2). Each takes the chain's bob, its fixed point and its line as written, so the
// same judge reads this suite's worlds and the kit's fixtures.

export interface Hung { bob: string; fixed: Vec3; along: Vec3 }
export const HUNG: Hung = { bob: BOB, fixed: FIXED, along: ALONG };
/** "The bob's centre stays 1.05 m from the fixed point within 0.1 mm": a failure naming the bob and the first step it is off. */
export function reachFailures(run: Run, c: Hung = HUNG): string[] {
  const off: number[] = [];
  let [worst, step] = [0, 0];
  (run.states[c.bob] ?? []).forEach((s, k) => {
    const away = Math.abs(far(s.pos, c.fixed) - REACH);
    if (!(away <= OPEN)) off.push(k);
    if (!(away <= worst)) [worst, step] = [away, k];
  });
  const first = off[0];
  if (first === undefined) return [];
  const read = (k: number): string => far(run.states[c.bob]![k]!.pos, c.fixed).toFixed(5);
  return [`${c.bob}: step ${first}: its centre is ${read(first)} m from the fixed point, not ${REACH} m within 0.1 mm (${off.length} of ${run.hashes.length} states are off; ${read(step)} m at step ${step} is the farthest off)`];
}
/** Criterion 1 over a bake of the hung chain: no joint opens, and the bob's centre stays 1.05 m from the fixed point. */
export const hungFailures = (w: JsonObject, run: Run, c: Hung = HUNG): string[] => [...openFailures(w, run), ...reachFailures(run, c)];

/**
 * Where the bob passes its lowest point: the chain is let go along `along`, square to gravity, so its lowest point is
 * where its centre crosses the line through the fixed point along gravity. The step nearer that line of the two the
 * crossing lies between, and the bob's speed there; or, as text, that it never crosses.
 */
export function lowest(run: Run, c: Hung = HUNG): { step: number; speed: number } | string {
  const states = run.states[c.bob] ?? [];
  const side = (k: number): number => dot(sub(states[k]!.pos, c.fixed), c.along);
  for (let k = 1; k < states.length; k++) {
    if (!(side(k) <= 0)) continue;
    const step = Math.abs(side(k - 1)) < Math.abs(side(k)) ? k - 1 : k;
    return { step, speed: norm(states[step]!.linear) };
  }
  return `INCONCLUSIVE: ${c.bob} never passes its lowest point in ${states.length - 1} steps, so its speed there can't be read; this is not a pass`;
}
/** "The bob passes its lowest point at √(2 × 9.81 × 1.05) = 4.539 m/s within 1%": a failure naming the bob, the step and the speed it read. */
export function lowestFailures(run: Run, c: Hung = HUNG): string[] {
  const at = lowest(run, c);
  if (typeof at === 'string') return [at];
  return Math.abs(at.speed - LOWEST_SPEED) <= WITHIN * LOWEST_SPEED ? [] : [`${c.bob}: step ${at.step}: it passes its lowest point at ${at.speed.toFixed(3)} m/s, not √(2 × 9.81 × 1.05) = ${LOWEST_SPEED.toFixed(3)} m/s within 1%`];
}
/** Criterion 2 over a bake of the chain let go level: the bob's speed at its lowest point, and no joint opens. */
export const swungFailures = (w: JsonObject, run: Run, c: Hung = HUNG): string[] => [...lowestFailures(run, c), ...openFailures(w, run)];

/**
 * How far past the place where it touches the wall the bob's centre is after each step, m: the bob touches the wall
 * where its centre is its radius from the wall's box, so this is its radius less that distance (negative: short of
 * touching; its whole radius once its centre is inside the wall).
 */
export const pastWall = (run: Run): number[] => (run.states[BOB] ?? []).map((s) => {
  const out = s.pos.map((x, i) => Math.max(Math.abs(x - WALL_AT[i]!) - WALL_HALF[i]!, 0)) as Vec3;
  return BOB_RADIUS - norm(out);
});
/**
 * "Swung into a static wall, the bob writes `hit` naming the wall, and its centre is never more than 1 mm past the
 * place where it touches": a failure naming the bob for a missing row, and the bob and the first step it is past.
 */
export function wallFailures(run: Run): string[] {
  const out: string[] = [];
  const met = run.rows.filter((r) => (r.a === BOB && r.b === WALL) || (r.a === WALL && r.b === BOB));
  if (!met.some((r) => r.kind === 'hit')) out.push(`${BOB}: it writes no hit naming ${WALL}; its rows with ${WALL}: ${met.map((r) => `${r.kind} at step ${r.step}`).join(', ') || 'none'}`);
  const past = pastWall(run);
  const first = past.findIndex((p) => !(p <= PAST));
  const worst = past.reduce((x, y) => (!(y <= x) ? y : x), -Infinity);
  if (first >= 0) out.push(`${BOB}: step ${first}: its centre is ${mm(past[first]!)} mm past the place where it touches ${WALL}, more than 1 mm (${mm(worst)} mm at the most, at step ${past.indexOf(worst)})`);
  return out;
}
/**
 * Criterion 2 over a bake of the 10 kg chain swung into the wall: the bob's row and its place at the wall, and no
 * joint opens (the Scope's "its anchors never part", at the criteria's 0.1 mm).
 */
export const struckFailures = (w: JsonObject, run: Run): string[] => [...wallFailures(run), ...openFailures(w, run)];

// ---------------------------------------------------------------------------------------------------
// Criterion 3's judges, each from the body's states.

/** A pendulum as its world writes it: its ball, its anchor, and the level direction it is released toward. */
export interface Released { bob: string; anchor: Vec3; side: Vec3 }
export const RELEASED: Released = { bob: BOB, anchor: ANCHOR, side: [1, 0, 0] };
/**
 * The pendulum's period: the time between the ball's first two crossings of the line under its anchor from the side
 * it is released on, each read between the two steps it lies between; or, as text, that it doesn't cross twice.
 */
export function periodOf(run: Run, p: Released = RELEASED): number | string {
  const x = (run.states[p.bob] ?? []).map((s) => dot(sub(s.pos, p.anchor), p.side));
  const crossings: number[] = [];
  for (let k = 1; k < x.length && crossings.length < 2; k++) {
    if (x[k - 1]! > 0 && x[k]! <= 0) crossings.push((k - 1 + x[k - 1]! / (x[k - 1]! - x[k]!)) / RATE);
  }
  return crossings.length === 2 ? crossings[1]! - crossings[0]! : `INCONCLUSIVE: ${p.bob} crosses under its anchor from the side it is released on ${crossings.length} times in ${x.length - 1} steps, not twice, so its period can't be read; this is not a pass`;
}
/** "A 1 kg ball on a 1 m ball joint released from 10° swings with a period of 2.010 s within 1%": a failure naming the ball and the period it read. */
export function periodFailures(run: Run, p: Released = RELEASED): string[] {
  const t = periodOf(run, p);
  if (typeof t === 'string') return [t];
  return Math.abs(t - PERIOD) <= WITHIN * PERIOD ? [] : [`${p.bob}: it swings with a period of ${t.toFixed(4)} s, not 2π√(L/g) × (1 + θ²/16) = ${PERIOD.toFixed(3)} s within 1%`];
}
/** How far `body` has turned about `axis` from where it was built, after each step, degrees in (−180, 180]. */
export function turnsOf(run: Run, body: string, axis: Vec3): number[] {
  const states = run.states[body] ?? [];
  const built = states[0]?.rot ?? [0, 0, 0, 1];
  const back: Quat = [-built[0], -built[1], -built[2], built[3]];
  return states.map((s) => {
    const q = times(s.rot, back);
    const deg = (2 * Math.atan2(dot([q[0], q[1], q[2]], axis), q[3])) / RAD;
    return deg > 180 ? deg - 360 : deg <= -180 ? deg + 360 : deg;
  });
}
/** The hinge's largest angle over the run, and its step. */
export function largest(run: Run, body = BAR, axis: Vec3 = [0, 0, 1]): { angle: number; step: number } {
  let [angle, step] = [0, 0];
  turnsOf(run, body, axis).forEach((a, k) => { if (!(Math.abs(a) <= angle)) [angle, step] = [Math.abs(a), k]; });
  return { angle, step };
}
/**
 * "A hinge limited to ±30° under gravity is never past 30.5°": a failure naming the joint and its largest angle. The
 * bound is of a bar the limit stops, so a bar that never comes within 0.5° of its limit fails too.
 */
export function limitFailures(run: Run, joint = PIN, body = BAR, axis: Vec3 = [0, 0, 1]): string[] {
  const peak = largest(run, body, axis);
  if (!(peak.angle <= NEVER_PAST)) return [`${joint}: its largest angle is ${fmt(peak.angle)}°, at step ${peak.step}, past ${NEVER_PAST}° on a hinge limited to ±${LIMIT}°`];
  return peak.angle >= LIMIT - 0.5 ? [] : [`${joint}: its largest angle is ${fmt(peak.angle)}°, at step ${peak.step}: under gravity the bar never reaches its ±${LIMIT}° limit, so the limit isn't what holds it`];
}
/** "A hinge motor set to 90°/s with torque to spare turns within 1% of it after 0.5 s": the bar's turn rate about the hinge's axis after step 60. */
export function motorFailures(run: Run, joint = PIN, body = BAR, axis: Vec3 = [0, 1, 0]): string[] {
  const s = run.states[body]?.[MOTOR_STEP];
  if (!s) return [`INCONCLUSIVE: the run holds no state of ${body} after step ${MOTOR_STEP}; this is not a pass`];
  const rate = dot(s.angular, axis);
  return Math.abs(rate - MOTOR) <= WITHIN * MOTOR ? [] : [`${joint}: after 0.5 s (step ${MOTOR_STEP}) ${body} turns at ${fmt(rate)}°/s about the hinge, not ${MOTOR}°/s within 1%`];
}

// ---------------------------------------------------------------------------------------------------
// Criterion 5's judge.

/** Where the arm is from the hinge after step `k`. */
export const armAt = (run: Run, k: number): Vec3 => run.states[ARM]?.[k]?.pos ?? [NaN, NaN, NaN];
/** "At step 1 the body is at (0.7071, −0.7071) m from the hinge within 0.1 mm and stays there for 1 s": a failure naming the body and the first step it is off. */
export function placeFailures(run: Run): string[] {
  const off: number[] = [];
  for (let k = 1; k <= RATE; k++) if (!(far(armAt(run, k), PLACE) <= OPEN)) off.push(k);
  const first = off[0];
  if (first === undefined) return [];
  const p = armAt(run, first);
  return [`${ARM}: step ${first}: it is at (${fmt(p[0])}, ${fmt(p[1])}) m from the hinge, not (${fmt(PLACE[0])}, ${fmt(PLACE[1])}) m within 0.1 mm (${off.length} of the ${RATE} steps of its first second are off)`];
}

// ---------------------------------------------------------------------------------------------------
// The check (the base's `check` call: `{ok: true, issues: [{code, severity, ids, path, actual, what, …}]}`). An issue
// names a joint, or a joint's field, by its `path`: `joints/<ID>` or a path under it.

const segments = (path: JsonValue | undefined): string[] => (typeof path === 'string' ? path.split(/[/.]/).filter((s) => s !== '') : []);
const under = (issue: JsonObject, joint: string): boolean => { const p = segments(issue['path']); return p[0] === 'joints' && p[1] === joint; };
const brief = (issues: JsonObject[]): string => issues.map((i) => `${String(i['code'])} (${String(i['severity'])}) at ${String(i['path'])}, actual ${show(i['actual'], 60)}: ${String(i['what']).slice(0, 200)}`).join('; ') || 'none';
/** A check's issues; or, as text, why the reply isn't a check's. */
export function issuesOf(reply: JsonObject | undefined, what: string): JsonObject[] | string {
  if (reply?.['ok'] !== true || !Array.isArray(reply['issues'])) return `${what}: the check didn't answer {ok: true, issues}: ${show(reply, 400)}`;
  return reply['issues'].filter(isObject);
}
const errorsOf = (reply: JsonObject | undefined, what: string): JsonObject[] | string => {
  const all = issuesOf(reply, what);
  return typeof all === 'string' ? all : all.filter((i) => i['severity'] === 'error');
};
/** Everything wrong with an accepted world: any error its check raises. */
export function acceptedFailures(reply: JsonObject | undefined, what: string): string[] {
  const errors = errorsOf(reply, what);
  return typeof errors === 'string' ? [errors] : errors.length ? [`${what} isn't accepted at check: ${brief(errors)}`] : [];
}
/**
 * Everything wrong with a refusal of an articulated joint that breaks the tree, naming `joint`: no error of the code
 * `physics.articulation_tree` at `joints/<joint>`, or one at another joint of `others`.
 */
export function treeFailures(reply: JsonObject | undefined, joint: string, others: readonly string[], what: string): string[] {
  const errors = errorsOf(reply, what);
  if (typeof errors === 'string') return [errors];
  const tree = errors.filter((i) => i['code'] === TREE);
  const out: string[] = [];
  if (!tree.some((i) => under(i, joint))) out.push(`${joint}: ${what} isn't refused naming it: no error ${TREE} at joints/${joint} (its errors: ${brief(errors)})`);
  for (const other of others) if (tree.some((i) => under(i, other))) out.push(`${other}: ${what} is refused naming it, not ${joint} alone: ${brief(tree.filter((i) => under(i, other)))}`);
  return out;
}
/** Everything wrong with a refusal naming the field `joints/<joint>/<field>`: no error whose path is that field's. */
export function fieldFailures(reply: JsonObject | undefined, joint: string, field: string, what: string): string[] {
  const errors = errorsOf(reply, what);
  if (typeof errors === 'string') return [errors];
  const named = errors.some((i) => { const p = segments(i['path']); return under(i, joint) && p[2] === field && p.length === 3; });
  return named ? [] : [`joints/${joint}/${field}: ${what} isn't refused naming the field: no error has that path (its errors: ${brief(errors)})`];
}
/** Everything wrong with a refusal of a pair written `gap` m off its anchor, naming the joint and the gap: no error `physics.articulation_gap` at `joints/<joint>` whose `actual` is the gap in metres. */
export function gapFailures(reply: JsonObject | undefined, joint: string, gap: number, what: string): string[] {
  const errors = errorsOf(reply, what);
  if (typeof errors === 'string') return [errors];
  const named = errors.filter((i) => i['code'] === GAP && under(i, joint));
  if (named.length === 0) return [`${joint}: ${what} isn't refused naming it: no error ${GAP} at joints/${joint} (its errors: ${brief(errors)})`];
  return named.some((i) => typeof i['actual'] === 'number' && Math.abs(i['actual'] - gap) <= 1e-5) ? [] : [`${joint}: the refusal doesn't name the ${mm(gap)} mm gap: its actual isn't ${gap} (m) within 0.01 mm: ${brief(named)}`];
}
/** Everything wrong with a refusal by `backend`'s caps naming an articulated joint and the backend: no error `physics.backend_cap` at one of `joints` whose sentence names the backend. */
export function capFailures(reply: JsonObject | undefined, joints: readonly string[], backend: string, what: string): string[] {
  const errors = errorsOf(reply, what);
  if (typeof errors === 'string') return [errors];
  const named = errors.filter((i) => i['code'] === BACKEND_CAP && joints.some((j) => under(i, j)));
  if (named.length === 0) return [`${what} isn't refused with ${BACKEND_CAP} naming an articulated joint (${joints.join(', ')}); its errors: ${brief(errors)}`];
  return named.some((i) => typeof i['what'] === 'string' && i['what'].includes(backend)) ? [] : [`${what}: the refusal doesn't name the backend ${backend}: ${brief(named)}`];
}
/** A check's `physics.mass_ratio` issues. */
export function ratiosOf(reply: JsonObject | undefined, what: string): JsonObject[] | string {
  const all = issuesOf(reply, what);
  return typeof all === 'string' ? all : all.filter((i) => i['code'] === MASS_RATIO);
}
/** Whether a `physics.mass_ratio` issue names `id` (in its `ids`, or as a word of its sentence), as #523's suite reads it. */
export const namesId = (issue: JsonObject, id: string): boolean =>
  (Array.isArray(issue['ids']) && issue['ids'].includes(id)) || (typeof issue['what'] === 'string' && new RegExp(`\\b${id}\\b`).test(issue['what']));
/** Whether a `physics.mass_ratio` issue names the ratio within 1%: at `ratio`, `actual` or `actual.ratio`, or a number in its sentence. */
export function namesRatio(issue: JsonObject, ratio: number): boolean {
  const actual = issue['actual'];
  const read = [issue['ratio'], actual, isObject(actual) ? actual['ratio'] : undefined].filter((x): x is number => typeof x === 'number');
  if (typeof issue['what'] === 'string') read.push(...[...issue['what'].matchAll(/\d+(?:\.\d+)?/g)].map(([n]) => Number(n)));
  return read.some((x) => Math.abs(x - ratio) <= ratio * 0.01);
}

/** A backend's manifest (the base's `backend` call): its name and its caps() as cap names; or, as text, why the reply isn't one. */
export function manifestOf(reply: JsonObject | undefined, what: string): { backend: string; caps: string[] } | string {
  if (reply?.['ok'] !== true || typeof reply['backend'] !== 'string' || !Array.isArray(reply['caps'])) return `${what}: backend didn't answer {ok: true, backend, caps}: ${show(reply, 400)}`;
  return { backend: reply['backend'], caps: reply['caps'].map(String) };
}

// ---------------------------------------------------------------------------------------------------
// The behavior kit (README: The fixtures in the behavior kit), read from the base's `behavior_fixtures` and
// `behavior_kit`.

export const LOADED_CHAIN = 'articulated/loaded_chain';
export const SWUNG_CHAIN = 'articulated/swing';
export const ON_ARTICULATED = { pendulum: 'articulated/pendulum_period', limit: 'articulated/hinge_limit', motor: 'articulated/hinge_motor' } as const;
/** The kit's fixtures on separate joints, at the base. */
export const ON_SEPARATE = { pendulum: 'pendulum_period', limit: 'hinge_limit', motor: 'hinge_motor' } as const;

export interface Fixture { name: string; world: JsonObject; steps: number; track: JsonValue; answer: number | null; tolerance: JsonValue; caps: string[] }
/** The fixture named `name`, held exactly once; or, as text, how often the kit's data holds it. */
export function fixtureNamed(reply: JsonObject | undefined, name: string): Fixture | string {
  if (reply?.['ok'] !== true || !Array.isArray(reply['fixtures'])) return `behavior_fixtures didn't answer {ok: true, fixtures}: ${show(reply, 400)}`;
  const all = reply['fixtures'].filter(isObject);
  const mine = all.filter((f) => f['name'] === name);
  if (mine.length !== 1) {
    const near = all.map((f) => String(f['name'])).filter((n) => n.startsWith('articulated') || Object.values(ON_SEPARATE).includes(n as 'hinge_limit'));
    return `${name}: the kit's data holds it ${mine.length} times, not once; of its ${all.length} fixtures, those on joints: ${near.join(', ') || 'none'}`;
  }
  const f = mine[0]!;
  return {
    name, world: isObject(f['world']) ? f['world'] : {}, steps: typeof f['steps'] === 'number' ? f['steps'] : 0, track: f['track'] ?? [],
    answer: typeof f['answer'] === 'number' ? f['answer'] : null, tolerance: f['tolerance'] ?? null, caps: Array.isArray(f['caps']) ? f['caps'].map(String) : [],
  };
}
/** A bake of a fixture's own world over its own steps and track, reading every body. */
export const bakeFixture = (f: Fixture): JsonObject => bake(f.world, f.steps, { track: f.track });

export interface KitRow { backend: string; result: string; measured: number | null; answer: number | null; tolerance: JsonValue; what: string }
/** The kit's one row for `fixture`; or, as text, why there isn't one. */
export function rowOf(reply: JsonObject | undefined, fixture: string, what: string): KitRow | string {
  if (reply?.['ok'] !== true || !Array.isArray(reply['results'])) return `${what}: behavior_kit didn't answer {ok: true, results}: ${show(reply, 400)}`;
  const rows = reply['results'].filter(isObject).filter((r) => r['fixture'] === fixture);
  const r = rows[0];
  if (rows.length !== 1 || !r) return `${fixture}: ${what} holds it ${rows.length} times, not once`;
  return {
    backend: String(r['backend']), result: String(r['result']), measured: typeof r['measured'] === 'number' ? r['measured'] : null,
    answer: typeof r['answer'] === 'number' ? r['answer'] : null, tolerance: r['tolerance'] ?? null, what: typeof r['what'] === 'string' ? r['what'] : '',
  };
}
/** How the kit holds a measure to an answer: within `room` of it both ways, or never past it by more than `room`. */
export interface Held { answer: number; printed: string; tolerance: JsonObject; room: number; neverPast?: boolean }
export const HELD = {
  chain: { answer: REACH, printed: '1.05 m', tolerance: { m: OPEN }, room: OPEN },
  swing: { answer: LOWEST_SPEED, printed: '√(2 × 9.81 × 1.05) = 4.539 m/s', tolerance: { relative: WITHIN }, room: WITHIN * LOWEST_SPEED },
  pendulum: { answer: PERIOD, printed: '2.010 s', tolerance: { relative: WITHIN }, room: WITHIN * PERIOD },
  limit: { answer: LIMIT, printed: '30°', tolerance: { deg: 0.5 }, room: 0.5, neverPast: true },
  motor: { answer: MOTOR, printed: '90°/s', tolerance: { relative: WITHIN }, room: WITHIN * MOTOR },
} as const satisfies Record<string, Held>;
/**
 * Everything wrong with a fixture's answer, tolerance and caps: the answer the issue prints (to half a unit of its
 * last printed digit, 0.0005), its tolerance as the issue gives it, and `caps` naming `articulations`.
 */
export function heldFailures(f: Fixture, h: Held): string[] {
  const out: string[] = [];
  if (f.answer === null || Math.abs(f.answer - h.answer) > 0.0005) out.push(`${f.name}: its answer ${show(f.answer)} isn't the issue's ${h.printed}`);
  if (JSON.stringify(f.tolerance) !== JSON.stringify(h.tolerance)) out.push(`${f.name}: its tolerance ${show(f.tolerance)} isn't the issue's, ${show(h.tolerance)}`);
  if (!f.caps.includes(CAP)) out.push(`${f.name}: its caps ${show(f.caps)} don't name ${CAP}, so a backend without articulations would run it`);
  return out;
}
/** Everything wrong with the kit's row for `f` read as a pass on the reference backend: `pass`, the interface's answer and tolerance, and a measure the tolerance admits. */
export function passFailures(report: JsonObject | undefined, f: Fixture, h: Held): string[] {
  const r = rowOf(report, f.name, 'the kit\'s report');
  if (typeof r === 'string') return [r];
  const out: string[] = [];
  if (r.backend !== REFERENCE) out.push(`${f.name}: the row's backend is ${r.backend}, not ${REFERENCE}`);
  if (r.result !== 'pass') out.push(`${f.name} reads ${r.result} on ${r.backend}, not pass: ${r.what}`);
  if (r.answer !== f.answer || JSON.stringify(r.tolerance) !== JSON.stringify(f.tolerance)) out.push(`${f.name}: the row's answer and tolerance ${show(r.answer)} ${show(r.tolerance)} aren't the interface's ${show(f.answer)} ${show(f.tolerance)}`);
  const ok = r.measured !== null && (h.neverPast ? r.measured <= h.answer + h.room + 1e-9 : Math.abs(r.measured - h.answer) <= h.room + 1e-9);
  if (!ok) out.push(`${f.name}: measured ${show(r.measured)} on ${r.backend}, ${h.neverPast ? `past ${fmt(h.answer + h.room)}` : `outside ${fmt(h.answer)} ± ${fmt(h.room)}`}`);
  return out;
}

/** A body's mass as its world writes it: declared, else the volume of its sphere, box, capsule and cylinder shapes times each one's density; null when it can't be told. */
function massOf(w: JsonObject, id: string): number | null {
  const body = section(w, 'bodies')[id];
  if (!isObject(body)) return null;
  if (typeof body['mass'] === 'number') return body['mass'];
  let total = 0;
  for (const u of Array.isArray(body['shapes']) ? body['shapes'] : []) {
    const shape = isObject(u) ? section(w, 'shapes')[String(u['shape'])] : undefined;
    const material = isObject(u) ? section(w, 'contact_materials')[String(u['contact_material'])] : undefined;
    const density = isObject(material) ? material['density'] : undefined;
    if (!isObject(shape) || typeof density !== 'number') return null;
    const [r, hh, half] = [shape['radius'], shape['half_height'], numbers(shape['half'], 3)];
    let volume: number;
    if (shape['kind'] === 'sphere' && typeof r === 'number') volume = (4 / 3) * Math.PI * r ** 3;
    else if (shape['kind'] === 'box' && half) volume = 8 * half[0]! * half[1]! * half[2]!;
    else if (shape['kind'] === 'capsule' && typeof r === 'number' && typeof hh === 'number') volume = Math.PI * r * r * (2 * hh) + (4 / 3) * Math.PI * r ** 3;
    else if (shape['kind'] === 'cylinder' && typeof r === 'number' && typeof hh === 'number') volume = Math.PI * r * r * (2 * hh);
    else return null;
    total += volume * density;
  }
  return total;
}
/** Whether body `id` weighs `kg`, to 0.1%. */
const weighs = (w: JsonObject, id: string, kg: number): boolean => { const m = massOf(w, id); return m !== null && Math.abs(m - kg) <= 1e-3 * kg; };
const dynamicIds = (w: JsonObject): string[] => bodyIds(w).filter((id) => { const b = section(w, 'bodies')[id]; return isObject(b) && b['kind'] === 'dynamic'; });
const gravityOf = (w: JsonObject): Vec3 => (numbers(w['gravity'], 3) ?? [0, -G, 0]) as Vec3;
const jointOf = (w: JsonObject, id: string): JsonObject => { const j = section(w, 'joints')[id]; return isObject(j) ? j : {}; };
const sphereOf = (w: JsonObject, id: string): number | null => {
  const b = section(w, 'bodies')[id];
  const uses = isObject(b) && Array.isArray(b['shapes']) ? b['shapes'] : [];
  const shape = uses.length === 1 && isObject(uses[0]) ? section(w, 'shapes')[String(uses[0]['shape'])] : undefined;
  return isObject(shape) && shape['kind'] === 'sphere' && typeof shape['radius'] === 'number' ? shape['radius'] : null;
};
/** Everything about a fixture's world that isn't at the kit's 120 Hz, 4 substeps and g = 9.81 m/s², or whose joints aren't all `articulated: true`. */
function settingFailures(f: Fixture): string[] {
  const w = f.world;
  const out: string[] = [];
  if ((w['step_rate'] ?? RATE) !== RATE || (w['substeps'] ?? SUBSTEPS) !== SUBSTEPS) out.push(`${f.name}: its world isn't at ${RATE} Hz and ${SUBSTEPS} substeps: ${show({ step_rate: w['step_rate'] ?? null, substeps: w['substeps'] ?? null })}`);
  if (!(Math.abs(norm(gravityOf(w)) - G) <= 1e-9)) out.push(`${f.name}: its gravity ${show(w['gravity'])} isn't ${G} m/s²`);
  const joints = jointIds(w);
  if (joints.length === 0) out.push(`${f.name}: its world holds no joint`);
  for (const id of joints) if (jointOf(w, id)[FIELD] !== true) out.push(`${f.name}: its joint ${id} isn't written ${FIELD}: true`);
  return out;
}

/** A kit fixture's chain as its world writes it: its bob, its fixed point and its line. */
export interface ChainData { failures: string[]; hung: Hung | null }
/**
 * Everything about a kit fixture's world that isn't the criterion's chain: ten links of 0.1 kg and 0.1 m on
 * articulated ball joints in a line from the world, a bob of `bob` kg and radius 0.05 m at its end with its centre
 * 1.05 m from the fixed point, at 120 Hz and 4 substeps, over 4 s at least; gravity along the chain, or with `level`
 * square to it.
 */
export function chainData(f: Fixture, bob: number, level: boolean): ChainData {
  const w = f.world;
  const out = settingFailures(f);
  if (!(f.steps >= STEPS)) out.push(`${f.name}: it runs ${f.steps} steps, short of the criterion's 4 s (${STEPS} steps)`);
  const dynamic = dynamicIds(w);
  const heavy = dynamic.filter((id) => weighs(w, id, bob));
  const light = dynamic.filter((id) => weighs(w, id, LINK_MASS));
  if (dynamic.length !== LINKS + 1 || light.length !== LINKS || heavy.length !== 1) {
    return { failures: [...out, `${f.name}: its world doesn't hold ten links of ${LINK_MASS} kg and one bob of ${bob} kg: its dynamic bodies' masses are ${show(dynamic.map((id) => massOf(w, id)))}`], hung: null };
  }
  const bobId = heavy[0]!;
  if (sphereOf(w, bobId) !== BOB_RADIUS) out.push(`${f.name}: its bob ${bobId} isn't one sphere of radius ${BOB_RADIUS} m`);
  const joints = jointIds(w);
  if (joints.length !== LINKS + 1 || joints.some((id) => jointOf(w, id)['kind'] !== 'ball')) out.push(`${f.name}: its world doesn't hold eleven ball joints: ${show(joints.map((id) => `${id}: ${String(jointOf(w, id)['kind'])}`))}`);
  // The line from the world: each joint's `b` is held by the joint before it.
  const ends = new Map(joints.map((id) => [id, { a: endOf(w, jointOf(w, id), 'a'), b: endOf(w, jointOf(w, id), 'b') }]));
  const root = joints.filter((id) => ends.get(id)!.a.body === null);
  if (root.length !== 1) return { failures: [...out, `${f.name}: ${root.length} of its joints hold a body to the world, not one`], hung: null };
  const line: string[] = [root[0]!];
  for (;;) {
    const held = ends.get(line.at(-1)!)!.b.body;
    const next = joints.find((id) => ends.get(id)!.a.body === held && !line.includes(id));
    if (next === undefined) break;
    line.push(next);
  }
  if (line.length !== joints.length || ends.get(line.at(-1)!)!.b.body !== bobId) out.push(`${f.name}: its joints don't run in one line from the world through the ten links to the bob: ${line.join(' → ')} ends at ${String(ends.get(line.at(-1)!)!.b.body)}`);
  const fixed = ends.get(root[0]!)!.a.anchor;
  const at = (id: string, side: 'a' | 'b'): Vec3 => writtenPoint(w, ends.get(id)![side]);
  for (const [i, id] of line.entries()) {
    const gap = far(at(id, 'a'), at(id, 'b'));
    if (!(gap <= 1e-6)) out.push(`${f.name}: its joint ${id}'s anchors are ${mm(gap)} mm apart as written`);
    const next = line[i + 1];
    if (next !== undefined && !(Math.abs(far(at(id, 'b'), at(next, 'a')) - LINK) <= 1e-6)) out.push(`${f.name}: the link between ${id} and ${next} is ${fmt(far(at(id, 'b'), at(next, 'a')))} m long, not ${LINK} m`);
  }
  const centre = writtenPose(section(w, 'bodies')[bobId]).pos;
  const reach = far(centre, fixed);
  if (!(Math.abs(reach - REACH) <= 1e-6)) out.push(`${f.name}: its bob's centre is written ${fmt(reach)} m from the fixed point, not ${REACH} m`);
  const along = sub(centre, fixed).map((x) => x / reach) as Vec3;
  const cos = dot(along, gravityOf(w)) / G;
  if (level ? !(Math.abs(cos) <= 1e-6) : !(cos >= 1 - 1e-9)) out.push(`${f.name}: its gravity ${show(w['gravity'])} isn't ${level ? 'square to the chain as written, so it isn\'t let go level' : 'along the chain as written, so it doesn\'t hang at rest'}`);
  return { failures: out, hung: { bob: bobId, fixed, along } };
}

/** The one joint of a kit fixture's world and the body it holds to the world; or, as text, that it isn't one joint from the world to one dynamic body. */
export function oneJoint(f: Fixture): { joint: string; body: string; anchor: Vec3; axis: Vec3; fields: JsonObject } | string {
  const w = f.world;
  const [joints, dynamic] = [jointIds(w), dynamicIds(w)];
  const j = jointOf(w, joints[0] ?? '');
  const [a, b] = [endOf(w, j, 'a'), endOf(w, j, 'b')];
  if (joints.length !== 1 || dynamic.length !== 1 || a.body !== null || b.body !== dynamic[0]) return `${f.name}: its world isn't one joint from the world to its one dynamic body: joints ${show(joints)}, dynamic bodies ${show(dynamic)}`;
  const frame = j['frame_a'];
  const axis = (numbers(isObject(frame) ? frame['axis'] : undefined, 3) ?? [1, 0, 0]) as Vec3;
  return { joint: joints[0]!, body: dynamic[0]!, anchor: a.anchor, axis: axis.map((x) => x / norm(axis)) as Vec3, fields: j };
}
/** The kit's pendulum as its world writes it: its ball, its anchor and the level direction it is released toward; null when it isn't one joint to the world. */
export function releasedIn(f: Fixture): Released | null {
  const one = oneJoint(f);
  if (typeof one === 'string') return null;
  const from = sub(writtenPose(section(f.world, 'bodies')[one.body]).pos, one.anchor);
  const down = gravityOf(f.world).map((x) => x / G) as Vec3;
  const level = sub(from, down.map((x) => x * dot(from, down)) as Vec3);
  return { bob: one.body, anchor: one.anchor, side: level.map((x) => x / norm(level)) as Vec3 };
}
/** Everything about the kit's pendulum on an articulated joint that isn't the criterion's: a 1 kg ball on a 1 m ball joint to the world, written 10° from hanging, at rest. */
export function pendulumData(f: Fixture): string[] {
  const out = settingFailures(f);
  const one = oneJoint(f);
  if (typeof one === 'string') return [...out, one];
  const w = f.world;
  if (one.fields['kind'] !== 'ball') out.push(`${f.name}: its joint ${one.joint} is a ${String(one.fields['kind'])} joint, not a ball joint`);
  const m = massOf(w, one.body);
  if (!weighs(w, one.body, 1) || sphereOf(w, one.body) === null) out.push(`${f.name}: ${one.body} isn't a 1 kg ball (its mass: ${show(m)} kg)`);
  const from = sub(writtenPose(section(w, 'bodies')[one.body]).pos, one.anchor);
  if (!(Math.abs(norm(from) - 1) <= 1e-4)) out.push(`${f.name}: ${one.body}'s centre is written ${fmt(norm(from))} m from its anchor, not 1 m`);
  const angle = Math.acos(Math.min(1, dot(from, gravityOf(w)) / (norm(from) * G))) / RAD;
  if (!(Math.abs(angle - SWING) <= 1e-3)) out.push(`${f.name}: ${one.body} is written ${fmt(angle)}° from hanging, not released from ${SWING}°`);
  const velocity = section(section(w, 'bodies')[one.body] as JsonObject, 'velocity');
  if (['linear', 'angular'].some((k) => Array.isArray(velocity[k]) && (velocity[k] as JsonValue[]).some((x) => x !== 0))) out.push(`${f.name}: ${one.body} isn't released at rest: ${show(velocity)}`);
  return out;
}
/** Everything about the kit's hinge limit on an articulated joint that isn't the criterion's: one hinge to the world limited to ±30°, under gravity. */
export function limitData(f: Fixture): string[] {
  const out = settingFailures(f);
  const one = oneJoint(f);
  if (typeof one === 'string') return [...out, one];
  if (one.fields['kind'] !== 'hinge') out.push(`${f.name}: its joint ${one.joint} is a ${String(one.fields['kind'])} joint, not a hinge`);
  const limits = section(one.fields, 'limits');
  if (limits['min'] !== -LIMIT || limits['max'] !== LIMIT) out.push(`${f.name}: its hinge's limits are ${show(one.fields['limits'])}, not ±${LIMIT}°`);
  return out;
}
/** Everything about the kit's hinge motor on an articulated joint that isn't the criterion's: one hinge to the world with a velocity motor set to 90°/s. */
export function motorData(f: Fixture): string[] {
  const out = settingFailures(f);
  const one = oneJoint(f);
  if (typeof one === 'string') return [...out, one];
  if (one.fields['kind'] !== 'hinge') out.push(`${f.name}: its joint ${one.joint} is a ${String(one.fields['kind'])} joint, not a hinge`);
  const motor = section(one.fields, 'motor');
  if ((motor['mode'] ?? 'velocity') !== 'velocity' || motor['target'] !== MOTOR) out.push(`${f.name}: its hinge's motor is ${show(one.fields['motor'])}, not a velocity motor set to ${MOTOR}°/s`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Step hashes side by side (criterion 7): a seek from each checkpoint against the straight run, and two builds' runs.

/** A body's canonical fields in canonical order (Checkpoint ring: `hash`). */
const FIELDS = ['pos', 'rot', 'linear', 'angular'] as const;
/** The steps of the checkpoints a bake kept (`checkpoints: true`); or, as text, that it lists none. */
export function checkpointsOf(reply: JsonObject | undefined, what: string): number[] | string {
  const kept = reply && Array.isArray(reply['checkpoints']) ? reply['checkpoints'].filter(isObject).map((c) => c['step']) : null;
  if (!kept || kept.length === 0 || !kept.every((s): s is number => typeof s === 'number')) return `INCONCLUSIVE: ${what} lists no checkpoints to seek from: ${show(reply?.['checkpoints'], 200)}; this is not a pass`;
  return kept;
}
/**
 * Everything wrong with a seek from the checkpoint at step `from`, played on to the straight run's end: it restored
 * another step, or a state or a step hash after it isn't the straight run's. The failure names the first step that
 * differs and, there, the first body in canonical order and its field.
 */
export function seekFailures(w: JsonObject, straight: Run, sought: JsonObject | undefined, from: number): string[] {
  const what = `the seek from the checkpoint at step ${from}`;
  if (sought?.['ok'] !== true) return [`${what} didn't answer: ${refusal(sought)}`];
  if (sought['from'] !== from) return [`${what} restored step ${show(sought['from'])}, not ${from}`];
  const last = straight.hashes.length - 1;
  const run = runOf(w, sought, what, last - from + 1);
  if (typeof run === 'string') return [run];
  for (let i = 0; i <= last - from; i++) {
    const k = from + i;
    for (const id of bodyIds(w)) {
      const [here, there] = [run.states[id]![i]!, straight.states[id]![k]!];
      const field = FIELDS.find((f) => here[f].some((x, n) => !Object.is(x, there[f][n])));
      if (field) return [`${what}: step ${k}: ${id} ${field} is ${show(here[field])} after the seek and ${show(there[field])} in the straight run`];
    }
    if (run.hashes[i] !== straight.hashes[k]) return [`${what}: step ${k}: its step hash is ${run.hashes[i]!} after the seek and ${straight.hashes[k]!} in the straight run, though no body's state differs`];
  }
  return [];
}
/** A golden as the base's `golden` call records it; or, as text, why the reply holds none. */
export function goldenOf(reply: JsonObject | undefined, what: string): JsonObject | string {
  const g = reply?.['golden'];
  return reply?.['ok'] === true && isObject(g) ? g : `${what} isn't recorded: ${refusal(reply)}`;
}
/** Everything that differs between two runs' step hashes of one world; the failure names the first step. */
export function sameFailures(here: readonly string[], there: readonly string[], what: string, other: string): string[] {
  if (here.length !== there.length) return [`${what}: ${here.length} step hashes here and ${there.length} ${other}`];
  const k = here.findIndex((h, i) => h !== there[i]);
  return k < 0 ? [] : [`${what}: the step hash at step ${k} is ${here[k]!} here and ${String(there[k])} ${other}`];
}
/** A comparison of hashes proves nothing unless the hash follows the bodies: the steps from 1 on whose hash repeats the step before's. */
export const repeats = (hashes: readonly string[]): number[] => hashes.flatMap((h, k) => (k > 0 && h === hashes[k - 1] ? [k] : []));
