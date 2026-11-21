// Test-side tools for the #2098 acceptance tests (README: The surface under test). They drive the physics runner
// `deep-physics` (JSON lines in, one reply per line) through #191's release build, as #2241's suite does, and add only
// this issue's worlds, its three planted names and its judges. Nothing here stands in for the check, a backend, the
// wind or a body's inertia: every issue, body state, step hash and checkpoint read here is the program's own, and every
// expected value is the issue's, copied or worked here from the closed form its words give (README: Criteria to tests).
//
// No function here asserts. What a program answers and what a judge finds wrong with it both come back as text, so
// each test's failing assertion is in its own file. Only a process that can't be run at all throws, `BLOCKED:` or
// `INCONCLUSIVE:` first, as the base's suites do: nothing unrun passes.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RATE, REPO, TIMEOUT, box, isObject, physicsBin, show, use, world, type JsonObject, type JsonValue, type Vec3 } from '../191/helpers.ts';

export { RATE, TIMEOUT, prebuild, show, type JsonObject, type JsonValue, type Vec3 } from '../191/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs's `criterionId`: the first eight hex digits of the SHA-256 of its text). */
export const AC = { 1: '#2098.07d55616', 2: '#2098.7c1127fe', 3: '#2098.f0ef7a3d' } as const;

/** This suite's planted names (`deep-physics --planted <name>`), each one criterion's wrong program (README: Planted twins). */
export type Planted = 'world_2d_built_on_rapier3d' | 'wind_noise_from_platform_sin' | 'inertia_ignored';
export const BUILT_ON_RAPIER3D: Planted = 'world_2d_built_on_rapier3d';
export const NOISE_FROM_SIN: Planted = 'wind_noise_from_platform_sin';
export const INERTIA_IGNORED: Planted = 'inertia_ignored';

/** The two backends the issue names, and the version it pins both to: a world writes `=0.36.1`, a checkpoint and Cargo.lock `0.36.1`. */
export const RAPIER2D = 'rapier2d';
export const RAPIER3D = 'rapier3d';
export const PIN = '0.36.1';

// ---------------------------------------------------------------------------------------------------
// The runner: this checkout's release build of `deep-physics` (#191's `release`), plain or with one planted name.

/**
 * What one process answered: `problem` is '' and `replies` holds one object per call, or `problem` says what the
 * program did instead (a planted name it doesn't know exits 2 with `bad_input`).
 */
export interface Asked { what: string; problem: string; replies: JsonObject[] }

