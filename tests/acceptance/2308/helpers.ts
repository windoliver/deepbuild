// Test-side tools for the #2308 acceptance tests (README: The surface under test). They drive the physics runner
// `deep-physics` (JSON lines in, one reply per line) through #191's builds, as #2309's and #2241's suites do, and add
// only this issue's worlds, its planted names, its test backend and its judges. Nothing here stands in for the check,
// the lint, the solver, the behavior kit or a backend: every issue, body state, occurrence, hash, key and kit row read
// here is the implementation's own, and every expected value is the issue's, copied or worked here from its closed form.
//
// No function here asserts. What a program answers and what a judge finds wrong with it both come back as text, so
// each test's failing assertion is in its own file; a reply that can't be read comes back as a sentence starting
// `INCONCLUSIVE:`, which fails its test like any other. Only a process that can't be run at all throws, `BLOCKED:` or
// `INCONCLUSIVE:` first, as the base's suites do: nothing unrun or unread passes.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import {
  G, REFERENCE, REPO, TIMEOUT, isObject, mergeBase, mergeBasePhysics, physicsBin, show,
  type JsonObject, type JsonValue, type PhysicsBuild,
} from '../191/helpers.ts';

export { G, REFERENCE, TIMEOUT, kitCall, prebuild, show, type JsonObject, type JsonValue } from '../191/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#2308.e596080e', 2: '#2308.1cbd6c33', 3: '#2308.3e70c06d', 4: '#2308.567c906d', 5: '#2308.762099ef', 6: '#2308.66a34a77',
} as const;

/** This suite's planted names (`deep-physics --planted <name>`), each one criterion's wrong program (README). */
export type Planted =
  | 'wrapper_ignores_length_unit' | 'wrapper_ignores_contact_hz' | 'wrapper_scales_speed_cap' | 'wrapper_scales_sleep_speed'
  | 'lint_reads_first_shape' | 'check_reads_range_only';
/** This suite's test backend (`deep-physics --backend <name>` in the `test-backends` build): Rapier whose caps() say it scales no lengths. */
export type TestBackend = 'no_length_unit';
export const NO_LENGTH_UNIT: TestBackend = 'no_length_unit';

// ---------------------------------------------------------------------------------------------------
// The runner: this checkout's release build (#191's `release`), its `test-backends` build, and the merge base's.

export interface Runner { planted?: Planted; backend?: TestBackend; build?: PhysicsBuild }
/**
 * What one process answered: `problem` is '' and `replies` holds one object per call, or `problem` says what the
 * program did instead (a name it doesn't know exits 2 with `bad_input`).
 */
export interface Asked { what: string; problem: string; replies: JsonObject[] }

const MINUTES = (TIMEOUT - 300_000) / 60_000;
function runOn(bin: string, args: string[], calls: JsonObject[], what: string): Asked {
  const run = spawnSync(bin, args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
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

/**
 * Runs `calls` through one `deep-physics [--backend b] [--planted p]` process of this checkout: the release build, or
 * the `test-backends` build for a test backend. A name the build doesn't know comes back as `problem`, never a throw.
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
 * Runs `calls` through the merge base's release deep-physics (#191's `mergeBasePhysics`), built once for the file.
 * With no merge base to name, or none that builds, nothing was compared: it throws `BLOCKED:`.
 */
export function askBase(calls: JsonObject[]): Asked & { sha: string } {
  if (!base) {
    let sha = '';
    let problem = '';
    try { sha = mergeBase(); } catch (e) { problem = `git merge-base HEAD origin/main names no merge base: ${(e as Error).message.split('\n')[0] ?? ''}`; }
    let bin = '';
    if (sha !== '') {
      baseDir = mkdtempSync(join(tmpdir(), 'deep-2308-base-'));
      bin = join(baseDir, 'deep-physics-base');
      let error: string;
      try { error = mergeBasePhysics(sha, bin); } catch (e) { error = (e as Error).message; }
      if (error !== '') problem = `the merge base ${sha.slice(0, 12)} gives no release deep-physics: ${error.replace(/^BLOCKED: /, '')}`;
    }
    base = { sha, bin, problem };
  }
  if (base.problem !== '') throw Error(`BLOCKED: ${base.problem}`);
  return { ...runOn(base.bin, [], calls, `the merge base's deep-physics (${base.sha.slice(0, 12)})`), sha: base.sha };
}

// ---------------------------------------------------------------------------------------------------
// The fixture's world (criterion 1's words): `step_rate: 480`, 4 substeps, `contact_hz: 240`, `length_unit: 0.01`,
// g = 9.81 m/s². Every other field is the behavior kit's own world's (crates/deep-canvas-physics/src/kit/fixtures.rs):
// its capacity, its floor, a dynamic body with `sleep: false`. README: The worlds.

export type Vec3 = [number, number, number];
export const RATE = 480;
export const SUBSTEPS = 4;
export const CONTACT_HZ = 240;
export const LENGTH_UNIT = 0.01;
/** The side of a 1 cm cube, m, and half of it. */
export const SIDE = 0.01;
const HALF = SIDE / 2;

/** What a variant of a world writes otherwise than the fixture's world; `null` leaves the field unwritten. */
export interface Settings { stepRate?: number; contactHz?: number | null; lengthUnit?: number | null }
function at(parts: JsonObject, s: Settings = {}): JsonObject {
  const solver: JsonObject = {};
  const hz = s.contactHz === undefined ? CONTACT_HZ : s.contactHz;
  const unit = s.lengthUnit === undefined ? LENGTH_UNIT : s.lengthUnit;
  if (hz !== null) solver['contact_hz'] = hz;
  if (unit !== null) solver['length_unit'] = unit;
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: s.stepRate ?? RATE, substeps: SUBSTEPS, gravity: [0, -G, 0], mode: 'dynamic',
    capacity: { bodies: 32, shapes: 32, joints: 4, contacts: 128, particles: 0 },
    ...(Object.keys(solver).length ? { solver } : {}),
    ...parts,
  };
}
const material = (friction: number, restitution: number): JsonObject => ({ friction, restitution, density: 1000 });
const cubeShape = (side: number): JsonObject => ({ kind: 'box', half: [side / 2, side / 2, side / 2] });
/** The kit's floor: a static box whose top face is y = 0. */
const FLOOR: JsonObject = { kind: 'box', half: [10, 0.1, 10] };
const floor = (m: string): JsonObject => ({ kind: 'static', shapes: [{ shape: 'floor', contact_material: m }], pose: { pos: [0, -0.1, 0] } });
const dynamic = (shape: string, m: string, pos: Vec3, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'dynamic', shapes: [{ shape, contact_material: m }], pose: { pos }, sleep: false, ...extra });

