// Test-side tools for the #2241 acceptance tests (README: The surface under test). They drive the physics runner
// `deep-physics` (JSON lines in, one reply per line) through #191's builds, as #2309's suite does, and add only this
// issue's worlds, its planted names, its test backend and its judges. Nothing here stands in for the check, the solver,
// the contact hook, the behavior kit or a backend: every issue, body state, hash and kit row read here is the
// implementation's own, and every expected value is the issue's, copied or worked here from the closed form it gives.
//
// No function here asserts. What a program answers and what a judge finds wrong with it both come back as text, so
// each test's failing assertion is in its own file. Only a process that can't be run at all throws, `BLOCKED:` or
// `INCONCLUSIVE:` first, as the base's suites do: nothing unrun passes.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import {
  G, RATE, REPO, TIMEOUT, box, isObject, mergeBase, mergeBasePhysics, physicsBin, show, use, world,
  type JsonObject, type JsonValue, type KitResult, type PhysicsBuild, type Vec3,
} from '../191/helpers.ts';

export {
  G, RATE, REFERENCE, TIMEOUT, failFailures, kitCall, prebuild, show, type JsonObject, type JsonValue, type KitResult, type Vec3,
} from '../191/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = { 1: '#2241.b41ad7e6', 2: '#2241.7f1a12a6', 3: '#2241.cd4957bd', 4: '#2241.385c4a4d', 5: '#2241.7a6dcc6f' } as const;

/** This suite's planted names (`deep-physics --planted <name>`), each one criterion's wrong program (README). */
export type Planted = 'belt_hook_left_out' | 'belt_speed_along_world_x' | 'belt_speed_along_level_ground';
/** This suite's test backend (`deep-physics --backend <name>` in the `test-backends` build): Rapier with belts left out of its caps(). */
export type TestBackend = 'no_belts';
export const NO_BELTS: TestBackend = 'no_belts';

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
      baseDir = mkdtempSync(join(tmpdir(), 'deep-2241-base-'));
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
// The issue's numbers. Each is its closed form, worked here; the tests hold each to the digits the issue prints.

/** The belt's `tangent_speed`, m/s, and the friction of the box and of the belt (0.5 under every combine rule but multiply). */
export const SPEED = 1;
export const MU = 0.5;
/** The tilted belt's angle, degrees up along its +X. */
export const TILT = 10;
const RAD = Math.PI / 180;
/** "At 2 s": 240 steps at 120 Hz; a body's state after step k is at index k. */
export const SECONDS = 2;
export const STEPS = SECONDS * RATE;
/** v ÷ (μg) = 0.204 s: when the level belt's box reaches the belt's speed. */
export const REACH_LEVEL = SPEED / (MU * G);
/** v·t − v² ÷ (2μg) = 1.898 m: how far the level belt has carried its box at 2 s. */
export const MOVED = SPEED * SECONDS - SPEED ** 2 / (2 * MU * G);
/** 1 ÷ (g × (0.5 cos 10° − sin 10°)) = 0.320 s: when the tilted belt's box reaches the belt's speed up the slope. */
export const REACH_TILTED = SPEED / (G * (MU * Math.cos(TILT * RAD) - Math.sin(TILT * RAD)));
/** cos 10° of the belt's speed, 0.985 m/s: what a speed taken along level ground leaves in the contact's plane. */
export const ALONG_LEVEL = SPEED * Math.cos(TILT * RAD);
/** The criteria's bounds: 1% of a distance or a speed, 2 steps of a time. */
export const WITHIN = 0.01;
export const WITHIN_STEPS = 2;
/** Half a unit of the last digit the issue prints its metres and its metres a second to (1.898 m, 0.985 m/s, "0 m"). */
export const PRINTED = 0.0005;

// ---------------------------------------------------------------------------------------------------
// The worlds (README: The worlds). A static belt whose top face passes through the origin, and a box of 0.5 m built
// at rest on it, each on its own contact material of friction 0.5, on #191's `world` defaults: g = 9.81 m/s², 120 Hz,
// 4 substeps, every solver and combine field unwritten.