const MINUTES = (TIMEOUT - 300_000) / 60_000;
/** Runs `calls` through one `deep-physics [--planted p]` process. A name the build doesn't know comes back as `problem`, never a throw. */
export function ask(calls: JsonObject[], planted?: Planted): Asked {
  const args = planted ? ['--planted', planted] : [];
  const what = `deep-physics ${args.join(' ')}`.trim();
  const run = spawnSync(physicsBin('release'), args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  const no = (problem: string): Asked => ({ what, problem, replies: [] });
  if (code === 'ETIMEDOUT') throw Error(`INCONCLUSIVE: ${what} didn't finish within ${MINUTES} minutes`);
  if (run.error && code !== 'EPIPE') throw Error(`BLOCKED: ${what} couldn't be run: ${run.error.message}`);
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

export const check = (w: JsonObject): JsonObject => ({ call: 'check', world: w });
/** A bake of `steps` steps answering the states of the bodies in `read`, one per step from the built state at index 0. */
export const bake = (w: JsonObject, steps: number, read: string[], extra: JsonObject = {}): JsonObject => ({ call: 'bake', world: w, steps, read, ...extra });

// ---------------------------------------------------------------------------------------------------
// Reading a reply (the base's `check` and `bake`: `{ok, issues}`; `{ok, bodies, step_hashes, checkpoints}`).

/** Why a reply isn't a bake, in its own words: its issues' codes, fields and sentences. */
export function refusal(reply: JsonObject): string {
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  return issues.length ? issues.map((i) => `${String(i['code'])} at ${String(i['path'])}: ${String(i['what'])}`).join('; ') : show(reply);
}
/** A baked body's states as the reply lists them, the built one and one per step; or, as text, why there are none. */
function seriesOf(reply: JsonObject, id: string, steps: number, what: string): JsonObject[] | string {
  if (reply['ok'] !== true) return `${what} isn't baked: ${refusal(reply)}`;
  const series = isObject(reply['bodies']) ? reply['bodies'][id] : undefined;
  if (!Array.isArray(series)) return `${what}: the bake lists no states of body ${id}: ${show(reply['bodies'])}`;
  if (series.length !== steps + 1) return `${what}: ${id} has ${series.length} states, not the built one and one for each of ${steps} steps`;
  return series.map((v) => (isObject(v) ? v : {}));
}
const numbers = (v: JsonValue | undefined, n: number): number[] | null =>
  (Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : null);
const finite = (v: JsonValue | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** The step hashes of a bake of `steps` steps, the built state's first; or, as text, why there are none. */
export function hashesOf(reply: JsonObject, steps: number, what: string): string[] | string {
  if (reply['ok'] !== true) return `${what} isn't baked: ${refusal(reply)}`;
  const h = reply['step_hashes'];
  if (!Array.isArray(h) || !h.every((x) => typeof x === 'string')) return `${what}: step_hashes isn't a list of hashes: ${show(h)}`;
  return h.length === steps + 1 ? (h as string[]) : `${what}: ${h.length} step hashes, not the built state's and one for each of ${steps} steps`;
}
/** The first step at which two runs' step hashes differ (a missing one differs); −1 when every one is equal. */
export function firstDifference(a: readonly string[], b: readonly string[]): number {
  for (let k = 0; k < Math.max(a.length, b.length); k += 1) if (a[k] !== b[k]) return k;
  return -1;
}
/** Everything that differs between two runs' step hashes of one world; the failure names the first step and both hashes. */
export function sameFailures(first: readonly string[], other: readonly string[], what: string, others: string): string[] {
  const k = firstDifference(first, other);
  return k < 0 ? [] : [`${what}: the step hash at step ${k} is ${String(first[k])} in the first run and ${String(other[k])} ${others}`];
}

// ---------------------------------------------------------------------------------------------------
// The check (the base's `check` call: `{ok: true, issues: [{code, severity, path, actual, what, …}]}`).

/** The path's field names, whatever its separator (`dimensions`, `backend/name`, `a.b`), as #2009's suite reads them. */
const segments = (path: JsonValue | undefined): string[] => (typeof path === 'string' ? path.split(/[/.]/).filter((s) => s !== '') : []);
const endsWith = (path: string[], tail: readonly string[]): boolean => path.length >= tail.length && tail.every((s, i) => path[path.length - tail.length + i] === s);
/** A check's issues of severity `error`; or, as text, why the reply isn't a check's. */
export function errorsOf(reply: JsonObject, what: string): JsonObject[] | string {
  if (reply['ok'] !== true || !Array.isArray(reply['issues'])) return `${what}: the check didn't answer {ok: true, issues}: ${show(reply)}`;
  return reply['issues'].filter(isObject).filter((i) => i['severity'] === 'error');
}
/** The errors of a check whose `path` is the field's. */
export const errorsAt = (errors: JsonObject[], field: readonly string[]): JsonObject[] => errors.filter((i) => endsWith(segments(i['path']), field));
/** Everything wrong with an accepted world: any error its check raises. */
export function acceptedFailures(reply: JsonObject, what: string): string[] {
  const errors = errorsOf(reply, what);
  return typeof errors === 'string' ? [errors] : errors.map((i) => `${what} isn't accepted at check: ${String(i['code'])} at ${String(i['path'])}: ${String(i['what'])}`);
}
export interface Refused { field: readonly string[]; actual: JsonValue; backend: string }
/**
 * Everything wrong with a refusal at check naming the field and the backend: no error issue whose `path` is the
 * field's, or none of those holding the value written there in `actual` and the backend's name in its sentence.
 */
export function refusalFailures(reply: JsonObject, want: Refused, what: string): string[] {
  const errors = errorsOf(reply, what);
  const at = want.field.join('/');
  if (typeof errors === 'string') return [errors];
  const named = errorsAt(errors, want.field);
  if (named.length === 0) return [`${what} isn't refused naming ${at} and ${want.backend}: no error issue has the path ${at} (its errors: ${show(errors)})`];
  const good = named.filter((i) => JSON.stringify(i['actual']) === JSON.stringify(want.actual) && typeof i['what'] === 'string' && i['what'].includes(want.backend));
  return good.length ? [] : [`${what}: the issue at ${at} doesn't hold actual ${show(want.actual)} and a sentence naming ${want.backend}: ${show(named)}`];
}

// ---------------------------------------------------------------------------------------------------
// Criterion 1: a 2D world of a ball dropped 2 m onto a floor, both of restitution 0.5 (README: The worlds).

export const BALL = 'ball';
export const FLOOR = 'floor';
/** The ball's radius, m, and the drop: its lowest point starts 2 m above the floor's line, y = 0. */
export const RADIUS = 0.1;
export const DROP = 2;
/** Two seconds: the ball lands at √(2 × 2 ÷ 9.81) = 0.64 s and is back at its first apex before 1 s. */
export const DROP_STEPS = 2 * RATE;
/** "Within 0.05 of a quarter of the drop": the first rebound over the drop, within 0.05 of 0.25 (README: Readings). */
export const QUARTER = 0.25;
export const WITHIN_OF_DROP = 0.05;

/**
 * The criterion's world on `backend`: `dimensions: 2`, a `circle` on a dynamic body over a `segment` on a static
 * one, one contact material of restitution 0.5 on both. A point is `[x, y]`; gravity is left to its default, 9.81
 * m/s² toward −y. The same document with `backend.name: rapier3d` is the one the criterion says is refused.
 */
export function dropWorld(backend: string): JsonObject {
  return {
    kind: 'physics.world@1',
    dimensions: 2,
    step_rate: RATE,
    substeps: 4,
    seed: 2098,
    mode: 'dynamic',
    capacity: { bodies: 16, shapes: 16, joints: 8, contacts: 64, particles: 0 },
    backend: { name: backend, version: `=${PIN}` },
    contact_materials: { half: { friction: 0.5, restitution: 0.5, density: 1000 } },
    shapes: { [BALL]: { kind: 'circle', radius: RADIUS }, [FLOOR]: { kind: 'segment', a: [-30, 0], b: [30, 0] } },
    bodies: {
      [FLOOR]: { kind: 'static', shapes: [{ shape: FLOOR, contact_material: 'half' }] },
      [BALL]: { kind: 'dynamic', shapes: [{ shape: BALL, contact_material: 'half' }], pose: { pos: [0, DROP + RADIUS] } },
    },
  };
}
/** The refusal the criterion names for the same world with `backend.name: rapier3d`: at `dimensions`, its value 2, naming the backend. */
export const DIMENSIONS_ON_3D: Refused = { field: ['dimensions'], actual: 2, backend: RAPIER3D };

/** A 2D body's fall: its height `pos[1]` and its vertical velocity `linear[1]` after each step, the built state first. */
export interface Fall { y: number[]; vy: number[] }
/** The fall of body `id` over a bake of `steps` steps of a 2D world; or, as text, why it can't be read. */
export function fallOf(reply: JsonObject, id: string, steps: number, what: string): Fall | string {
  const series = seriesOf(reply, id, steps, what);
  if (typeof series === 'string') return series;
  const fall: Fall = { y: [], vy: [] };
  for (const [k, s] of series.entries()) {
    const [y, vy] = [Array.isArray(s['pos']) ? s['pos'][1] : undefined, Array.isArray(s['linear']) ? s['linear'][1] : undefined];
    if (!finite(y) || !finite(vy)) return `${what}: bodies.${id}[${k}] doesn't hold a height pos[1] and a vertical velocity linear[1]: ${show(s)}`;
    fall.y.push(y);
    fall.vy.push(vy);
  }
  return fall;
}
/** The first rebound: the step the ball first moves upward, and the highest its lowest point then rises over the floor, m. */
export function reboundOf(f: Fall): { contact: number; apex: number } | null {
  const contact = f.vy.findIndex((v, k) => k > 0 && v > 0);
  if (contact < 0) return null;
  let apex = -Infinity;
  for (let k = contact; k < f.y.length && f.vy[k]! > 0; k += 1) apex = Math.max(apex, f.y[k]! - RADIUS);
  return { contact, apex };
}
/** Everything wrong with "a ball dropped 2 m onto a floor … rebounds to within 0.05 of a quarter of the drop". */
export function reboundFailures(f: Fall): string[] {
  if (Math.abs(f.y[0]! - (DROP + RADIUS)) > 1e-5 || f.vy[0] !== 0) return [`the ball isn't built at rest with its lowest point ${DROP} m above the floor: its centre is at y = ${f.y[0]!} m, moving ${f.vy[0]!} m/s`];
  const r = reboundOf(f);
  if (!r) return [`the ball never rebounds: its vertical velocity never turns upward in ${f.y.length - 1} steps (it ends at y = ${f.y[f.y.length - 1]!.toFixed(4)} m, ${f.vy[f.vy.length - 1]!.toFixed(4)} m/s)`];
  const fraction = r.apex / DROP;
  return Math.abs(fraction - QUARTER) <= WITHIN_OF_DROP ? [] : [`the first rebound, ${r.apex.toFixed(4)} m after step ${r.contact}, is ${fraction.toFixed(4)} of the ${DROP} m drop, not within ${WITHIN_OF_DROP} of ${QUARTER}`];
}

/**
 * Everything wrong with "runs on `name` `version`", read from the checkpoints a bake keeps (`checkpoints: true`): the
 * backend's whole-world state, each entry naming the backend that wrote it.
 */
export function backendFailures(reply: JsonObject, name: string, version: string, what: string): string[] {
  const list = reply['checkpoints'];
  if (!Array.isArray(list) || list.length === 0) return [`${what}: the bake lists no checkpoints (asked with checkpoints: true, one each 60 steps): ${show(list)}`];
  const out: string[] = [];
  for (const [i, c] of list.entries()) {
    const b = isObject(c) && isObject(c['backend']) ? c['backend'] : null;
    if (b?.['name'] !== name || b['version'] !== version) out.push(`${what}: checkpoint ${i} (step ${show(isObject(c) ? c['step'] : undefined)}) names the backend ${show(b)}, not ${name} ${version}`);
  }
  return out;
}
/** Everything wrong with "`crate` pinned to `version`": the versions Cargo.lock resolves it to aren't that one alone. */
export function pinFailures(crate: string, version: string): string[] {
  let lock: string;
  try { lock = readFileSync(join(REPO, 'Cargo.lock'), 'utf8'); } catch (e) { return [`Cargo.lock can't be read: ${(e as Error).message}`]; }
  const versions = [...lock.matchAll(/\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = "([^"]+)"/g)].filter((m) => m[1] === crate).map((m) => m[2]!);
  return versions.length === 1 && versions[0] === version ? [] : [`Cargo.lock resolves ${crate} to ${versions.length ? versions.join(' and ') : 'no version (the build links none)'}, not to ${version} alone`];
}

// ---------------------------------------------------------------------------------------------------
// The 3D worlds of criteria 2 and 3, on #191's `world` defaults (120 Hz, 4 substeps, rapier3d =0.36.1), gravity off.

/** A 3D body's state after a step: `pos` m, `linear` m/s, `angular` deg/s. */
export interface State { pos: Vec3; linear: Vec3; angular: Vec3 }
/** The states of body `id` over a bake of `steps` steps of a 3D world; or, as text, why they can't be read. */
export function statesOf(reply: JsonObject, id: string, steps: number, what: string): State[] | string {
  const series = seriesOf(reply, id, steps, what);
  if (typeof series === 'string') return series;
  const out: State[] = [];
  for (const [k, s] of series.entries()) {
    const [pos, linear, angular] = [numbers(s['pos'], 3), numbers(s['linear'], 3), numbers(s['angular'], 3)];
    if (!pos || !linear || !angular) return `${what}: bodies.${id}[${k}] isn't {pos, linear, angular}, three numbers each: ${show(s)}`;
    out.push({ pos: pos as Vec3, linear: linear as Vec3, angular: angular as Vec3 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: a body under `wind {velocity: (2, 0, 0)}` with `coupling: {kind: aero_triangles, coefficient: 1}`.

export const VANE = 'vane';
/** The wind's velocity, m/s, as the criterion writes it. */
export const WIND: Vec3 = [2, 0, 0];
/** A gust: `{amplitude, scale: m, speed: m/s}` (canvas primitives: Force). */
export interface Gust { amplitude: number; scale: number; speed: number }
/** This suite's gust: over the 2 s baked, a pattern 0.5 m across moving at 2 m/s passes eight of its lengths. */
export const GUST: Gust = { amplitude: 1, scale: 0.5, speed: 2 };
export const SEED = 7;
export const OTHER_SEED = 8;
/** One second, for the body the steady wind starts; two seconds of gusts. */
export const WIND_STEPS = RATE;
export const GUST_STEPS = 2 * RATE;

/**
 * A 1 kg box of 1 m, built at rest at the origin with no gravity, nothing near it, kept awake, under the force
 * `wind`: `wind {velocity: (2, 0, 0), coupling: {kind: aero_triangles, coefficient: 1}}`, with `gust` and `seed`
 * when given and left out otherwise, as the criterion's first clause leaves them out.
 */
export function windWorld(o: { gust?: Gust; seed?: number } = {}): JsonObject {
  const wind: JsonObject = { velocity: [...WIND], coupling: { kind: 'aero_triangles', coefficient: 1 } };
  if (o.gust) wind['gust'] = { ...o.gust };
  if (o.seed !== undefined) wind['seed'] = o.seed;
  return world({
    gravity: [0, 0, 0],
    shapes: { [VANE]: box([0.5, 0.5, 0.5]) },
    bodies: { [VANE]: { kind: 'dynamic', shapes: [use(VANE)], pose: { pos: [0, 0, 0] }, mass: 1, sleep: false } },
    forces: { wind: { kind: { wind }, applies_to: [VANE] } },
  });
}
/** The wind as the criterion's first clause writes it; the gusty wind under a seed; and the same wind and seed with no gust. */
export const steadyWind = (): JsonObject => windWorld();
export const gustyWind = (seed: number): JsonObject => windWorld({ gust: GUST, seed });
export const calmWind = (seed: number): JsonObject => windWorld({ seed });

/**
 * Everything wrong with the least a body that "reaches the wind's speed" from rest does: the steady wind moves it
 * along the wind, +x, in its first step (the wind is the same at every place and time, so a body it left at rest
 * once would be left there for good) and it is still moving that way at the run's end. When and how nearly it
 * reaches 2 m/s isn't judged here (README: For the early question).
 */
export function startedFailures(states: State[]): string[] {
  const out: string[] = [];
  const [built, first, last] = [states[0]!, states[1]!, states[states.length - 1]!];
  if (built.linear.some((v) => v !== 0)) out.push(`${VANE} isn't built at rest: its velocity is ${JSON.stringify(built.linear)} m/s`);
  if (!(first.linear[0] > 0)) out.push(`${VANE}: after its first step under a wind of ${WIND[0]} m/s along +x its velocity along +x is ${first.linear[0]} m/s, not above 0: the wind doesn't move it`);
  if (!(last.linear[0] > 0 && last.pos[0] > built.pos[0])) out.push(`${VANE}: after ${states.length - 1} steps it moves ${last.linear[0]} m/s along +x and has moved ${last.pos[0] - built.pos[0]} m along it, not along the wind`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: a box given `inertia` twice its shape's, and the same box without, each on a hinge whose motor
// presses at the same `max_torque`.

export const PLAIN = 'plain';
export const DOUBLED = 'doubled';
/** A cube of half 0.5 m and 6 kg: about each axis through its centre its shape's inertia is m × (b² + c²) ÷ 3 = 1 kg·m². */
export const CUBE_HALF = 0.5;
export const CUBE_MASS = 6;
export const SHAPE_INERTIA = (CUBE_MASS * (CUBE_HALF ** 2 + CUBE_HALF ** 2)) / 3;
/** The torque both hinges' motors press with, N·m, and the speed they aim for, deg/s, which neither box comes near. */
export const TORQUE = 1;
export const MOTOR_TARGET = 3600;
/** One second of spinning up. */
export const SPIN_STEPS = RATE;
const DEG = 180 / Math.PI;
/** The plain box's angular acceleration, deg/s²: torque ÷ its shape's inertia, 1 rad/s². */
export const SHAPE_ACCELERATION = (TORQUE / SHAPE_INERTIA) * DEG;
/** The criterion's bound: 1%. */
export const WITHIN = 0.01;

const axle = (body: string, at: Vec3): JsonObject => ({
  kind: 'hinge', a: 'world', b: body, frame_a: { anchor: [...at], axis: [0, 0, 1] }, frame_b: { anchor: [0, 0, 0], axis: [0, 0, 1] },
  motor: { mode: 'velocity', target: MOTOR_TARGET, max_torque: TORQUE, hz: 10, damping_ratio: 1 },
});
/**
 * Two cubes 10 m apart with no gravity, each on a hinge to the world about +z through its centre, each hinge's
 * velocity motor aiming far past what a second reaches at `max_torque: 1`. `plain` writes no `inertia`; `doubled`
 * writes `inertia: [2, 2, 2]`, twice the cube's own about each of its axes.
 */
export function spinWorld(): JsonObject {
  const cube = (x: number, extra: JsonObject = {}): JsonObject => ({ kind: 'dynamic', shapes: [use('cube')], pose: { pos: [x, 0, 0] }, mass: CUBE_MASS, sleep: false, ...extra });
  return world({
    gravity: [0, 0, 0],
    shapes: { cube: box([CUBE_HALF, CUBE_HALF, CUBE_HALF]) },
    bodies: { [PLAIN]: cube(-5), [DOUBLED]: cube(5, { inertia: [2 * SHAPE_INERTIA, 2 * SHAPE_INERTIA, 2 * SHAPE_INERTIA] }) },
    joints: { plain_axle: axle(PLAIN, [-5, 0, 0]), doubled_axle: axle(DOUBLED, [5, 0, 0]) },
  });
}

/** Each box's angular acceleration about its hinge over the run, deg/s²: its turn rate about +z at the end less the built one, over the run's time. */
export interface SpinUp { plain: number; doubled: number }
export function spinUpOf(reply: JsonObject, what: string): SpinUp | string {
  const rate = (id: string): number | string => {
    const s = statesOf(reply, id, SPIN_STEPS, what);
    return typeof s === 'string' ? s : (s[SPIN_STEPS]!.angular[2] - s[0]!.angular[2]) / (SPIN_STEPS / RATE);
  };
  const [plain, doubled] = [rate(PLAIN), rate(DOUBLED)];
  if (typeof plain === 'string') return plain;
  return typeof doubled === 'string' ? doubled : { plain, doubled };
}
/**
 * Everything wrong with "a box given `inertia` twice its shape's spins up at half the angular acceleration under the
 * same torque, within 1%": the plain box spins up at the torque over its shape's inertia, so the torque is the one
 * written and the cube's inertia the one `doubled` doubles; `doubled` spins up at half of the plain box's.
 */
export function spinFailures(s: SpinUp): string[] {
  const out: string[] = [];
  if (!(Math.abs(s.plain - SHAPE_ACCELERATION) <= WITHIN * SHAPE_ACCELERATION)) out.push(`${PLAIN}: with no inertia written it spins up at ${s.plain.toFixed(4)} deg/s², not at ${TORQUE} N·m ÷ ${SHAPE_INERTIA} kg·m² = ${SHAPE_ACCELERATION.toFixed(4)} deg/s² within 1%`);
  const ratio = s.doubled / s.plain;
  if (!(s.plain > 0 && Math.abs(ratio - 0.5) <= WITHIN * 0.5)) out.push(`${DOUBLED}: given inertia twice its shape's it spins up at ${s.doubled.toFixed(4)} deg/s², ${ratio.toFixed(4)} of ${PLAIN}'s ${s.plain.toFixed(4)} deg/s² under the same torque, not half of it within 1%`);
  return out;
}