/** A fixture as this suite holds it: its name in the kit, its world and how many steps it runs. */
export interface Small { name: string; world: JsonObject; steps: number }
export const bake = (w: JsonObject, steps: number, extra: JsonObject = {}): JsonObject => ({ call: 'bake', world: w, steps, ...extra });
export const check = (w: JsonObject): JsonObject => ({ call: 'check', world: w });

// --- The edge (criterion 1) ---
export const CUBE = 'cube';
/** 0.886 m/s, as the issue prints it: 4 sides ÷ √(2 × side ÷ g) = 0.8859 m/s crosses four sides while a free body falls one. */
export const EDGE_SPEED = 0.886;
/** The cube's centre starts four sides before the table's edge, which is the plane x = 0. */
export const EDGE_START = -4 * SIDE;
export function edge(s: Settings = {}): Small {
  return {
    name: 'small_edge', steps: 120,
    world: at({
      contact_materials: { m: material(0, 0) },
      shapes: { cube: cubeShape(SIDE), table: { kind: 'box', half: [0.1, 0.05, 0.1] } },
      bodies: {
        table: { kind: 'static', shapes: [{ shape: 'table', contact_material: 'm' }], pose: { pos: [-0.1, -0.05, 0] } },
        [CUBE]: dynamic('cube', 'm', [EDGE_START, HALF, 0], { velocity: { linear: [EDGE_SPEED, 0, 0] } }),
      },
    }, s),
  };
}

// --- The stack, the bounce and the slide (criterion 2) ---
export const cubeOf = (k: number): string => `cube${k}`;
export const TOP = cubeOf(5);
export function stack(s: Settings = {}): Small {
  const bodies: JsonObject = { floor: floor('m') };
  for (let k = 1; k <= 5; k += 1) bodies[cubeOf(k)] = dynamic('cube', 'm', [0, (k - 0.5) * SIDE, 0]);
  return { name: 'small_stack', steps: 3 * RATE, world: at({ contact_materials: { m: material(0.5, 0) }, shapes: { cube: cubeShape(SIDE), floor: FLOOR }, bodies }, s) };
}
export const BALL = 'ball';
/** A ball of restitution 0.5 and diameter `d` m, its lowest point `h` m above a floor of restitution 0, under the `max` rule. */
function drop(d: number, h: number, s: Settings): JsonObject {
  return at({
    combine: { friction: 'geometric', restitution: 'max' },
    contact_materials: { ball: material(0, 0.5), ground: material(0, 0) },
    shapes: { ball: { kind: 'sphere', radius: d / 2 }, floor: FLOOR },
    bodies: { floor: floor('ground'), [BALL]: dynamic('ball', 'ball', [0, h + d / 2, 0]) },
  }, s);
}
export const bounce = (s: Settings = {}): Small => ({ name: 'small_bounce', steps: RATE / 2, world: drop(SIDE, 0.1, s) });
/** A 1 cm cube of friction 0.5 on a floor of 0.5, sliding from `speed` m/s along +x; `sleep` as the body writes it. */
function slider(speed: number, sleep: boolean, s: Settings): JsonObject {
  return at({
    contact_materials: { m: material(0.5, 0) },
    shapes: { cube: cubeShape(SIDE), floor: FLOOR },
    bodies: { floor: floor('m'), [CUBE]: dynamic('cube', 'm', [0, HALF, 0], { velocity: { linear: [speed, 0, 0] }, sleep }) },
  }, s);
}
export const SLIDE_SPEED = 0.7;
export const slide = (s: Settings = {}): Small => ({ name: 'small_slide', steps: RATE / 2, world: slider(SLIDE_SPEED, false, s) });

// --- Big among small (criterion 3): no fixture of the kit, the same world's settings ---
/** A 1 m ball, its lowest point 10 m up; 4 s, so a ball held to 4 m/s still shows its bounce. */
export const bigBall = (s: Settings = {}): { world: JsonObject; steps: number } => ({ world: drop(1, 10, s), steps: 4 * RATE });
/** A 1 cm cube sliding to rest from 0.2 m/s that may sleep (`sleep: true`), under the world's own sleep speed and time. */
export const sleeper = (s: Settings = {}): { world: JsonObject; steps: number } => ({ world: slider(0.2, true, s), steps: RATE });

// --- The dominoes (criterion 4) ---
/** 48 × 24 × 7.5 mm: each stands 48 mm tall (y) and 24 mm wide (z), 7.5 mm thick along the row (x). */
export const DOMINO = { tall: 0.048, wide: 0.024, thick: 0.0075 } as const;
export const DOMINOES = 10;
/** 20 mm apart: from one domino's centre to the next's, along +x (README: readings). */
export const PITCH = 0.02;
/** The first is tipped 10° toward the second. */
export const TIP = 10;
export const dominoOf = (k: number): string => `domino${k}`;
export function dominoes(s: Settings = {}): Small {
  const { tall, wide, thick } = DOMINO;
  const bodies: JsonObject = { floor: floor('m') };
  for (let k = 2; k <= DOMINOES; k += 1) bodies[dominoOf(k)] = dynamic('domino', 'm', [(k - 1) * PITCH, tall / 2, 0]);
  // The first is tipped 10° about its far bottom edge, the one on the second's side, which stays on the floor at
  // x = thick ÷ 2: its centre, (−thick ÷ 2, tall ÷ 2) from that edge when it stands, is turned 10° about it.
  const [sin, cos] = [Math.sin((TIP * Math.PI) / 180), Math.cos((TIP * Math.PI) / 180)];
  const centre: Vec3 = [thick / 2 - (thick / 2) * cos + (tall / 2) * sin, (thick / 2) * sin + (tall / 2) * cos, 0];
  bodies[dominoOf(1)] = dynamic('domino', 'm', centre, { pose: { pos: centre, rot: [0, 0, -TIP] } });
  return {
    name: 'small_dominoes', steps: 4 * RATE,
    world: at({ contact_materials: { m: material(0.5, 0) }, shapes: { domino: { kind: 'box', half: [thick / 2, tall / 2, wide / 2] }, floor: FLOOR }, bodies }, s),
  };
}