export const BELT = 'belt';
export const BOX = 'box';
export interface BeltParts {
  /** `tangent_speed` on the belt's contact material; left out when undefined. */
  speed?: number;
  /** Extra fields on the box's contact material. */
  onBox?: JsonObject;
  /** The belt's body turned about +Y, degrees. */
  turn?: number;
  /** The belt's body, and the box on it, tilted about +Z, degrees: up along the belt's +X. */
  tilt?: number;
  /** The box launched along +X, m/s, and kept awake. */
  launch?: number;
}
const material = (extra: JsonObject = {}): JsonObject => ({ friction: MU, restitution: 0, density: 1000, ...extra });
export function beltWorld(o: BeltParts = {}): JsonObject {
  const [s, c] = [Math.sin((o.tilt ?? 0) * RAD), Math.cos((o.tilt ?? 0) * RAD)];
  const rot: JsonObject = o.tilt !== undefined ? { rot: [0, 0, o.tilt] } : o.turn !== undefined ? { rot: [0, o.turn, 0] } : {};
  const tilted: JsonObject = o.tilt !== undefined ? { rot: [0, 0, o.tilt] } : {};
  return world({
    contact_materials: { [BELT]: material(o.speed === undefined ? {} : { tangent_speed: o.speed }), [BOX]: material(o.onBox) },
    shapes: { [BELT]: box([10, 0.1, 10]), [BOX]: box([0.25, 0.25, 0.25]) },
    bodies: {
      [BELT]: { kind: 'static', shapes: [use(BELT, BELT)], pose: { pos: [0.1 * s, -0.1 * c, 0], ...rot } },
      [BOX]: {
        kind: 'dynamic', shapes: [use(BOX, BOX)], pose: { pos: [-0.25 * s, 0.25 * c, 0], ...tilted },
        ...(o.launch === undefined ? {} : { velocity: { linear: [o.launch, 0, 0] }, sleep: false }),
      },
    },
  });
}
/** Criterion 1's world, "the first world": the level belt with `tangent_speed: 1`. */
export const levelBelt = (): JsonObject => beltWorld({ speed: SPEED });
/** Criterion 2's: the same belt turned 90° about +Y, and the level belt with `tangent_speed: −1`. */
export const turnedBelt = (): JsonObject => beltWorld({ speed: SPEED, turn: 90 });
export const reversedBelt = (): JsonObject => beltWorld({ speed: -SPEED });
/** Criterion 3's: the belt tilted 10° up along its +X. */
export const tiltedBelt = (): JsonObject => beltWorld({ speed: SPEED, tilt: TILT });
/** Criterion 4's: `tangent_speed: 1` on the dynamic box's shape use and nowhere else; `rolling_resistance: 0.05`, with no `tangent_speed`. */
export const beltOnDynamic = (): JsonObject => beltWorld({ onBox: { tangent_speed: SPEED } });
export const rolling = (): JsonObject => beltWorld({ onBox: { rolling_resistance: 0.05 } });
/** Criterion 5's worlds with no `tangent_speed`: the first world with the field left out, and the same with its box sliding from 2 m/s. */
export const plainSurface = (): JsonObject => beltWorld();
export const slidingBox = (): JsonObject => beltWorld({ launch: 2 });

/** The names the judges' failures carry: the kit's two fixtures (README) and criterion 2's two belts. */
export const LEVEL = 'belt_level';
export const TILTED = 'belt_tilted';
export const TURNED = 'the turned belt';
export const REVERSED = 'the reversed belt';

/** World directions: a belt's +X once its body is turned or tilted. */
export const PLUS_X: Vec3 = [1, 0, 0];
export const MINUS_Z: Vec3 = [0, 0, -1];
export const UP_SLOPE: Vec3 = [Math.cos(TILT * RAD), Math.sin(TILT * RAD), 0];

export const check = (w: JsonObject): JsonObject => ({ call: 'check', world: w });
export const bake = (w: JsonObject, extra: JsonObject = {}): JsonObject => ({ call: 'bake', world: w, steps: STEPS, read: [BOX, BELT], ...extra });

// ---------------------------------------------------------------------------------------------------
// Reading a bake (the base's `bake` call: `bodies.<ID>[k]` is the state after step k, `step_hashes[k]` its hash).

