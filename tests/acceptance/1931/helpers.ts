// Test-side tools for the #1931 acceptance tests (README: The surface under test). They drive the physics runner
// `deep-physics` (JSON lines in, one reply per line) through #191's builds, as #2241's suite does, and add only this
// issue's worlds, its planted names, its test backend and its judges. Nothing here stands in for the check, a force
// law, the behavior kit or a backend: every issue, body state and kit row read here is the implementation's own, and
// every expected value is the issue's, copied or worked here from the closed form it gives.
//
// No function here asserts. What a program answers and what a judge finds wrong with it both come back as text, so
// each test's failing assertion is in its own file. Only a process that can't be run at all throws, `BLOCKED:` or
// `INCONCLUSIVE:` first, as the base's suites do: nothing unrun passes.

import { spawnSync } from 'node:child_process';
import {
  CARGO_ENV, RATE, REPO, TIMEOUT, WASM32_SCRIPT, isObject, physicsBin, show, sphere, use, world,
  type JsonObject, type JsonValue, type KitResult, type PhysicsBuild, type Vec3,
} from '../191/helpers.ts';

export {
  RATE, REFERENCE, TIMEOUT, WASM32, kitCall, prebuild, show, type JsonObject, type JsonValue, type KitResult, type Vec3,
} from '../191/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#1931.1a76985e', 2: '#1931.b13f64e3', 3: '#1931.a7ffb5c9', 4: '#1931.e8d79a14', 5: '#1931.02a6e7e5', 6: '#1931.f0905250',
} as const;

/** This suite's planted names (`deep-physics --planted <name>`): each criterion's wrong program, and criterion 6's kit (README). */
export type Planted =
  | 'inverse_square_one_over_r' | 'check_admits_force_substeps' | 'magnetic_force_held' | 'magnetic_b_cross_v'
  | 'lennard_jones_no_factor_2' | 'lennard_jones_no_cutoff' | 'kit_without_force_law_fixtures';
/** This suite's test backend (`deep-physics --backend <name>` in the `test-backends` build): Rapier as a candidate claiming the three laws. */
export type TestBackend = 'claims_force_laws';
export const CLAIMS_LAWS: TestBackend = 'claims_force_laws';
/** Criterion 6's kit with the three force-law fixtures taken out, started beside the test backend. */
export const KIT_WITHOUT: Planted = 'kit_without_force_law_fixtures';

// ---------------------------------------------------------------------------------------------------
// The runner: this checkout's release build (#191's `release`), its `test-backends` build, and its wasm32 build.

export interface Runner { planted?: Planted; backend?: TestBackend; build?: PhysicsBuild }
/**
 * What one process answered: `problem` is '' and `replies` holds one object per call, or `problem` says what the
 * program did instead (a name it doesn't know exits 2 with `bad_input`).
 */
export interface Asked { what: string; problem: string; replies: JsonObject[] }