// ---------------------------------------------------------------------------------------------------
// Reading a bake (the base's `bake` call: `bodies.<ID>[k]` is the state after step k, `step_hashes[k]` its hash).

export interface State { pos: Vec3; rot: number[]; linear: Vec3; angular: Vec3 }
const numbers = (v: JsonValue | undefined, n: number): number[] | null =>
  (Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : null);
/** Why a reply isn't a bake or a clean check, in its own words: its issues' codes, fields and sentences. */
export function refusal(reply: JsonObject): string {
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  return issues.length ? issues.map((i) => `${String(i['code'])} at ${String(i['path'])}: ${String(i['what'])}`).join('; ').slice(0, 1200) : show(reply);
}
/** An accepted bake's states of body `id`, the built state and one per step; or, as text, why there are none. */
export function statesOf(reply: JsonObject, id: string, steps: number, what: string): State[] | string {
  if (reply['ok'] !== true) return `${what} isn't baked: ${refusal(reply)}`;
  const series = isObject(reply['bodies']) ? reply['bodies'][id] : undefined;
  if (!Array.isArray(series)) return `INCONCLUSIVE: ${what}: the bake lists no states of body ${id}: ${show(reply['bodies']).slice(0, 300)}`;
  if (series.length !== steps + 1) return `INCONCLUSIVE: ${what}: ${id} has ${series.length} states, not the built one and one for each of ${steps} steps`;
  const out: State[] = [];
  for (const [k, v] of series.entries()) {
    const s = isObject(v) ? v : {};
    const [pos, rot, linear, angular] = [numbers(s['pos'], 3), numbers(s['rot'], 4), numbers(s['linear'], 3), numbers(s['angular'], 3)];
    if (!pos || !rot || !linear || !angular) return `INCONCLUSIVE: ${what}: bodies.${id}[${k}] isn't {pos, rot, linear, angular}: ${show(v)}`;
    out.push({ pos: pos as Vec3, rot, linear: linear as Vec3, angular: angular as Vec3 });
  }
  return out;
}
export const speedOf = (s: State): number => Math.hypot(...s.linear);

// ---------------------------------------------------------------------------------------------------
// The judges. Each reads one bake and returns what the criterion's words read of it (printed by the tests) and
// everything wrong with it as sentences, each starting with what its criterion says a failure names.

const mm = (m: number): string => `${(m * 1000).toFixed(3)} mm`;
/** What a judge found: its sentences, none when the bake holds the criterion; `measured` is what the kit's row lists. */
export interface Judged { failures: string[]; measured: number | null }
const unread = (why: string): Judged => ({ failures: [why], measured: null });

// --- The edge (criterion 1) ---
/** "Has dropped 0.5 mm": a twentieth of the cube's side below the height it was built at. */
export const DROP = SIDE / 20;
/** "Before its centre is 1.6 sides past the edge". */
export const EDGE_MOST = 1.6;
export interface EdgeRead extends Judged { step: number | null; sides: number | null }
/**
 * The first step at whose end the cube's centre is 0.5 mm below where it was built, and how far past the table's edge
 * (x = 0) its centre is then, in sides. It fails when that is 1.6 sides or more, when the cube never drops, and when it
 * drops with its centre still over the table (it fell through, it didn't slide off). Each failure names the cube and the step.
 */
export function edgeRead(reply: JsonObject, steps: number, what: string): EdgeRead {
  const states = statesOf(reply, CUBE, steps, what);
  if (typeof states === 'string') return { ...unread(states), step: null, sides: null };
  const built = states[0]!.pos[1];
  const step = states.findIndex((s) => built - s.pos[1] >= DROP);
  if (step < 0) return { failures: [`${CUBE}: ${what}: it never drops ${mm(DROP)}; at step ${steps}, the last, its centre is ${(states[steps]!.pos[0] / SIDE).toFixed(2)} sides past the edge and ${mm(built - states[steps]!.pos[1])} down`], measured: null, step: null, sides: null };
  const x = states[step]!.pos[0];
  const sides = x / SIDE;
  const failures: string[] = [];
  if (!(sides < EDGE_MOST)) failures.push(`${CUBE}: ${what}: it has not dropped ${mm(DROP)} until step ${step}, its centre ${sides.toFixed(2)} sides past the edge, not before ${EDGE_MOST} sides`);
  if (!(x > 0)) failures.push(`${CUBE}: ${what}: it has dropped ${mm(DROP)} at step ${step} with its centre ${(-sides).toFixed(2)} sides before the edge, so it didn't slide off the table`);
  return { failures, measured: x, step, sides };
}