export interface State { pos: Vec3; rot: number[]; linear: Vec3; angular: Vec3 }
const numbers = (v: JsonValue | undefined, n: number): number[] | null =>
  (Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (v as number[]) : null);
/** Why a reply isn't a bake, in its own words: its issues' fields and sentences. */
export function refusal(reply: JsonObject): string {
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  return issues.length ? issues.map((i) => `${String(i['code'])} at ${String(i['path'])}: ${String(i['what'])}`).join('; ') : show(reply);
}
/** An accepted bake's states of body `id`, one per step from the built state at index 0; or, as text, why there are none. */
export function statesOf(reply: JsonObject, id: string, what: string): State[] | string {
  if (reply['ok'] !== true) return `${what} isn't baked: ${refusal(reply)}`;
  const series = isObject(reply['bodies']) ? reply['bodies'][id] : undefined;
  if (!Array.isArray(series)) return `${what}: the bake lists no states of body ${id}: ${show(reply['bodies'])}`;
  const out: State[] = [];
  for (const [k, v] of series.entries()) {
    const s = isObject(v) ? v : {};
    const [pos, rot, linear, angular] = [numbers(s['pos'], 3), numbers(s['rot'], 4), numbers(s['linear'], 3), numbers(s['angular'], 3)];
    if (!pos || !rot || !linear || !angular) return `${what}: bodies.${id}[${k}] isn't {pos, rot, linear, angular}: ${show(v)}`;
    out.push({ pos: pos as Vec3, rot, linear: linear as Vec3, angular: angular as Vec3 });
  }
  return out;
}
export function hashesOf(reply: JsonObject, what: string): string[] | string {
  if (reply['ok'] !== true) return `${what} isn't baked: ${refusal(reply)}`;
  const h = reply['step_hashes'];
  return Array.isArray(h) && h.every((x) => typeof x === 'string') ? (h as string[]) : `${what}: step_hashes isn't a list of hashes: ${show(h)}`;
}

/** How far body `id` is at 2 s from where it was built, m; or, as text, why its states can't be read. */
export function travel(reply: JsonObject, id: string, what: string): number | string {
  const states = statesOf(reply, id, what);
  if (typeof states === 'string') return states;
  if (states.length !== STEPS + 1) return `${what}: ${id} has ${states.length} states, not the built one and one for each of ${STEPS} steps`;
  return Math.hypot(...[0, 1, 2].map((i) => states[STEPS]!.pos[i]! - states[0]!.pos[i]!));
}