const MINUTES = (TIMEOUT - 300_000) / 60_000;
function runOn(bin: string, args: string[], calls: JsonObject[], what: string, env?: NodeJS.ProcessEnv): Asked {
  const run = spawnSync(bin, args, {
    cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: TIMEOUT - 300_000,
    killSignal: 'SIGKILL', ...(env ? { env } : {}),
  });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  const no = (problem: string): Asked => ({ what, problem, replies: [] });
  if (code === 'ETIMEDOUT') throw Error(`INCONCLUSIVE: ${what} didn't finish within ${MINUTES} minutes`);
  if (run.error && code !== 'EPIPE') throw Error(`BLOCKED: ${what} couldn't be run: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  // The wasm32 script exits 1 before it answers anything when its library doesn't build: nothing ran.
  if (run.status !== 0 && /cargo rustc for \S+ failed/.test(run.stderr ?? '')) throw Error(`BLOCKED: ${what} has no build to run: ${(run.stderr ?? '').trim().slice(-600)}`);
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
 * the `test-backends` build for a test backend. A name the build doesn't know comes back as `problem`, never a throw.
 */
export function ask(calls: JsonObject[], r: Runner = {}): Asked {
  const args = [...(r.backend ? ['--backend', r.backend] : []), ...(r.planted ? ['--planted', r.planted] : [])];
  return runOn(physicsBin(r.build ?? (r.backend ? 'test' : 'release')), args, calls, `deep-physics ${args.join(' ')}`.trim());
}
/** The same calls through the physics crate built for wasm32-unknown-unknown (`node scripts/physics-wasm32.mjs`, #2012's). */
export function askWasm32(calls: JsonObject[]): Asked {
  return runOn(process.execPath, [WASM32_SCRIPT], calls, 'deep-physics on wasm32 (node scripts/physics-wasm32.mjs)', { ...process.env, ...CARGO_ENV });
}

// ---------------------------------------------------------------------------------------------------
// The issue's numbers. Each is the issue's value or its closed form, worked here; the tests hold each to the digits
// the issue prints.

/** "For 8 s", "for 5 s", "at 10 s": steps at 120 Hz; a body's state after step k is at index k. */
export const ORBIT_STEPS = 8 * RATE;
export const GYRATION_STEPS = 5 * RATE;
export const PAIR_STEPS = 10 * RATE;

/** Criterion 1: `inverse_square {k: −4π² N·m²}`, a 2 kg body 2 m from the point, launched at π m/s square to the line. */
export const K = -4 * Math.PI ** 2;
export const ORBIT_MASS = 2;
export const ORBIT_RADIUS = 2;
export const LAUNCH = Math.PI;
/** 2π√(m r³ ÷ |k|) = 4.000 s: when the body first comes back to its start line. */
export const ORBIT_PERIOD = 2 * Math.PI * Math.sqrt((ORBIT_MASS * ORBIT_RADIUS ** 3) / Math.abs(K));
/** "Within its first turn": the steps of one period. */
export const FIRST_TURN = ORBIT_PERIOD * RATE;
/** The planted 1 ÷ r law "leaves the 1% band within its first 12 steps" and "falls to 1.067 m". */
export const FIRST_STEPS = 12;
export const FALLS_TO = 1.067;

/** Criterion 3: `magnetic {field: (0, 0, 3) T, charge: 2 C}`, a 1 kg body started at the origin at (3, 0, 0) m/s. */
export const FIELD: Vec3 = [0, 0, 3];
export const CHARGE = 2;
export const ION_MASS = 1;
export const ION_SPEED = 3;
/** m·v ÷ (q·B) = 0.5 m and 2π·m ÷ (q·B) = 1.047 s: the circle's radius and the time of one turn. */
export const GYRATION_RADIUS = (ION_MASS * ION_SPEED) / (CHARGE * FIELD[2]);
export const GYRATION_TURN = (2 * Math.PI * ION_MASS) / (CHARGE * FIELD[2]);
/** The path "stays between y = −1.000 m and 0 m". */
export const Y_LOW = -1;
export const Y_HIGH = 0;
/** The planted law that holds q (v × B) over the step "reaches 6.345 m/s at 5 s and y = −1.514 m". */
export const HELD_SPEED = 6.345;
export const HELD_Y = -1.514;

/** Criterion 4: `lennard_jones {epsilon: 1 J, sigma: 0.5 m, cutoff: 1.25 m}` and `drag {linear: 2}` on two 1 kg bodies. */
export const EPSILON = 1;
export const SIGMA = 0.5;
export const CUTOFF = 1.25;
export const DRAG_LINEAR = 2;
/** Released at rest 0.7 m apart, and 1.3 m apart, past the cutoff. */
export const APART = 0.7;
export const PAST_CUTOFF = 1.3;
/** 2^(1/6) × σ = 0.5612 m: where the pair rests. */
export const REST = 2 ** (1 / 6) * SIGMA;
/** The planted law without the factor 2 "rests them at 0.500 m"; the one without the cutoff "closes them to 0.561 m". */
export const NO_FACTOR_REST = 0.5;
export const NO_CUTOFF_CLOSES = 0.561;

/** The criteria's bounds: 1% of a distance, a radius or a period, 0.1% of a speed, 0.5% of the rest distance. */
export const WITHIN = 0.01;
export const SPEED_WITHIN = 0.001;
export const REST_WITHIN = 0.005;
/** Half a unit of the last digit of a number the issue prints to the millimetre (1.067 m, 6.345 m/s, −1.514 m, 0.500 m, 0.561 m, −1.000 m). */
export const PRINTED = 0.0005;
/** "Still 1.3 m apart": to the micron, since a pair past the cutoff takes no force. */
export const STILL = 1e-6;

/** A length or a speed to the millimetre the issue prints, a read under half a millimetre printing as 0.000. */
export const mm3 = (x: number): string => (Math.abs(x) < PRINTED ? 0 : x).toFixed(3);
/** The same with its sign written, as the issue writes +1.000 m. */
export const signed = (x: number): string => (Math.abs(x) < PRINTED ? '0.000' : `${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(3)}`);

// ---------------------------------------------------------------------------------------------------
// The worlds (README: The worlds). Each on #191's `world` defaults (120 Hz, gravity (0, −9.81, 0), backend rapier3d
// =0.36.1) at `substeps: 1` unless a test says otherwise; every body a dynamic sphere of radius 0.1 m with its `mass`
// written, `gravity_scale: 0` and `sleep: false`. A force is written as the base writes one:
// `forces: {<ID>: {kind: {<law>: {fields}}, applies_to: [body ID]}}`.

const BALL = 'ball';
const lab = (parts: JsonObject, substeps = 1): JsonObject => world({ substeps, shapes: { [BALL]: sphere(0.1) }, ...parts });
const free = (pos: Vec3, mass: number, linear?: Vec3): JsonObject => ({
  kind: 'dynamic', shapes: [use(BALL)], pose: { pos }, mass, gravity_scale: 0, sleep: false, ...(linear ? { velocity: { linear } } : {}),
});
const force = (law: string, fields: JsonObject, appliesTo: string[]): JsonObject => ({ kind: { [law]: fields }, applies_to: appliesTo });

/** The orbit: body `moon` at (2, 0, 0) m, launched at (0, π, 0) m/s, under force `sun_pull`, an `inverse_square` about the origin. */
export const MOON = 'moon';
export const PULL = 'sun_pull';
export const ORBIT_POINT: Vec3 = [0, 0, 0];
/** A `min_distance` the body never comes inside, written so the field is never the one in question; criterion 5 writes 0. */
export const MIN_DISTANCE = 0.1;
export function orbitWorld(o: { substeps?: number; minDistance?: number } = {}): JsonObject {
  return lab({
    bodies: { [MOON]: free([ORBIT_RADIUS, 0, 0], ORBIT_MASS, [0, LAUNCH, 0]) },
    forces: { [PULL]: force('inverse_square', { point: ORBIT_POINT, k: K, min_distance: o.minDistance ?? MIN_DISTANCE }, [MOON]) },
  }, o.substeps ?? 1);
}

/** The gyration: body `ion` at the origin at (3, 0, 0) m/s under force `ion_turn`, a `magnetic` law. */
export const ION = 'ion';
export const TURN = 'ion_turn';
export function gyrationWorld(): JsonObject {
  return lab({
    bodies: { [ION]: free([0, 0, 0], ION_MASS, [ION_SPEED, 0, 0]) },
    forces: { [TURN]: force('magnetic', { field: FIELD, charge: CHARGE }, [ION]) },
  });
}

/** The pair: bodies `left` and `right` at rest `apart` m apart along x, under `pair_bond`, a `lennard_jones` law, and `pair_drag`, a `drag`. */
export const LEFT = 'left';
export const RIGHT = 'right';
export const BOND = 'pair_bond';
export const DRAG = 'pair_drag';
const bond = (sigma: number): JsonObject => ({ epsilon: EPSILON, sigma, cutoff: CUTOFF });
export function pairWorld(apart: number, o: { sigma?: number } = {}): JsonObject {
  return lab({
    bodies: { [LEFT]: free([-apart / 2, 0, 0], 1), [RIGHT]: free([apart / 2, 0, 0], 1) },
    forces: {
      [BOND]: force('lennard_jones', bond(o.sigma ?? SIGMA), [LEFT, RIGHT]),
      [DRAG]: force('drag', { linear: DRAG_LINEAR }, [LEFT, RIGHT]),
    },
  });
}

/** `count` bodies at rest 2 m apart on a grid, every one named in the `applies_to` of `pair_bond`, a `lennard_jones` law. */
export function crowdWorld(count: number): JsonObject {
  const ids = Array.from({ length: count }, (_, i) => `atom${String(i).padStart(3, '0')}`);
  const bodies: JsonObject = {};
  for (const [i, id] of ids.entries()) bodies[id] = free([2 * (i % 17), 2 * Math.floor(i / 17), 0], 1);
  return lab({
    capacity: { bodies: 512, shapes: 512, joints: 0, contacts: 1024, particles: 0 },
    bodies,
    forces: { [BOND]: force('lennard_jones', bond(SIGMA), ids) },
  });
}

export const check = (w: JsonObject): JsonObject => ({ call: 'check', world: w });
/** `read` lists the bodies whose states come back, one per step from the built state at index 0. */
export const bake = (w: JsonObject, steps: number, read: string[]): JsonObject => ({ call: 'bake', world: w, steps, read });

// ---------------------------------------------------------------------------------------------------
// Reading a bake (the base's `bake` call: `bodies.<ID>[k]` is the state after step k). The measures are read from
// these states and from nothing else.

export interface State { pos: Vec3; linear: Vec3 }
const numbers = (v: JsonValue | undefined, n: number): number[] | null =>
  (Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : null);
/** Why a reply isn't a bake, in its own words: its issues' codes, paths and sentences. */
export function refusal(reply: JsonObject): string {
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  return issues.length ? issues.map((i) => `${String(i['code'])} at ${String(i['path'])}: ${String(i['what'])}`).join('; ') : show(reply);
}
/** An accepted bake's states of body `id`, the built one and one for each of `steps` steps; or, as text, why there are none. */
export function statesOf(reply: JsonObject, id: string, steps: number, what: string): State[] | string {
  if (reply['ok'] !== true) return `${what} isn't baked: ${refusal(reply)}`;
  const series = isObject(reply['bodies']) ? reply['bodies'][id] : undefined;
  if (!Array.isArray(series)) return `${what}: the bake lists no states of body ${id}: ${show(reply['bodies'])}`;
  if (series.length !== steps + 1) return `${what}: ${id} has ${series.length} states, not the built one and one for each of ${steps} steps`;
  const out: State[] = [];
  for (const [k, v] of series.entries()) {
    const s = isObject(v) ? v : {};
    const [pos, linear] = [numbers(s['pos'], 3), numbers(s['linear'], 3)];
    if (!pos || !linear) return `${what}: bodies.${id}[${k}] isn't {pos, linear, …}: ${show(v)}`;
    out.push({ pos: pos as Vec3, linear: linear as Vec3 });
  }
  return out;
}

const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const norm = (a: readonly number[]): number => Math.hypot(a[0]!, a[1]!, a[2]!);

// ---------------------------------------------------------------------------------------------------
// Criteria 1 and 2: the orbit.

/** An orbit read from a body's states about `point`. */
export interface Orbit {
  /** The body's distance from the point after each step, m. */
  r: number[];
  /** The first step whose distance is outside 2 m within 1%; null when none is. */
  left: number | null;
  /** The step whose distance is farthest from 2 m. */
  far: number;
  /** When the body first comes back to its start line, s from the launch; null when it doesn't in the run. */
  returned: number | null;
  /** ½·m·|v|² + k ÷ r after each step, J, with the criterion's m and k. */
  energy: number[];
}
/**
 * Reads the orbit of body `id` about `point`. The start line runs from the point through where the body was built; the
 * body is back on it when the angle it has swept about the point, in the plane of that line and its launch, reaches a
 * whole turn. The time is taken on the straight line between the two steps around that moment.
 */
export function orbitOf(reply: JsonObject, id: string, point: Vec3, what: string): Orbit | string {
  const states = statesOf(reply, id, ORBIT_STEPS, what);
  if (typeof states === 'string') return states;
  const from = sub(states[0]!.pos, point);
  const [reach, speed] = [norm(from), norm(states[0]!.linear)];
  if (!(reach > 0) || !(speed > 0)) return `${what}: ${id} is built on the point or at rest, so it has no start line or launch: ${show(states[0] as unknown as JsonValue)}`;
  const e1 = from.map((x) => x / reach);
  const along = dot(states[0]!.linear, e1);
  const across = states[0]!.linear.map((x, i) => x - along * e1[i]!);
  if (!(norm(across) > 0)) return `${what}: ${id} is launched along its start line, not across it`;
  const e2 = across.map((x) => x / norm(across));
  const r = states.map((s) => norm(sub(s.pos, point)));
  const off = (k: number): number => Math.abs(r[k]! - ORBIT_RADIUS);
  let [left, far]: [number | null, number] = [null, 0];
  for (let k = 1; k < r.length; k += 1) {
    if (left === null && off(k) > WITHIN * ORBIT_RADIUS) left = k;
    if (off(k) > off(far)) far = k;
  }
  let [swept, last]: [number, number] = [0, 0];
  let returned: number | null = null;
  for (let k = 1; k < states.length && returned === null; k += 1) {
    const d = sub(states[k]!.pos, point);
    const angle = Math.atan2(dot(d, e2), dot(d, e1));
    let turned = angle - last;
    if (turned <= -Math.PI) turned += 2 * Math.PI;
    if (turned > Math.PI) turned -= 2 * Math.PI;
    if (swept + turned >= 2 * Math.PI && turned > 0) returned = (k - 1 + (2 * Math.PI - swept) / turned) / RATE;
    swept += turned;
    last = angle;
  }
  const energy = states.map((s, k) => 0.5 * ORBIT_MASS * norm(s.linear) ** 2 + K / r[k]!);
  return { r, left, far, returned, energy };
}
/**
 * Everything wrong with "stays 2 m from the point within 1% at every step for 8 s, and first comes back to its start
 * line after 4.000 s, within 1%". Each failure names `name`; the first names the answer and the step the body left
 * the band at.
 */
export function orbitFailures(name: string, o: Orbit): string[] {
  const out: string[] = [];
  if (o.left !== null) {
    out.push(`${name}: at step ${o.left} the body is ${mm3(o.r[o.left]!)} m from the point, outside the answer ${ORBIT_RADIUS} m within 1%; over 8 s it is farthest from the answer at ${mm3(o.r[o.far]!)} m (step ${o.far})`);
  }
  if (o.returned === null) out.push(`${name}: the body never comes back to its start line in 8 s, where ${ORBIT_PERIOD.toFixed(3)} s within 1% is due`);
  else if (!(Math.abs(o.returned - ORBIT_PERIOD) <= WITHIN * ORBIT_PERIOD)) out.push(`${name}: the body first comes back to its start line after ${o.returned.toFixed(3)} s, not ${ORBIT_PERIOD.toFixed(3)} s within 1%`);
  return out;
}
/** Whether a failure names the fixture, the answer 2 m and the step the body left the band at. */
export const namesStep = (failure: string, name: string, step: number): boolean =>
  failure.includes(name) && failure.includes(`at step ${step} `) && failure.includes(`the answer ${ORBIT_RADIUS} m`);

// ---------------------------------------------------------------------------------------------------
// Criterion 3: the gyration.

/** A gyration read from a body's states: its speeds, its path's extent, how round the path is and how fast its velocity turns. */
export interface Gyration {
  /** The body's speed after each step, m/s, and the step whose speed is farthest from 3 m/s. */
  speeds: number[];
  worst: number;
  /** The lowest and the highest x and y of its path, m. */
  x: [number, number];
  y: [number, number];
  /** Half the path's extent along y, m: the circle's radius. */
  radius: number;
  /** The state farthest from a circle of radius 0.5 m about the middle of the path's extents: its step and its distance from that middle, m. */
  round: { step: number; r: number };
  /** The time its velocity takes to turn once about the field, s, from its mean turn a step; null when it doesn't turn. */
  turn: number | null;
}
export function gyrationOf(reply: JsonObject, id: string, what: string): Gyration | string {
  const states = statesOf(reply, id, GYRATION_STEPS, what);
  if (typeof states === 'string') return states;
  const speeds = states.map((s) => norm(s.linear));
  let worst = 0;
  for (const [k, v] of speeds.entries()) if (Math.abs(v - ION_SPEED) > Math.abs(speeds[worst]! - ION_SPEED)) worst = k;
  const span = (i: number): [number, number] => [Math.min(...states.map((s) => s.pos[i]!)), Math.max(...states.map((s) => s.pos[i]!))];
  const [x, y] = [span(0), span(1)];
  const middle: Vec3 = [(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, states[0]!.pos[2]];
  let round = { step: 0, r: norm(sub(states[0]!.pos, middle)) };
  for (const [k, s] of states.entries()) {
    const r = norm(sub(s.pos, middle));
    if (Math.abs(r - GYRATION_RADIUS) > Math.abs(round.r - GYRATION_RADIUS)) round = { step: k, r };
  }
  // The field is along z: the velocity's turn about it, from one step to the next, is the angle between the two in the x-y plane.
  let turned = 0;
  for (let k = 1; k < states.length; k += 1) {
    const [a, b] = [states[k - 1]!.linear, states[k]!.linear];
    turned += Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
  }
  const mean = Math.abs(turned) / GYRATION_STEPS;
  return { speeds, worst, x, y, radius: (y[1] - y[0]) / 2, round, turn: mean > 0 ? (2 * Math.PI) / (mean * RATE) : null };
}
/** The side of its start line a path lies on, as the judge names it: the issue's side is `the −y side`. */
export function sideOf(y: readonly [number, number]): string {
  if (y[1] > Y_HIGH + PRINTED) return y[0] >= -PRINTED ? 'the +y side' : 'both sides';
  return 'the −y side';
}
/**
 * Everything wrong with "keeps its speed at 3 m/s within 0.1% at every step for 5 s, and its path stays between
 * y = −1.000 m and 0 m: a circle of radius 0.5 m within 1%, turning once every 1.047 s". Each failure names `name`;
 * the speed's names the speed, the path's names the side.
 */
export function gyrationFailures(name: string, g: Gyration): string[] {
  const out: string[] = [];
  const v = g.speeds[g.worst]!;
  if (!(Math.abs(v - ION_SPEED) <= SPEED_WITHIN * ION_SPEED)) out.push(`${name}: at step ${g.worst} its speed is ${mm3(v)} m/s, not ${ION_SPEED} m/s within 0.1%`);
  if (!(g.y[0] >= Y_LOW - PRINTED && g.y[1] <= Y_HIGH + PRINTED)) {
    out.push(`${name}: its path lies between y = ${signed(g.y[0])} m and ${signed(g.y[1])} m, on ${sideOf(g.y)} of its start, not between −1.000 m and 0 m`);
  }
  if (!(Math.abs(g.round.r - GYRATION_RADIUS) <= WITHIN * GYRATION_RADIUS)) {
    out.push(`${name}: at step ${g.round.step} the body is ${g.round.r.toFixed(4)} m from the middle of its path, which is no circle of radius ${GYRATION_RADIUS} m within 1% (its extent: ${mm3(g.x[1] - g.x[0])} m along x, ${mm3(g.y[1] - g.y[0])} m along y)`);
  }
  if (g.turn === null || !(Math.abs(g.turn - GYRATION_TURN) <= WITHIN * GYRATION_TURN)) {
    out.push(`${name}: its velocity turns once every ${g.turn === null ? 'never' : `${g.turn.toFixed(3)} s`}, not ${GYRATION_TURN.toFixed(3)} s within 1%`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4: the pair.

/** How far apart bodies `a` and `b` are after each step of 10 s, m; or, as text, why their states can't be read. */
export function apartOf(reply: JsonObject, a: string, b: string, what: string): number[] | string {
  const [first, second] = [statesOf(reply, a, PAIR_STEPS, what), statesOf(reply, b, PAIR_STEPS, what)];
  if (typeof first === 'string') return first;
  if (typeof second === 'string') return second;
  return first.map((s, k) => norm(sub(s.pos, second[k]!.pos)));
}
/** Everything wrong with "are 2^(1/6) × σ = 0.5612 m apart at 10 s, within 0.5%"; the failure names `name`, the answer and the distance. */
export function restFailures(name: string, apart: readonly number[]): string[] {
  const d = apart[PAIR_STEPS]!;
  return Math.abs(d - REST) <= REST_WITHIN * REST ? [] : [`${name}: at 10 s the two bodies are ${mm3(d)} m apart, not the answer ${REST.toFixed(4)} m within 0.5%`];
}
/** Everything wrong with "released 1.3 m apart, past the cutoff, are still 1.3 m apart at 10 s". */
export function stillFailures(apart: readonly number[]): string[] {
  const d = apart[PAIR_STEPS]!;
  return Math.abs(d - PAST_CUTOFF) <= STILL ? [] : [`the pair released ${PAST_CUTOFF} m apart, past the cutoff of ${CUTOFF} m, is ${mm3(d)} m apart at 10 s, not still ${PAST_CUTOFF} m`];
}

// ---------------------------------------------------------------------------------------------------
// The check (the base's `check` call: `{ok: true, issues: [{code, severity, ids, path, actual, what, …}]}`).

/** The path's field names, whatever its separator (`forces/sun_pull/kind/min_distance`, `a.b`), as #2009's suite reads them. */
const segments = (path: JsonValue | undefined): string[] => (typeof path === 'string' ? path.split(/[/.]/).filter((s) => s !== '') : []);
const word = (text: JsonValue | undefined, w: string): boolean =>
  typeof text === 'string' && new RegExp(`(^|[^A-Za-z0-9_])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_])`).test(text);
/** Whether an issue names `name`, an ID or a field: in its `path`, in its `ids`, or as a word of its sentence. */
export const names = (issue: JsonObject, name: string): boolean =>
  segments(issue['path']).includes(name) || (Array.isArray(issue['ids']) && issue['ids'].includes(name)) || word(issue['what'], name);
/** Whether an issue names the number `n`: as its `actual`, or as a number of its sentence. */
export const namesNumber = (issue: JsonObject, n: number): boolean => issue['actual'] === n || word(issue['what'], String(n));

/** The error issues of a check's reply, or of a refused bake's; or, as text, why the reply holds none to read. */
export function errorsOf(reply: JsonObject, what: string): JsonObject[] | string {
  if (!Array.isArray(reply['issues'])) return `${what}: the reply lists no issues: ${show(reply)}`;
  return reply['issues'].filter(isObject).filter((i) => i['severity'] === 'error');
}
const shown = (issues: JsonObject[]): string => show(issues.map((i) => ({ code: i['code'] ?? null, path: i['path'] ?? null, actual: i['actual'] ?? null, ids: i['ids'] ?? null, what: i['what'] ?? null })));
/** Everything wrong with a world the check takes: any error it raises. */
export function acceptedFailures(reply: JsonObject, what: string): string[] {
  const errors = errorsOf(reply, what);
  if (typeof errors === 'string') return [errors];
  if (reply['ok'] !== true) return [`${what}: the check didn't answer {ok: true, issues}: ${show(reply)}`];
  return errors.map((i) => `${what} isn't taken at check: ${String(i['code'])} at ${String(i['path'])}: ${String(i['what'])}`);
}
/**
 * Everything wrong with a refusal naming a force's field and its value: no error issue whose `path` lies under
 * `forces/<force>` and ends with the field, with the value written there as its `actual`.
 */
export function fieldRefusalFailures(reply: JsonObject, want: { force: string; field: string; actual: JsonValue }, what: string): string[] {
  const errors = errorsOf(reply, what);
  if (typeof errors === 'string') return [errors];
  const at = (i: JsonObject): boolean => {
    const p = segments(i['path']);
    const f = p.indexOf('forces');
    return f >= 0 && p[f + 1] === want.force && p.at(-1) === want.field;
  };
  const named = errors.filter(at);
  if (named.length === 0) return [`${what} isn't refused naming the field ${want.field} of force ${want.force}: no error issue's path is forces/${want.force}/…/${want.field} (its errors: ${shown(errors)})`];
  return named.some((i) => JSON.stringify(i['actual']) === JSON.stringify(want.actual)) ? [] : [`${what}: the issue at ${want.field} of force ${want.force} doesn't hold the value ${show(want.actual)} as its actual: ${shown(named)}`];
}
/**
 * Everything wrong with a refusal with code `code` naming a force and something more: no error issue of that code that
 * names the force's ID and passes `more` (README: The refusals).
 */
export function codeRefusalFailures(reply: JsonObject, want: { code: string; force: string; more: (issue: JsonObject) => boolean; saying: string }, what: string): string[] {
  const errors = errorsOf(reply, what);
  if (typeof errors === 'string') return [errors];
  const coded = errors.filter((i) => i['code'] === want.code);
  if (coded.length === 0) return [`${what} isn't refused with ${want.code}: its errors: ${shown(errors)}`];
  return coded.some((i) => names(i, want.force) && want.more(i)) ? [] : [`${what}: no ${want.code} issue names the force ${want.force} and ${want.saying}: ${shown(coded)}`];
}
/** Everything wrong with "before any step runs": a bake of the same world that isn't refused, or that holds a state or a step's hash. */
export function unsteppedFailures(reply: JsonObject, what: string): string[] {
  const out: string[] = [];
  if (reply['ok'] !== false) out.push(`${what}: its bake isn't refused: ok is ${show(reply['ok'])}`);
  for (const key of ['bodies', 'step_hashes']) if (reply[key] !== undefined) out.push(`${what}: its bake answers ${key}, so a world was built and read: ${show(reply[key]).slice(0, 200)}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The three fixtures in the behavior kit (README: The fixtures), read from `behavior_fixtures`, `behavior_kit` and
// `backend`.

/** The fixtures' names in the kit, and the cap that claims each one's law: the law's own name. */
export const ORBIT = 'inverse_square_orbit';
export const GYRATION = 'magnetic_gyration';
export const PAIR = 'lennard_jones_rest';
export const FIXTURES = [ORBIT, GYRATION, PAIR] as const;
export const LAW: Record<(typeof FIXTURES)[number], string> = { [ORBIT]: 'inverse_square', [GYRATION]: 'magnetic', [PAIR]: 'lennard_jones' };
export const LAWS = FIXTURES.map((f) => LAW[f]);

export interface Fixture { name: string; world: JsonObject; answer: number | null; tolerance: JsonValue; caps: string[]; raw: JsonObject }
/** Every fixture the interface holds, or, as text, why the reply isn't the interface's fixtures. */
export function fixturesOf(reply: JsonObject, what: string): Fixture[] | string {
  if (reply['ok'] !== true || !Array.isArray(reply['fixtures'])) return `${what}: behavior_fixtures didn't answer {ok: true, fixtures}: ${show(reply)}`;
  return reply['fixtures'].filter(isObject).map((f) => ({
    name: String(f['name']), world: isObject(f['world']) ? f['world'] : {}, answer: typeof f['answer'] === 'number' ? f['answer'] : null,
    tolerance: f['tolerance'] ?? null, caps: Array.isArray(f['caps']) ? f['caps'].map(String) : [], raw: f,
  }));
}
/** The fixture named `name`, held exactly once; or, as text, how often the kit's data holds it. */
export function fixtureNamed(reply: JsonObject, name: string, what: string): Fixture | string {
  const all = fixturesOf(reply, what);
  if (typeof all === 'string') return all;
  const mine = all.filter((f) => f.name === name);
  return mine.length === 1 ? mine[0]! : `${what}: the kit's data holds ${name} ${mine.length} times, once expected; it holds ${all.map((f) => f.name).join(', ')}`;
}

/** The dynamic bodies of a world document, by ID. */
function dynamics(w: JsonObject): [string, JsonObject][] {
  const bodies = isObject(w['bodies']) ? w['bodies'] : {};
  return Object.entries(bodies).filter((e): e is [string, JsonObject] => isObject(e[1]) && e[1]['kind'] === 'dynamic');
}
/** The fields of each force of a world document whose kind is the law `law`. */
function laws(w: JsonObject, law: string): JsonObject[] {
  const forces = isObject(w['forces']) ? w['forces'] : {};
  return Object.values(forces).flatMap((f) => (isObject(f) && isObject(f['kind']) && isObject(f['kind'][law]) ? [f['kind'][law]] : []));
}
const posOf = (b: JsonObject): Vec3 | null => (isObject(b['pose']) && b['pose']['pos'] !== undefined ? (numbers(b['pose']['pos'], 3) as Vec3 | null) : [0, 0, 0]);
const linearOf = (b: JsonObject): Vec3 | null => (isObject(b['velocity']) && b['velocity']['linear'] !== undefined ? (numbers(b['velocity']['linear'], 3) as Vec3 | null) : [0, 0, 0]);
/** What every one of the three worlds shares: 120 Hz, `count` dynamic bodies with `gravity_scale: 0`, exactly one force of the law, and the fixture's answer, tolerance and cap. */
function shared(f: Fixture, count: number, substeps: number | null, answer: number, room: number, printed: string, tolerance: number): string[] {
  const out: string[] = [];
  const w = f.world;
  if ((w['step_rate'] ?? RATE) !== RATE) out.push(`${f.name}'s world isn't at 120 Hz: step_rate ${show(w['step_rate'])}`);
  if (substeps !== null && w['substeps'] !== substeps) out.push(`${f.name}'s world isn't at substeps ${substeps}: substeps ${show(w['substeps'])}`);
  const bodies = dynamics(w);
  if (bodies.length !== count) out.push(`${f.name}'s world holds ${bodies.length} dynamic bodies, not ${count}: ${bodies.map(([id]) => id).join(', ')}`);
  for (const [id, b] of bodies) if (b['gravity_scale'] !== 0) out.push(`${f.name}: body ${id} has gravity_scale ${show(b['gravity_scale'])}, not 0`);
  if (laws(w, LAW[f.name as (typeof FIXTURES)[number]]).length !== 1) out.push(`${f.name}'s world doesn't hold exactly one ${LAW[f.name as (typeof FIXTURES)[number]]} force: ${show(w['forces'])}`);
  if (f.answer === null || Math.abs(f.answer - answer) > room + 1e-12) out.push(`${f.name}: the answer ${show(f.answer)} isn't the issue's ${printed}`);
  if (JSON.stringify(f.tolerance) !== JSON.stringify({ relative: tolerance })) out.push(`${f.name}: tolerance ${show(f.tolerance)}, the issue's is ${tolerance * 100}% ({"relative": ${tolerance}})`);
  if (!f.caps.includes(LAW[f.name as (typeof FIXTURES)[number]])) out.push(`${f.name}'s caps ${show(f.caps)} don't name its law, ${LAW[f.name as (typeof FIXTURES)[number]]}`);
  return out;
}
/** The orbit fixture's one body and its force's point; null where its world doesn't hold them. */
export function orbitParts(f: Fixture): { body: string; point: Vec3 } | null {
  const [bodies, law] = [dynamics(f.world), laws(f.world, 'inverse_square')[0]];
  const point = law ? (numbers(law['point'], 3) as Vec3 | null) : null;
  return bodies.length === 1 && point ? { body: bodies[0]![0], point } : null;
}
/** Everything about the orbit fixture's data that isn't criterion 1's world, its answer 2 m, its 1% and its cap. */
export function orbitDataFailures(f: Fixture): string[] {
  const out = shared(f, 1, 1, ORBIT_RADIUS, 0, '2 m', WITHIN);
  const [parts, law, body] = [orbitParts(f), laws(f.world, 'inverse_square')[0], dynamics(f.world)[0]?.[1]];
  if (!parts || !law || !body) return [...out, `${f.name}'s world doesn't hold one dynamic body and an inverse_square force with a point of three numbers`];
  if (typeof law['k'] !== 'number' || Math.abs(law['k'] - -39.478) > PRINTED) out.push(`${f.name}: k is ${show(law['k'])}, not −4π² = −39.478 N·m²`);
  const [pos, linear] = [posOf(body), linearOf(body)];
  if (!pos || !linear) return [...out, `${f.name}: the body's pose and velocity aren't numbers: ${show(body)}`];
  const from = sub(pos, parts.point);
  if (Math.abs(norm(from) - ORBIT_RADIUS) > 1e-9) out.push(`${f.name}: the body is built ${norm(from)} m from the point, not ${ORBIT_RADIUS} m`);
  if (Math.abs(norm(linear) - 3.1416) > 0.00005) out.push(`${f.name}: the body is launched at ${norm(linear)} m/s, not π = 3.1416 m/s`);
  if (Math.abs(dot(linear, from)) > 1e-9) out.push(`${f.name}: the body isn't launched square to the line from the point: velocity ${show(linear)} against ${show(from)}`);
  return out;
}
/** The gyration fixture's one body; null where its world doesn't hold exactly one. */
export const gyrationBody = (f: Fixture): string | null => (dynamics(f.world).length === 1 ? dynamics(f.world)[0]![0] : null);
/** Everything about the gyration fixture's data that isn't criterion 3's world, its answer 0.5 m, its 1% and its cap. */
export function gyrationDataFailures(f: Fixture): string[] {
  const out = shared(f, 1, null, GYRATION_RADIUS, 0, '0.5 m', WITHIN);
  const [law, body] = [laws(f.world, 'magnetic')[0], dynamics(f.world)[0]?.[1]];
  if (!law || !body) return [...out, `${f.name}'s world doesn't hold one dynamic body and a magnetic force`];
  if (JSON.stringify(law['field']) !== JSON.stringify(FIELD) || law['charge'] !== CHARGE) out.push(`${f.name}: the law is ${show(law)}, not {field: [0, 0, 3], charge: 2}`);
  if (JSON.stringify(posOf(body)) !== JSON.stringify([0, 0, 0])) out.push(`${f.name}: the body isn't started at the origin: ${show(body['pose'])}`);
  if (JSON.stringify(linearOf(body)) !== JSON.stringify([ION_SPEED, 0, 0])) out.push(`${f.name}: the body isn't started at (3, 0, 0) m/s: ${show(body['velocity'])}`);
  return out;
}
/** The pair fixture's two bodies; null where its world doesn't hold exactly two. */
export function pairBodies(f: Fixture): [string, string] | null {
  const bodies = dynamics(f.world);
  return bodies.length === 2 ? [bodies[0]![0], bodies[1]![0]] : null;
}
/** Everything about the pair fixture's data that isn't criterion 4's world, its answer 0.5612 m, its 0.5% and its cap. */
export function pairDataFailures(f: Fixture): string[] {
  const out = shared(f, 2, 1, 0.5612, 0.00005, '2^(1/6) × σ = 0.5612 m', REST_WITHIN);
  const [law, bodies, drags] = [laws(f.world, 'lennard_jones')[0], dynamics(f.world), laws(f.world, 'drag')];
  if (!law || bodies.length !== 2) return [...out, `${f.name}'s world doesn't hold two dynamic bodies and a lennard_jones force`];
  if (law['epsilon'] !== EPSILON || law['sigma'] !== SIGMA || (law['cutoff'] ?? CUTOFF) !== CUTOFF) out.push(`${f.name}: the law is ${show(law)}, not {epsilon: 1, sigma: 0.5, cutoff: 1.25}`);
  if (drags.length !== 1 || drags[0]!['linear'] !== DRAG_LINEAR || (drags[0]!['quadratic'] ?? 0) !== 0) out.push(`${f.name}'s world doesn't hold exactly one drag, {linear: 2}: ${show(drags)}`);
  const [a, b] = [bodies[0]![1], bodies[1]![1]];
  const [pa, pb, va, vb] = [posOf(a), posOf(b), linearOf(a), linearOf(b)];
  if (!pa || !pb || !va || !vb) return [...out, `${f.name}: the bodies' poses and velocities aren't numbers`];
  if (Math.abs(norm(sub(pa, pb)) - APART) > 1e-9) out.push(`${f.name}: the bodies are released ${norm(sub(pa, pb))} m apart, not ${APART} m`);
  if (norm(va) !== 0 || norm(vb) !== 0) out.push(`${f.name}: the bodies aren't released at rest: ${show(va)}, ${show(vb)}`);
  return out;
}

/** A backend's manifest (the base's `backend` call): its name, whether it is the reference, and its caps() as cap names. */
export interface Manifest { backend: string; reference: boolean; caps: string[] }
export function manifestOf(reply: JsonObject, what: string): Manifest | string {
  if (reply['ok'] !== true || typeof reply['backend'] !== 'string' || !Array.isArray(reply['caps'])) return `${what}: backend didn't answer {ok: true, backend, reference, caps}: ${show(reply)}`;
  return { backend: reply['backend'], reference: reply['reference'] === true, caps: reply['caps'].map(String) };
}

/** The kit's one row for `fixture` (the base's `behavior_kit` reply); or, as text, why there isn't exactly one. */
export function rowOf(reply: JsonObject, fixture: string, what: string): KitResult | string {
  if (reply['ok'] !== true || !Array.isArray(reply['results'])) return `${what}: behavior_kit didn't answer {ok: true, results}: ${show(reply)}`;
  const rows = reply['results'].filter(isObject).filter((r) => r['fixture'] === fixture);
  if (rows.length !== 1) return `${what}: the kit's report holds ${fixture} ${rows.length} times, once expected (admitted ${show(reply['admitted'])}, verdict ${show(reply['verdict'])})`;
  const r = rows[0]!;
  return {
    backend: String(r['backend']), fixture, measured: typeof r['measured'] === 'number' ? r['measured'] : null,
    answer: typeof r['answer'] === 'number' ? r['answer'] : null, tolerance: r['tolerance'], caps: Array.isArray(r['caps']) ? r['caps'].map(String) : [],
    result: String(r['result']) as KitResult['result'], what: typeof r['what'] === 'string' ? r['what'] : '', raw: r,
  };
}
/** A row's own number beside its `measured`: `period`, `speed` or `step`; null when the row doesn't list it as a number. */
export const numberOf = (r: KitResult, key: 'period' | 'speed' | 'step'): number | null => (typeof r.raw[key] === 'number' ? r.raw[key] : null);
/** A gyration row's `y`: the lowest and the highest y of the body's path, m; null when the row doesn't list the two. */
export const yOf = (r: KitResult): [number, number] | null => numbers(r.raw['y'], 2) as [number, number] | null;

/**
 * Everything wrong with a row read as a pass on `backend`: its result, the interface's answer and tolerance beside a
 * measured value, and that value within the tolerance of `answer`, the closed form.
 */
export function passFailures(r: KitResult, f: Fixture, backend: string, answer: number, within: number): string[] {
  const out: string[] = [];
  if (r.backend !== backend) out.push(`${r.fixture}'s row names backend ${r.backend}, not ${backend}`);
  if (r.result !== 'pass') out.push(`${backend} ${r.fixture} reads ${r.result}, not pass: ${show(r.raw)}`);
  if (r.answer === null || r.answer !== f.answer || r.tolerance === undefined || JSON.stringify(r.tolerance) !== JSON.stringify(f.tolerance)) {
    out.push(`${r.fixture}: the row's answer and tolerance ${show(r.answer)} ${show(r.tolerance ?? null)} aren't the interface's ${show(f.answer)} ${show(f.tolerance)}`);
  }
  if (r.measured === null) out.push(`${r.fixture}: the row lists no measured value beside its answer: ${show(r.raw)}`);
  else if (!(Math.abs(r.measured - answer) <= within * Math.abs(answer))) out.push(`${r.fixture}: measured ${r.measured} is outside ${answer} within ${within * 100}%`);
  return out;
}
/** Everything wrong with a row read as a fail, as a fail names it (Physics: behavior kit): the fixture and the backend, in its fields and its sentence. */
export function failFailures(r: KitResult): string[] {
  const out: string[] = [];
  if (r.result !== 'fail') out.push(`${r.backend} ${r.fixture} reads ${r.result}, not fail: ${show(r.raw)}`);
  if (!r.what.includes(r.backend) || !r.what.includes(r.fixture)) out.push(`${r.fixture}'s fail sentence doesn't name the backend ${r.backend} and the fixture: ${JSON.stringify(r.what)}`);
  return out;
}