// --- The stack (criterion 2) ---
/** 4.5 sides up, within 2% of a side; within 1% of a side aside; slower than 1 mm/s through the third second. */
export const STACK_TOP = 4.5 * SIDE;
export const STACK_WITHIN = 0.02 * SIDE;
export const STACK_ASIDE = 0.01 * SIDE;
export const STILL = 0.001;
export interface StackRead extends Judged { low: number | null; aside: number | null; fastest: { id: string; speed: number; step: number }[] }
/** Where the top cube's centre ends, and each cube's largest speed in the third second (the states after steps 961 to 1440). */
export function stackRead(reply: JsonObject, steps: number, what: string): StackRead {
  const all: State[][] = [];
  for (let k = 1; k <= 5; k += 1) {
    const s = statesOf(reply, cubeOf(k), steps, what);
    if (typeof s === 'string') return { ...unread(s), low: null, aside: null, fastest: [] };
    all.push(s);
  }
  const [top, built] = [all[4]![steps]!.pos, all[4]![0]!.pos];
  const low = STACK_TOP - top[1];
  const aside = Math.hypot(top[0] - built[0], top[2] - built[2]);
  const fastest = all.map((s, i) => {
    let [speed, step] = [-1, 2 * RATE + 1];
    for (let k = 2 * RATE + 1; k <= 3 * RATE; k += 1) if (speedOf(s[k]!) > speed) [speed, step] = [speedOf(s[k]!), k];
    return { id: cubeOf(i + 1), speed, step };
  });
  const failures: string[] = [];
  const share = (m: number): string => `${((m / SIDE) * 100).toFixed(1)}% of a side`;
  if (!(Math.abs(low) <= STACK_WITHIN)) failures.push(`${TOP}: ${what}: the top cube's centre ends ${(top[1] / SIDE).toFixed(4)} sides up, ${mm(Math.abs(low))} (${share(Math.abs(low))}) ${low > 0 ? 'below' : 'above'} 4.5 sides, not within 2% of a side`);
  if (!(aside <= STACK_ASIDE)) failures.push(`${TOP}: ${what}: the top cube's centre ends ${mm(aside)} (${share(aside)}) aside of where it was built, not within 1% of a side`);
  for (const f of fastest) if (!(f.speed < STILL)) failures.push(`${f.id}: ${what}: it moves ${(f.speed * 1000).toFixed(3)} mm/s at step ${f.step}, in the third second, not slower than 1 mm/s`);
  return { failures, measured: low, low, aside, fastest };
}

// --- A bounce (criteria 2 and 3) ---
export const WITHIN = 0.03;
export interface BounceRead extends Judged { height: number | null; step: number | null }
/**
 * "First bounces to": how high the ball's lowest point is at the top of its first rise, the first step after which it
 * comes down again once it has gone up. It fails unless that is `answer` m within 3%. Each failure names the ball.
 */
export function bounceRead(reply: JsonObject, steps: number, radius: number, answer: number, what: string): BounceRead {
  const states = statesOf(reply, BALL, steps, what);
  if (typeof states === 'string') return { ...unread(states), height: null, step: null };
  const y = states.map((s) => s.pos[1]);
  let k = 1;
  while (k <= steps && !(y[k]! > y[k - 1]!)) k += 1;
  if (k > steps) return { failures: [`${BALL}: ${what}: it never bounces; it never rises in ${steps} steps and ends with its lowest point ${(y[steps]! - radius).toFixed(5)} m up`], measured: null, height: null, step: null };
  while (k < steps && y[k + 1]! > y[k]!) k += 1;
  if (k === steps) return { failures: [`INCONCLUSIVE: ${BALL}: ${what}: it is still rising at step ${steps}, the last, so the top of its first bounce isn't in the run`], measured: null, height: null, step: null };
  const height = y[k]! - radius;
  const off = (height - answer) / answer;
  const failures = Math.abs(off) <= WITHIN ? [] : [`${BALL}: ${what}: it first bounces to ${height.toFixed(5)} m, at step ${k}, ${(Math.abs(off) * 100).toFixed(1)}% ${off < 0 ? 'low' : 'high'} of ${answer} m, not within 3%`];
  return { failures, measured: height, height, step: k };
}

// --- The slide (criterion 2) ---
/** "To rest in 0.05 m": v² ÷ (2μg) = 0.7² ÷ (2 × 0.5 × 9.81) = 0.04995 m, which the issue prints as 0.05 m. */
export const SLIDE = 0.05;
export interface SlideRead extends Judged { moved: number | null; speed: number | null }
/** How far along the floor the cube is from where it was built after the last step, and how fast it still moves. */
export function slideRead(reply: JsonObject, steps: number, what: string): SlideRead {
  const states = statesOf(reply, CUBE, steps, what);
  if (typeof states === 'string') return { ...unread(states), moved: null, speed: null };
  const [a, z] = [states[0]!.pos, states[steps]!.pos];
  const moved = Math.hypot(z[0] - a[0], z[2] - a[2]);
  const speed = speedOf(states[steps]!);
  const off = (moved - SLIDE) / SLIDE;
  const failures: string[] = [];
  if (!(speed < STILL)) failures.push(`${CUBE}: ${what}: it isn't at rest at step ${steps}, the last; it still moves ${(speed * 1000).toFixed(3)} mm/s`);
  if (!(Math.abs(off) <= WITHIN)) failures.push(`${CUBE}: ${what}: it slides ${moved.toFixed(5)} m to rest, ${(Math.abs(off) * 100).toFixed(1)}% ${off < 0 ? 'short' : 'long'} of ${SLIDE} m, not within 3%`);
  return { failures, measured: moved, moved, speed };
}

// --- The sleep (criterion 3) ---
/** The world's sleep speed and time, its defaults (`solver.sleep`: 0.05 m/s and 0.5 s), which the worlds here leave unwritten. */
export const SLEEP_SPEED = 0.05;
export const SLEEP_STEPS = 0.5 * RATE;
export interface SleepRead extends Judged { under: number | null; rest: number | null; due: number | null }
/**
 * "Writes `rest` and sleeps within the world's sleep time plus 2 steps of its speed falling under 0.05 m/s": the step of
 * the cube's first `rest` row, against the first step from which its speed stays under 0.05 m/s (as #191's `sleep`
 * fixture reads it) plus the sleep time's 240 steps plus 2. Each failure names the cube and the step.
 */