const dot = (a: readonly number[], b: readonly number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
/** A length or a speed to the millimetre the issue prints, so a read of a few micrometres prints as the issue's "0 m". */
export const mm3 = (x: number): string => (Math.abs(x) < PRINTED ? 0 : x).toFixed(3);

/** A box's run along a world direction: its speed along it after each step, and how far it has moved along and across it. */
export interface Carried { speeds: number[]; along: number; across: number; reached: number | null }
/** The box's states over a bake of `STEPS` steps, read along `dir`; or, as text, why they can't be read. */
export function carried(reply: JsonObject, dir: Vec3, what: string): Carried | string {
  const states = statesOf(reply, BOX, what);
  if (typeof states === 'string') return states;
  if (states.length !== STEPS + 1) return `${what}: ${BOX} has ${states.length} states, not the built one and one for each of ${STEPS} steps`;
  const [first, last] = [states[0]!, states[STEPS]!];
  const moved = [0, 1, 2].map((i) => last.pos[i]! - first.pos[i]!);
  const along = dot(moved, dir);
  const speeds = states.map((s) => dot(s.linear, dir));
  // "Reaches 1 m/s": the first step its speed along the belt's +X is within 1% of the belt's speed (README: readings).
  const reached = speeds.findIndex((v) => Math.abs(v - SPEED) <= WITHIN * SPEED);
  return { speeds, along, across: Math.hypot(...moved.map((m, i) => m - along * dir[i]!)), reached: reached < 0 ? null : reached };
}

/** Everything wrong with "reaches 1 m/s along `axis` at `answer` s within 2 steps"; each failure names `name`. */
export function reachFailures(name: string, c: Carried, axis: string, answer: number): string[] {
  if (c.reached === null) {
    return [`${name}: the box never comes within 1% of ${SPEED} m/s ${axis}: it ends at ${mm3(c.speeds[STEPS]!)} m/s (its fastest ${mm3(Math.max(...c.speeds))} m/s), where ${SPEED} m/s at ${answer.toFixed(3)} s within ${WITHIN_STEPS} steps is due`];
  }
  const off = Math.abs(c.reached / RATE - answer) * RATE;
  return off <= WITHIN_STEPS + 1e-9 ? [] : [`${name}: the box reaches ${SPEED} m/s ${axis} at step ${c.reached} (${(c.reached / RATE).toFixed(3)} s), ${off.toFixed(2)} steps from the ${answer.toFixed(3)} s it is due, not within ${WITHIN_STEPS}`];
}
/** Everything wrong with "at 2 s it has moved `answer` m along `axis`, within 1%", and no farther than that 1% across it. */
export function movedFailures(name: string, c: Carried, axis: string, answer: number): string[] {
  const out: string[] = [];
  const room = WITHIN * Math.abs(answer);
  if (!(Math.abs(c.along - answer) <= room)) out.push(`${name}: at ${SECONDS} s the box has moved ${mm3(c.along)} m along ${axis}, not ${mm3(answer)} m within 1%`);
  if (!(c.across <= room)) out.push(`${name}: at ${SECONDS} s the box has moved ${mm3(c.across)} m across ${axis}, more than 1% of the ${mm3(Math.abs(answer))} m it is carried along it`);
  return out;
}
/** Everything wrong with "then holds that speed within 1%": from the step it reached it to 2 s; the failure names the worst step. */
export function holdFailures(name: string, c: Carried, axis: string): string[] {
  if (c.reached === null) return [];
  let [worst, at] = [0, c.reached];
  for (let k = c.reached; k <= STEPS; k += 1) {
    const off = Math.abs(c.speeds[k]! - SPEED);
    if (off > worst) [worst, at] = [off, k];
  }
  return worst <= WITHIN * SPEED ? [] : [`${name}: after reaching ${SPEED} m/s ${axis} at step ${c.reached} the box doesn't hold it within 1%: ${c.speeds[at]!.toFixed(4)} m/s at step ${at}`];
}
/** Everything wrong with "the belt's body never moves": a state of it that isn't its built pose at rest, named by step and field. */
export function stillFailures(name: string, reply: JsonObject): string[] {
  const states = statesOf(reply, BELT, name);
  if (typeof states === 'string') return [states];
  if (states.length !== STEPS + 1) return [`${name}: the belt's body has ${states.length} states, not the built one and one for each of ${STEPS} steps`];
  const built = states[0]!;
  for (const [k, s] of states.entries()) {
    for (const field of ['pos', 'rot'] as const) {
      if (s[field].some((x, i) => x !== built[field][i])) return [`${name}: the belt's body moved: at step ${k} its ${field} is ${JSON.stringify(s[field])}, built ${JSON.stringify(built[field])}`];
    }
    for (const field of ['linear', 'angular'] as const) {
      if (s[field].some((x) => x !== 0)) return [`${name}: the belt's body moved: at step ${k} its ${field} velocity is ${JSON.stringify(s[field])}, not 0`];
    }
  }
  return [];
}

// ---------------------------------------------------------------------------------------------------
// The check (the base's `check` call: `{ok: true, issues: [{code, severity, path, actual, what, …}]}`).

/** The path's field names, whatever its separator (`contact_materials/belt/tangent_speed`, `a.b`), as #2009's suite reads them. */
const segments = (path: JsonValue | undefined): string[] => (typeof path === 'string' ? path.split(/[/.]/).filter((s) => s !== '') : []);
const endsWith = (path: string[], tail: readonly string[]): boolean => path.length >= tail.length && tail.every((s, i) => path[path.length - tail.length + i] === s);
/** A contact material's field as a refusal names it. */
export const field = (materialId: string, name: 'tangent_speed' | 'rolling_resistance'): string[] => ['contact_materials', materialId, name];
function errorsOf(reply: JsonObject, what: string): JsonObject[] | string {
  if (reply['ok'] !== true || !Array.isArray(reply['issues'])) return `${what}: the check didn't answer {ok: true, issues}: ${show(reply)}`;
  return reply['issues'].filter(isObject).filter((i) => i['severity'] === 'error');
}
export interface Refused { field: readonly string[]; actual: JsonValue; backend?: string }
/**
 * Everything wrong with a refusal at check naming the field (and, when `backend` is given, the backend): no error issue
 * whose `path` is the field's and whose `actual` is the value written there, or one whose sentence leaves the backend out.
 */
export function refusalFailures(reply: JsonObject, want: Refused, what: string): string[] {
  const errors = errorsOf(reply, what);
  const at = want.field.join('/');
  if (typeof errors === 'string') return [errors];
  const named = errors.filter((i) => endsWith(segments(i['path']), want.field));
  if (named.length === 0) return [`${what} isn't refused naming the field ${at}: no error issue has that path (its errors: ${show(errors)})`];
  const good = named.filter((i) => JSON.stringify(i['actual']) === JSON.stringify(want.actual) && (want.backend === undefined || (typeof i['what'] === 'string' && i['what'].includes(want.backend))));
  return good.length ? [] : [`${what}: the issue at ${at} doesn't hold actual ${show(want.actual)}${want.backend === undefined ? '' : ` and a sentence naming ${want.backend}`}: ${show(named)}`];
}
/** Everything wrong with an accepted world: any error its check raises. */
export function acceptedFailures(reply: JsonObject, what: string): string[] {
  const errors = errorsOf(reply, what);
  return typeof errors === 'string' ? [errors] : errors.map((i) => `${what} isn't accepted at check: ${String(i['code'])} at ${String(i['path'])}: ${String(i['what'])}`);
}

// ---------------------------------------------------------------------------------------------------
// The belt fixtures in the behavior kit's data (README: The fixtures), read from `behavior_fixtures` and `behavior_kit`.

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

interface Use { body: string; kind: string; shape: JsonObject; material: JsonObject }
/** Every shape use of a world, with its body's kind, its shape and its contact material (the world's defaults when it names none). */
function usesOf(w: JsonObject): Use[] {
  const [bodies, shapes, materials] = [w['bodies'], w['shapes'], w['contact_materials']].map((m) => (isObject(m) ? m : {}));
  return Object.entries(bodies!).flatMap(([id, b]) => {
    const body = isObject(b) ? b : {};
    return (Array.isArray(body['shapes']) ? body['shapes'] : []).filter(isObject).map((u) => {
      const [shape, mat] = [shapes![String(u['shape'])], materials![String(u['contact_material'])]];
      return { body: id, kind: String(body['kind']), shape: isObject(shape) ? shape : {}, material: isObject(mat) ? mat : {} };
    });
  });
}
const speedOf = (u: Use): number => (typeof u.material['tangent_speed'] === 'number' ? u.material['tangent_speed'] : 0);
/** Whether a world writes a belt: a shape use whose contact material carries a `tangent_speed` other than 0. */
export const writesBelt = (w: JsonObject): boolean => usesOf(w).some((u) => speedOf(u) !== 0);
/** The one dynamic body of a fixture's world, its box; null when it holds none or several. */
export function boxOf(f: Fixture): string | null {
  const bodies = isObject(f.world['bodies']) ? f.world['bodies'] : {};
  const dynamic = Object.keys(bodies).filter((id) => isObject(bodies[id]) && bodies[id]['kind'] === 'dynamic');
  return dynamic.length === 1 ? dynamic[0]! : null;
}
/**
 * Everything about a belt fixture's data that isn't the criterion's: a box of friction 0.5 set at rest on a static belt
 * of friction 0.5 with `tangent_speed: 1`, at g = 9.81 m/s², 120 Hz and 4 substeps, with the issue's answer (within
 * `room` of `answer`) and its 1% tolerance.
 */
export function dataFailures(f: Fixture, answer: number, room: number, printed: string): string[] {
  const out: string[] = [];
  const w = f.world;
  const gravity = Array.isArray(w['gravity']) ? Math.hypot(...(w['gravity'] as number[])) : G;
  if ((w['step_rate'] ?? RATE) !== RATE || (w['substeps'] ?? 4) !== 4 || !(Math.abs(gravity - G) < 1e-9)) out.push(`${f.name}'s world isn't at g = 9.81 m/s², 120 Hz and 4 substeps: ${show({ step_rate: w['step_rate'] ?? null, substeps: w['substeps'] ?? null, gravity: w['gravity'] ?? null })}`);
  const uses = usesOf(w);
  const friction = (u: Use): JsonValue => u.material['friction'] ?? (isObject(w['defaults']) ? w['defaults']['friction'] : undefined) ?? 0.5;
  const id = boxOf(f);
  const boxes = uses.filter((u) => u.body === id);
  if (id === null || boxes.length === 0) out.push(`${f.name}'s world doesn't hold exactly one dynamic body, its box: ${show(w['bodies'])}`);
  for (const u of boxes) {
    if (u.shape['kind'] !== 'box') out.push(`${f.name}: ${u.body} isn't a box: ${show(u.shape)}`);
    if (friction(u) !== MU) out.push(`${f.name}: the box's friction is ${show(friction(u))}, not ${MU}`);
    if (speedOf(u) !== 0) out.push(`${f.name}: the box's own shape use carries tangent_speed ${speedOf(u)}`);
  }
  const body = id !== null && isObject(w['bodies']) && isObject(w['bodies'][id]) ? w['bodies'][id] : {};
  const velocity = isObject(body['velocity']) ? body['velocity'] : {};
  if (['linear', 'angular'].some((k) => Array.isArray(velocity[k]) && (velocity[k] as JsonValue[]).some((x) => x !== 0))) out.push(`${f.name}: the box isn't set at rest: ${show(velocity)}`);
  const belts = uses.filter((u) => speedOf(u) !== 0);
  if (new Set(belts.map((u) => u.body)).size !== 1) out.push(`${f.name}'s world doesn't hold exactly one belt, a body whose shape use carries a tangent_speed: ${show(belts.map((u) => u.body))}`);
  for (const u of belts) {
    if (u.kind !== 'static') out.push(`${f.name}: the belt ${u.body} is ${u.kind}, not static`);
    if (speedOf(u) !== SPEED) out.push(`${f.name}: the belt's tangent_speed is ${speedOf(u)}, not ${SPEED}`);
    if (friction(u) !== MU) out.push(`${f.name}: the belt's friction is ${show(friction(u))}, not ${MU}`);
  }
  if (f.answer === null || Math.abs(f.answer - answer) > room + 1e-12) out.push(`${f.name}: the answer ${show(f.answer)} isn't the issue's ${printed}`);
  if (JSON.stringify(f.tolerance) !== JSON.stringify({ relative: WITHIN })) out.push(`${f.name}: tolerance ${show(f.tolerance)}, the issue's is 1% ({"relative": 0.01})`);
  return out;
}

/** A backend's manifest (the base's `backend` call): its name, whether it is the reference, and its caps() as cap names. */
export interface Manifest { backend: string; reference: boolean; caps: string[] }
export function manifestOf(reply: JsonObject, what: string): Manifest | string {
  if (reply['ok'] !== true || typeof reply['backend'] !== 'string' || !Array.isArray(reply['caps'])) return `${what}: backend didn't answer {ok: true, backend, reference, caps}: ${show(reply)}`;
  return { backend: reply['backend'], reference: reply['reference'] === true, caps: reply['caps'].map(String) };
}

/** The kit's rows for `fixture` (the base's `behavior_kit` reply), or, as text, why the reply isn't the kit's report. */
export function rowsOf(reply: JsonObject, fixture: string, what: string): KitResult[] | string {
  if (reply['ok'] !== true || !Array.isArray(reply['results'])) return `${what}: behavior_kit didn't answer {ok: true, results}: ${show(reply)}`;
  return reply['results'].filter(isObject).filter((r) => r['fixture'] === fixture).map((r) => ({
    backend: String(r['backend']), fixture, measured: typeof r['measured'] === 'number' ? r['measured'] : null,
    answer: typeof r['answer'] === 'number' ? r['answer'] : null, tolerance: r['tolerance'], caps: Array.isArray(r['caps']) ? r['caps'].map(String) : [],
    result: String(r['result']) as KitResult['result'], what: typeof r['what'] === 'string' ? r['what'] : '', raw: r,
  }));
}
/** The kit's one row for `fixture`; or, as text, how many it holds. */
export function rowOf(reply: JsonObject, fixture: string, what: string): KitResult | string {
  const rows = rowsOf(reply, fixture, what);
  if (typeof rows === 'string') return rows;
  return rows.length === 1 ? rows[0]! : `${what}: the kit's report holds ${fixture} ${rows.length} times, once expected`;
}
/**
 * Everything wrong with the kit's row for a belt fixture read as a pass on `backend`: the interface's answer and
 * tolerance, `pass`, and a measured value within 1% of `answer`.
 */
export function passFailures(r: KitResult, f: Fixture, backend: string, answer: number): string[] {
  const out: string[] = [];
  if (r.backend !== backend) out.push(`${r.fixture}'s row names backend ${r.backend}, not ${backend}`);
  if (r.result !== 'pass') out.push(`${backend} ${r.fixture} reads ${r.result}, not pass: ${show(r.raw)}`);
  if (r.answer !== f.answer || JSON.stringify(r.tolerance) !== JSON.stringify(f.tolerance)) out.push(`${r.fixture}: the row's answer and tolerance ${show(r.answer)} ${show(r.tolerance ?? null)} aren't the interface's ${show(f.answer)} ${show(f.tolerance)}`);
  if (r.measured === null) out.push(`${r.fixture}: the row lists no measured value beside its answer: ${show(r.raw)}`);
  else if (!(Math.abs(r.measured - answer) <= WITHIN * Math.abs(answer))) out.push(`${r.fixture}: measured ${r.measured} is outside ${answer} within 1%`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// A seek over a stored bake (the base's `seek` call: `{ok, from, step_hashes}` from the restored step on), and two
// runs' step hashes side by side.

/** A fresh folder for a bake's store, and its removal. */
export const scratch = (): string => mkdtempSync(join(tmpdir(), 'deep-2241-store-'));
export const drop = (dir: string): void => rmSync(dir, { recursive: true, force: true });
export const seek = (w: JsonObject, store: string, to: number, play: number): JsonObject => ({ call: 'seek', world: w, steps: STEPS, store, to, play, read: [BOX] });

/**
 * Everything wrong with a seek to step `to` played on to step `last`, against the straight run's hashes: it restored
 * nothing, or its hash at some step isn't the straight run's; the failure names the first such step.
 */
export function seekFailures(straight: readonly string[], sought: JsonObject, to: number, last: number, what: string): string[] {
  const hashes = sought['ok'] === true && Array.isArray(sought['step_hashes']) ? sought['step_hashes'] : null;
  const from = sought['from'];
  if (!hashes || typeof from !== 'number' || !Number.isInteger(from)) return [`${what} didn't answer {ok: true, from, step_hashes}: ${show(sought)}`];
  const out: string[] = [];
  if (!(from > 0 && from <= to)) out.push(`${what} started from step ${from}, not a checkpoint after the built world and at or before step ${to}`);
  if (hashes.length !== last - from + 1) out.push(`${what} holds ${hashes.length} step hashes, not one for each step from ${from} to ${last}`);
  const k = hashes.findIndex((h, i) => h !== straight[from + i]);
  if (k >= 0) out.push(`${what}: the step hash at step ${from + k} is ${String(hashes[k])} after the seek and ${String(straight[from + k])} in the straight run`);
  return out;
}
/** Everything that differs between two runs' step hashes of one world; the failure names the first step. */
export function sameFailures(here: readonly string[], there: readonly string[], steps: number, what: string, other: string): string[] {
  const out: string[] = [];
  if (here.length !== steps + 1 || there.length !== steps + 1) out.push(`${what}: ${here.length} step hashes here and ${there.length} ${other}, not the built state's and one for each of ${steps} steps`);
  const k = here.findIndex((h, i) => h !== there[i]);
  if (k >= 0) out.push(`${what}: the step hash at step ${k} is ${here[k]!} here and ${String(there[k])} ${other}`);
  return out;
}