export function sleepRead(reply: JsonObject, steps: number, what: string): SleepRead {
  const states = statesOf(reply, CUBE, steps, what);
  if (typeof states === 'string') return { ...unread(states), under: null, rest: null, due: null };
  const rows = Array.isArray(reply['occurrences']) ? reply['occurrences'].filter(isObject) : null;
  if (!rows) return { ...unread(`INCONCLUSIVE: ${what}: the bake lists no occurrences: ${show(reply['occurrences']).slice(0, 300)}`), under: null, rest: null, due: null };
  const row = rows.find((r) => r['kind'] === 'rest' && r['a'] === CUBE);
  const rest = row && typeof row['step'] === 'number' ? row['step'] : null;
  let under = rest ?? steps;
  while (under > 0 && speedOf(states[under - 1]!) < SLEEP_SPEED) under -= 1;
  const due = under + SLEEP_STEPS + 2;
  const since = `its speed is under ${SLEEP_SPEED} m/s from step ${under}, and the world's sleep time is ${SLEEP_STEPS} steps, plus 2`;
  const failures: string[] = [];
  if (!(speedOf(states[0]!) >= SLEEP_SPEED)) failures.push(`${CUBE}: ${what}: it never slides; it is built at ${speedOf(states[0]!)} m/s`);
  if (rest === null) failures.push(`${CUBE}: ${what}: it writes no rest in ${steps} steps, where one is due by step ${due}: ${since}`);
  else if (!(rest <= due)) failures.push(`${CUBE}: ${what}: it writes rest at step ${rest}, later than step ${due}: ${since}`);
  return { failures, measured: rest === null ? null : rest - under, under, rest, due };
}

// --- The dominoes (criterion 4) ---
type Mat = [Vec3, Vec3, Vec3];
/** A unit quaternion [x, y, z, w]'s three axes: where it turns the body's own x, y and z. */
function axes(q: number[]): Mat {
  const [x, y, z, w] = [q[0]!, q[1]!, q[2]!, q[3]!];
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  ];
}
const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/**
 * How far two boxes of half extents `half` are inside each other, m: the least distance one must move to stop
 * overlapping the other, which for two boxes is their least overlap along their fifteen separating axes (each one's
 * three face normals and the nine crosses of their edges); 0 when one of those axes separates them.
 */
export function inside(a: State, b: State, half: Vec3): number {
  const [ua, ub] = [axes(a.rot), axes(b.rot)];
  const d: Vec3 = [b.pos[0] - a.pos[0], b.pos[1] - a.pos[1], b.pos[2] - a.pos[2]];
  const candidates: Vec3[] = [...ua, ...ub, ...ua.flatMap((x) => ub.map((y) => cross(x, y)))];
  let least = Infinity;
  for (const c of candidates) {
    const n = Math.hypot(...c);
    if (n < 1e-9) continue;
    const reach = (u: Mat): number => half[0] * Math.abs(dot(u[0], c)) + half[1] * Math.abs(dot(u[1], c)) + half[2] * Math.abs(dot(u[2], c));
    least = Math.min(least, (reach(ua) + reach(ub) - Math.abs(dot(d, c))) / n);
  }
  return Math.max(0, least);
}
/** How far a domino leans from upright, degrees: the angle between its tall axis and the world's +y. */
export const lean = (s: State): number => (Math.acos(Math.max(-1, Math.min(1, axes(s.rot)[1][1]))) * 180) / Math.PI;
export const PASS = 45;
/** The last passes 45° between 0.6 s and 0.8 s; at 4 s no two neighbours are more than 0.05 of a thickness inside each other. */
export const LAST = { from: 0.6, to: 0.8 } as const;
export const INSIDE_MOST = 0.05 * DOMINO.thick;
export interface DominoRead extends Judged { passed: (number | null)[]; depths: number[]; pair: [string, string] | null }
/**
 * The step at whose end each domino first leans more than 45°, and how far each two neighbours are inside each other
 * after the last step (4 s). It fails unless all ten pass in order, the last between 0.6 s and 0.8 s, and no two
 * neighbours are more than 0.05 of a thickness inside each other; that failure names the pair.
 */
export function dominoRead(reply: JsonObject, steps: number, what: string): DominoRead {
  const all: State[][] = [];
  for (let k = 1; k <= DOMINOES; k += 1) {
    const s = statesOf(reply, dominoOf(k), steps, what);
    if (typeof s === 'string') return { ...unread(s), passed: [], depths: [], pair: null };
    all.push(s);
  }
  const passed = all.map((s) => { const k = s.findIndex((x) => lean(x) > PASS); return k < 0 ? null : k; });
  const half: Vec3 = [DOMINO.thick / 2, DOMINO.tall / 2, DOMINO.wide / 2];
  const depths = all.slice(1).map((s, i) => inside(all[i]![steps]!, s[steps]!, half));
  const failures: string[] = [];
  passed.forEach((k, i) => {
    const before = i > 0 ? passed[i - 1] : undefined;
    if (k === null) failures.push(`${dominoOf(i + 1)}: ${what}: it never leans past ${PASS}°; it ends at ${lean(all[i]![steps]!).toFixed(1)}°`);
    else if (typeof before === 'number' && !(k > before)) failures.push(`${dominoOf(i + 1)}: ${what}: it leans past ${PASS}° at step ${k}, not after ${dominoOf(i)}, which passes at step ${before}, so the ten don't pass in order`);
  });
  const last = passed[DOMINOES - 1];
  if (typeof last === 'number' && !(last / RATE >= LAST.from && last / RATE <= LAST.to)) failures.push(`${dominoOf(DOMINOES)}: ${what}: the last leans past ${PASS}° at step ${last}, ${(last / RATE).toFixed(3)} s, not between ${LAST.from} s and ${LAST.to} s`);
  let worst = 0;
  depths.forEach((d, i) => {
    if (d > depths[worst]!) worst = i;
    if (!(d <= INSIDE_MOST)) failures.push(`${dominoOf(i + 1)} and ${dominoOf(i + 2)}: ${what}: they are ${mm(d)} (${(d / DOMINO.thick).toFixed(3)} of a thickness) inside each other after step ${steps}, more than 0.05 of a thickness`);
  });
  return { failures, measured: depths[worst]!, passed, depths, pair: [dominoOf(worst + 1), dominoOf(worst + 2)] };
}

// ---------------------------------------------------------------------------------------------------
// The five small fixtures in the behavior kit's data (README: The fixtures in the behavior kit), read from the base's
// `behavior_fixtures` and `behavior_kit` calls.

/** What the kit's data holds a small fixture to: its answer (within `room` of it) and its tolerance, one key and its value. */
export interface Held { answer: number; room: number; tolerance: ['m' | 'relative', number] }
export const HELD: Record<string, Held> = {
  small_edge: { answer: EDGE_MOST * SIDE, room: 1e-12, tolerance: ['m', 0] },
  small_stack: { answer: 0, room: 0, tolerance: ['m', STACK_WITHIN] },
  small_bounce: { answer: 0.025, room: 1e-12, tolerance: ['relative', WITHIN] },
  // 0.05 m as the issue prints it, or its closed form, 0.04995 m.
  small_slide: { answer: SLIDE, room: 0.0001, tolerance: ['relative', WITHIN] },
  small_dominoes: { answer: 0, room: 0, tolerance: ['m', INSIDE_MOST] },
};

const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
/** Where two JSON values differ, as paths: objects by key whatever their order, lists by place, numbers within 1e-12. */
export function differences(a: JsonValue | undefined, b: JsonValue | undefined, path = ''): string[] {
  if (typeof a === 'number' && typeof b === 'number') return near(a, b) ? [] : [`${path}: ${a} against ${b}`];
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [`${path}: ${a.length} entries against ${b.length}`];
    return a.flatMap((x, i) => differences(x, b[i], `${path}/${i}`));
  }
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => (k in a && k in b ? differences(a[k], b[k], `${path}/${k}`) : [`${path}/${k}: ${k in a ? 'only in the kit\'s' : 'not in the kit\'s'}`]));
  }
  return a === b ? [] : [`${path}: ${show(a).slice(0, 80)} against ${show(b).slice(0, 80)}`];
}

export interface KitRow { backend: string; result: string; measured: number | null; answer: JsonValue | undefined; tolerance: JsonValue | undefined; what: string; raw: JsonObject }
export interface Kit { data: JsonObject; row: KitRow }
/** The kit's data for fixture `f` and its one row for it; or, as text, why they can't be read: nothing here passes unread. */
export function kitOf(fixtures: JsonObject, report: JsonObject, f: Small, on: string): Kit | string {
  if (fixtures['ok'] !== true || !Array.isArray(fixtures['fixtures'])) return `INCONCLUSIVE: ${on}: behavior_fixtures didn't answer {ok: true, fixtures}: ${show(fixtures).slice(0, 300)}`;
  const all = fixtures['fixtures'].filter(isObject);
  const mine = all.filter((x) => x['name'] === f.name);
  if (mine.length !== 1) return `${on}: the kit's data holds ${f.name} ${mine.length} times, once expected, among its ${all.length} fixtures`;
  if (report['ok'] !== true || !Array.isArray(report['results'])) return `INCONCLUSIVE: ${on}: behavior_kit didn't answer {ok: true, results}: ${show(report).slice(0, 300)}`;
  const rows = report['results'].filter(isObject).filter((r) => r['fixture'] === f.name);
  if (rows.length !== 1) return `${on}: the kit's report holds ${f.name} ${rows.length} times, once expected (admitted ${show(report['admitted'])}, verdict ${show(report['verdict'])})`;
  const r = rows[0]!;
  return {
    data: mine[0]!,
    row: { backend: String(r['backend']), result: String(r['result']), measured: typeof r['measured'] === 'number' ? r['measured'] : null, answer: r['answer'], tolerance: r['tolerance'], what: typeof r['what'] === 'string' ? r['what'] : '', raw: r },
  };
}
/** Everything about the kit's data for a small fixture that isn't this suite's: its world, its steps, its answer and its tolerance. */
export function dataFailures(data: JsonObject, f: Small): string[] {
  const out: string[] = [];
  const held = HELD[f.name]!;
  const world = differences(data['world'], f.world);
  if (world.length) out.push(`${f.name}: the kit's world isn't the criterion's world as this suite builds it (README: The worlds); it differs at ${world.slice(0, 8).join('; ')}${world.length > 8 ? `; and ${world.length - 8} more` : ''}`);
  if (data['steps'] !== f.steps) out.push(`${f.name}: the kit runs it ${show(data['steps'])} steps, not ${f.steps}`);
  const answer = data['answer'];
  if (typeof answer !== 'number' || Math.abs(answer - held.answer) > held.room + 1e-15) out.push(`${f.name}: the kit's answer is ${show(answer)}, not ${held.answer}`);
  const [unit, value] = held.tolerance;
  const t = isObject(data['tolerance']) ? data['tolerance'] : {};
  const got = t[unit];
  if (Object.keys(t).length !== 1 || typeof got !== 'number' || !near(got, value)) out.push(`${f.name}: the kit's tolerance is ${show(data['tolerance'])}, not {"${unit}": ${value}}`);
  return out;
}
/** A measure in metres agrees within a micrometre: the kit and this suite read the same states. */
export const AGREES = 1e-6;
/**
 * Everything wrong with the kit's row for a small fixture on the reference backend: it doesn't read `result`, its answer
 * and tolerance aren't the interface's, or its `measured` isn't what this suite's judge read of the same world's bake
 * on the same program (`measured`, m, within a micrometre). A fail's text names the backend and the fixture (design).
 */
export function rowFailures(k: Kit, f: Small, result: 'pass' | 'fail', measured: number | null, backend: string): string[] {
  const out: string[] = [];
  const r = k.row;
  if (r.result !== result) out.push(`${f.name}: the kit's row reads ${r.result}, not ${result}: ${r.what || show(r.raw).slice(0, 400)}`);
  if (r.backend !== backend) out.push(`${f.name}: the kit's row names backend ${r.backend}, not ${backend}`);
  if (differences(r.answer, k.data['answer']).length || differences(r.tolerance, k.data['tolerance']).length) out.push(`${f.name}: the row's answer and tolerance, ${show(r.answer)} and ${show(r.tolerance)}, aren't the interface's, ${show(k.data['answer'])} and ${show(k.data['tolerance'])}`);
  if (measured === null) out.push(`INCONCLUSIVE: ${f.name}: this suite read no measure of the same world's bake to hold the row's ${show(r.measured)} to`);
  else if (r.measured === null || !(Math.abs(r.measured - measured) <= AGREES)) out.push(`${f.name}: the kit's row measures ${show(r.measured)} m, where the same world baked on the same program reads ${measured} m`);
  if (result === 'fail' && (!r.what.includes(backend) || !r.what.includes(f.name))) out.push(`${f.name}: the fail's text doesn't name the backend ${backend} and the fixture: ${JSON.stringify(r.what)}`);
  return out;
}
/**
 * The kit's part of a criterion: everything wrong with its data for fixture `f` and with its row read as `result` on
 * the reference backend, and the row, for what the criterion says a fail names.
 */
export function kitFailures(fixtures: JsonObject, report: JsonObject, f: Small, result: 'pass' | 'fail', measured: number | null, on: string): { failures: string[]; row: KitRow | null } {
  const k = kitOf(fixtures, report, f, on);
  if (typeof k === 'string') return { failures: [k], row: null };
  return { failures: [...dataFailures(k.data, f), ...rowFailures(k, f, result, measured, REFERENCE)], row: k.row };
}

// ---------------------------------------------------------------------------------------------------
// The check (the base's `check` call: `{ok: true, issues: [Issue]}`, refusals of severity `error` and lints beside them).

/** The check's issues; or, as text, why the reply isn't a check's. */
function issuesOf(reply: JsonObject, what: string): JsonObject[] | string {
  if (reply['ok'] !== true || !Array.isArray(reply['issues'])) return `INCONCLUSIVE: ${what}: the check didn't answer {ok: true, issues}: ${show(reply).slice(0, 300)}`;
  return reply['issues'].filter(isObject);
}
const told = (i: JsonObject): string => `${String(i['code'])} at ${String(i['path'])}: ${String(i['what'])}`;
/** Everything wrong with an accepted world: any error its check raises. */
export function acceptedFailures(reply: JsonObject, what: string): string[] {
  const issues = issuesOf(reply, what);
  return typeof issues === 'string' ? [issues] : issues.filter((i) => i['severity'] === 'error').map((i) => `${what} isn't accepted at check: ${told(i)}`);
}

/** The field as the reader's refusals name fields. */
export const FIELD = 'solver/length_unit';
export interface Refused { code: 'out_of_range' | 'physics.backend_cap'; actual: number; backend?: string }
/**
 * Everything wrong with a refusal of `solver.length_unit` at check: no error issue of `code` whose `path` is the field
 * and whose `actual` is the value written there, or (when `backend` is given) one whose sentence leaves the backend
 * out. Each failure names the field, and the backend when one is given.
 */
export function refusedFailures(reply: JsonObject, want: Refused, what: string): string[] {
  const issues = issuesOf(reply, what);
  if (typeof issues === 'string') return [issues];
  const on = want.backend === undefined ? '' : ` on ${want.backend}`;
  const errors = issues.filter((i) => i['severity'] === 'error');
  const mine = errors.filter((i) => i['path'] === FIELD && i['code'] === want.code);
  if (mine.length !== 1) return [`${FIELD}: ${what}${on} is refused with ${mine.length} ${want.code} issues at the field, one expected; its errors: ${errors.map(told).join('; ') || 'none'}`];
  const out: string[] = [];
  const i = mine[0]!;
  if (i['actual'] !== want.actual) out.push(`${FIELD}: ${what}${on}: the refusal names the value ${show(i['actual'])}, not ${want.actual}`);
  if (want.backend !== undefined && !(typeof i['what'] === 'string' && i['what'].includes(want.backend))) out.push(`${FIELD}: ${what}${on}: the refusal's sentence doesn't name the backend ${want.backend}: ${JSON.stringify(i['what'])}`);
  return out;
}

// --- The lint (criterion 5) ---
export const SMALL_BODY = 'physics.small_body';
export const DIE = 'die';
/** A world at the defaults: 120 Hz, 4 substeps, and no `solver` written, so contacts at 30 Hz and a solver length of 1 m. */
export const DEFAULT_RATE = 120;
const defaults = (parts: JsonObject): JsonObject => at(parts, { stepRate: DEFAULT_RATE, contactHz: null, lengthUnit: null });
const resting = (shapes: JsonObject, body: JsonObject): JsonObject => ({ contact_materials: { m: material(0.5, 0) }, shapes: { ...shapes, floor: FLOOR }, bodies: { floor: floor('m'), ...body } });
/** A cube of side `side` m at rest on the floor, the world's one dynamic body `id`: at the defaults, or in the fixture's world. */
export function cubeWorld(id: string, side: number, where: 'defaults' | 'fixture'): JsonObject {
  const parts = resting({ cube: cubeShape(side) }, { [id]: dynamic('cube', 'm', [0, side / 2, 0]) });
  return where === 'defaults' ? defaults(parts) : at(parts);
}
/** A die at the defaults whose thin shape is its second: a 5 cm cube first, then a 1 cm cube on its side. */
export function secondShapeDie(): JsonObject {
  const uses = [{ shape: 'core', contact_material: 'm' }, { shape: 'pip', contact_material: 'm', offset: { pos: [0.03, 0, 0] } }];
  return defaults(resting({ core: cubeShape(0.05), pip: cubeShape(SIDE) }, { [DIE]: { kind: 'dynamic', shapes: uses, pose: { pos: [0, 0.025, 0] }, sleep: false } }));
}
/** The sink of a body resting on one of its own mass at contact frequency `hz`: 2 × g ÷ (2π × hz)², m (the issue's closed form). */
export const sinkAt = (hz: number): number => (2 * G) / (2 * Math.PI * hz) ** 2;
/** The lint's issues in a check's reply. */
function lints(reply: JsonObject, what: string): JsonObject[] | string {
  const issues = issuesOf(reply, what);
  return typeof issues === 'string' ? issues : issues.filter((i) => i['code'] === SMALL_BODY);
}
/**
 * Everything wrong with "raises `physics.small_body` of kind `unit`, naming the die, its 0.01 m extent and 0.01 as the
 * length, and of kind `soft`, naming a sink of 0.55 mm, 50 Hz and no change of `step_rate`" for body `id` of a world at
 * the defaults that the check accepts. Each failure names the body.
 */
export function lintFailures(reply: JsonObject, id: string, what: string): string[] {
  const raised = lints(reply, what);
  if (typeof raised === 'string') return [raised];
  const out = acceptedFailures(reply, what).map((f) => `${id}: ${f}`);
  const named = (i: JsonObject): boolean => Array.isArray(i['ids']) && i['ids'].length === 1 && i['ids'][0] === id;
  const num = (i: JsonObject, k: string): number => (typeof i[k] === 'number' ? i[k] : NaN);
  const one = (kind: string): JsonObject | null => {
    const of = raised.filter((i) => i['kind'] === kind);
    if (of.length !== 1) { out.push(`${id}: ${what} raises ${of.length} ${SMALL_BODY} issues of kind ${kind}, one expected; it raises ${show(raised).slice(0, 600)}`); return null; }
    const i = of[0]!;
    if (!named(i)) out.push(`${id}: ${what}: the issue of kind ${kind} names ${show(i['ids'])} in ids, not the body alone`);
    if (i['severity'] !== 'warning') out.push(`${id}: ${what}: the issue of kind ${kind} has severity ${show(i['severity'])}, not warning`);
    return i;
  };
  const unit = one('unit');
  if (unit) {
    if (!(Math.abs(num(unit, 'extent') - SIDE) <= 1e-9)) out.push(`${id}: ${what}: kind unit names the extent ${show(unit['extent'])} m, not ${SIDE} m`);
    if (!(Math.abs(num(unit, 'length_unit') - LENGTH_UNIT) <= 1e-9)) out.push(`${id}: ${what}: kind unit names ${show(unit['length_unit'])} as the length to set, not ${LENGTH_UNIT}`);
  }
  const soft = one('soft');
  if (soft) {
    const [sink, hz] = [num(soft, 'sink'), num(soft, 'contact_hz')];
    if (!(Math.abs(sink - sinkAt(30)) <= 1e-9)) out.push(`${id}: ${what}: kind soft names a sink of ${show(soft['sink'])} m, not 2 × g ÷ (2π × 30)² = ${sinkAt(30).toFixed(7)} m (0.55 mm)`);
    // 50 Hz as the issue prints it, and a frequency that brings the sink to 2% of the extent or under.
    if (!(Math.abs(hz - 50) <= 0.5 && sinkAt(hz) <= 0.02 * SIDE * (1 + 1e-9))) out.push(`${id}: ${what}: kind soft names ${show(soft['contact_hz'])} Hz as the least contact_hz, not 50 Hz (the least that brings the sink under 2% of ${SIDE} m is ${(Math.sqrt((2 * G) / (0.02 * SIDE)) / (2 * Math.PI)).toFixed(2)} Hz)`);
    if (soft['step_rate'] !== DEFAULT_RATE) out.push(`${id}: ${what}: kind soft names step_rate ${show(soft['step_rate'])}, not the world's own ${DEFAULT_RATE}, which is no change`);
  }
  const others = raised.filter((i) => i['kind'] !== 'unit' && i['kind'] !== 'soft');
  if (others.length) out.push(`${id}: ${what} raises ${SMALL_BODY} of another kind than unit and soft: ${show(others).slice(0, 400)}`);
  return out;
}
/** Everything wrong with "raises none of kind …" for a world the check accepts: an error, or a lint's issue of one of `kinds`. */
export function quietFailures(reply: JsonObject, kinds: readonly string[], what: string): string[] {
  const raised = lints(reply, what);
  if (typeof raised === 'string') return [raised];
  return [...acceptedFailures(reply, what), ...raised.filter((i) => kinds.includes(String(i['kind']))).map((i) => `${what} raises ${SMALL_BODY} of kind ${String(i['kind'])}: ${show(i).slice(0, 400)}`)];
}

// ---------------------------------------------------------------------------------------------------
// Step hashes and bake keys (the base's `bake` reply: `step_hashes[k]` after step k, and `key`).

export function hashesOf(reply: JsonObject, what: string): string[] | string {
  if (reply['ok'] !== true) return `${what} isn't baked: ${refusal(reply)}`;
  const h = reply['step_hashes'];
  return Array.isArray(h) && h.every((x) => typeof x === 'string') ? (h as string[]) : `INCONCLUSIVE: ${what}: step_hashes isn't a list of hashes: ${show(h).slice(0, 200)}`;
}
/** Everything wrong with two runs' step hashes being byte-identical: another count than the built state's and each step's, or the first step that differs. */
export function sameFailures(here: string[], there: string[], steps: number, name: string, on: string): string[] {
  if (here.length !== steps + 1 || there.length !== steps + 1) return [`${name}: ${here.length} step hashes here and ${there.length} ${on}, not the built state's and one for each of ${steps} steps`];
  const first = here.findIndex((h, k) => h !== there[k]);
  return first < 0 ? [] : [`${name}: the step hash at step ${first} is ${here[first]!} here and ${there[first]!} ${on}`];
}
/** A bake's key; or '' with nothing baked or no key. */
export const keyOf = (reply: JsonObject): string => (reply['ok'] === true && typeof reply['key'] === 'string' ? reply['key'] : '');

/** A backend's name and whether it is the reference (the base's `backend` call); or, as text, why it can't be read. */
export function backendOf(reply: JsonObject, what: string): { backend: string; reference: boolean } | string {
  if (reply['ok'] !== true || typeof reply['backend'] !== 'string') return `INCONCLUSIVE: ${what}: backend didn't answer {ok: true, backend, reference}: ${show(reply).slice(0, 300)}`;
  return { backend: reply['backend'], reference: reply['reference'] === true };
}
