// Test-side tools for the #2309 acceptance tests (README: The surface under test). They drive the physics runner
// `deep-physics` (JSON lines in, one reply per line) as #191's suite does, through #191's builds and its wasm32 script,
// and add only this issue's worlds, its planted names and its judges. Nothing here stands in for the check, the solver,
// the behavior kit or a backend: every issue, body state, hash and kit row read here is the implementation's own, and
// every expected value is the issue's, copied or worked here from its closed form.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect } from 'vitest';
import {
  G, RATE, REPO, TIMEOUT, arr, box, isObject, mergeBase, mergeBasePhysics, num, obj, physicsBin, show, statesOf, str, use, world,
  type JsonObject, type JsonValue, type KitResult,
} from '../191/helpers.ts';

export {
  G, RATE, REFERENCE, TIMEOUT, WASM32, caught, failFailures, kitCall, kitReport, named, none, obj, prebuild, show, statesOf,
  toleranceOf, wasm32, type JsonObject, type JsonValue, type KitReport, type KitResult,
} from '../191/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = { 1: '#2309.6e2a91d2', 2: '#2309.867e3130', 3: '#2309.55fde6cd', 4: '#2309.2d1bb5c9' } as const;

/** This suite's planted names (`deep-physics --planted <name>`), each one criterion's wrong program (README). */
export type Planted = 'contact_hz_quarter' | 'static_contact_same_hz' | 'contact_default_30';

// ---------------------------------------------------------------------------------------------------
// The runner: this checkout's release build (#191's `release`), and the merge base's.

function runOn(bin: string, args: string[], calls: JsonObject[], what: string): JsonObject[] {
  const run = spawnSync(bin, args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished in time`).toBe('');
  if (run.error && code !== 'EPIPE') throw Error(`${what}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(run.status, `${what} exits 0; stdout: ${stdout.slice(0, 1000)}; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call; stdout: ${stdout.slice(0, 1000)}`).toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 120)})`));
}

/** Runs `calls` through one `deep-physics [--planted p]` process of this checkout: exit 0, one JSON reply per call, in order. */
export function physics(calls: JsonObject[], planted?: Planted): JsonObject[] {
  return runOn(physicsBin('release'), planted ? ['--planted', planted] : [], calls, `deep-physics${planted ? ` --planted ${planted}` : ''}`);
}

let baseDir = '';
let base: { bin: string; error: string } | undefined;
/** A file that reads the merge base calls this once: its copy of the merge base's binary goes when the file ends. */
export function withBase(): void {
  afterAll(() => { if (baseDir) rmSync(baseDir, { recursive: true, force: true }); baseDir = ''; base = undefined; });
}
/** Runs `calls` through the merge base's release deep-physics (#191's `mergeBasePhysics`), built once for the file. */
export function onBase(calls: JsonObject[]): { sha: string; replies: JsonObject[] } {
  const sha = mergeBase();
  if (!base) {
    baseDir = mkdtempSync(join(tmpdir(), 'deep-2309-base-'));
    const bin = join(baseDir, 'deep-physics-base');
    base = { bin, error: mergeBasePhysics(sha, bin) };
  }
  expect(base.error, `the merge base ${sha.slice(0, 12)} builds deep-physics (release)`).toBe('');
  return { sha, replies: runOn(base.bin, [], calls, `the merge base's deep-physics (${sha.slice(0, 12)})`) };
}

// ---------------------------------------------------------------------------------------------------
// The issue's stack: n cubes of 1 m, density 1,000 kg/m³ and friction 0.5, set one on another on a static floor whose
// top face is y = 0, at 120 Hz and g = 9.81 m/s². Each cube has `sleep: false`, as the kit's own dynamic bodies do: a
// sleeping body reads 0 m/s whatever its contacts do, and the issue's speeds and its 5.87 mm are a waking stack's
// (README: The worlds). Everything else the issue doesn't name is the world's default.

/** The cube k of a stack, counted from the floor: `cube1` rests on the floor, `cube<n>` is the top. */
export const cube = (k: number): string => `cube${k}`;
export const cubes = (n: number): string[] => Array.from({ length: n }, (_, i) => cube(i + 1));
export interface Stack { substeps?: number; contactHz?: number }
export function stackWorld(n: number, o: Stack = {}): JsonObject {
  const bodies: JsonObject = { floor: { kind: 'static', shapes: [use('floor')], pose: { pos: [0, -0.1, 0] } } };
  for (let k = 1; k <= n; k += 1) bodies[cube(k)] = { kind: 'dynamic', shapes: [use('cube')], pose: { pos: [0, k - 0.5, 0] }, sleep: false };
  return world({
    substeps: o.substeps ?? 4,
    ...(o.contactHz === undefined ? {} : { solver: { contact_hz: o.contactHz } }),
    shapes: { cube: box([0.5, 0.5, 0.5]), floor: box([50, 0.1, 50]) },
    bodies,
  });
}

/** Six seconds; the sixth second is steps 601 to 720 (a body's state after step k is at index k). */
export const STEPS = 6 * RATE;
export const SIXTH = { from: 5 * RATE + 1, to: 6 * RATE } as const;
export const bake = (w: JsonObject, extra: JsonObject = {}): JsonObject => ({ call: 'bake', world: w, steps: STEPS, ...extra });

/** Each cube's largest speed in the sixth second, m/s, and the step it had it. */
export function speeds(reply: JsonObject, n: number, what: string): { id: string; max: number; step: number }[] {
  return cubes(n).map((id) => {
    const states = statesOf(reply, id, what);
    expect(states.length, `${what}: ${id} has a state for the built world and each of ${STEPS} steps`).toBe(STEPS + 1);
    let [max, step] = [-1, SIXTH.from];
    for (let k = SIXTH.from; k <= SIXTH.to; k += 1) {
      const v = Math.hypot(...states[k]!.linear);
      if (v > max) [max, step] = [v, k];
    }
    return { id, max, step };
  });
}
export const shownSpeeds = (s: { id: string; max: number; step: number }[]): string => s.map((x) => `${x.id} ${(x.max * 1000).toFixed(3)} mm/s`).join(', ');
/** Everything wrong with a stack at rest: a cube that moves at `limit` m/s or faster at any step of the sixth second, named. */
export function restFailures(reply: JsonObject, n: number, limit: number, what: string): string[] {
  return speeds(reply, n, what).filter((s) => !(s.max < limit)).map((s) => `${s.id}: ${what} moves it ${s.max} m/s at step ${s.step}, in the sixth second, not slower than ${limit} m/s`);
}

/** The issue's closed forms: five equal cubes at contact frequency f, a contact with a static body at `ground` × f. */
export const sinkOfFive = (f: number, ground: number): number => (2 * (4 + 3 + 2 + 1) * G) / (2 * Math.PI * f) ** 2 + (5 * G) / (2 * Math.PI * ground * f) ** 2;
/** As the issue prints them: 5.87 mm at the default, 6.90 mm when a static contact is held at the same frequency. */
export const SINK = 0.00587;
export const SINK_SAME_HZ = 0.0069;
export const SINK_WITHIN = 0.0003;
/** How far the top of `n` ends below its built height, n − 0.5 m (4.5 m for five). */
export function sink(reply: JsonObject, n: number, what: string): number {
  return n - 0.5 - statesOf(reply, cube(n), what).at(-1)!.pos[1];
}
const mm = (m: number): string => `${(m * 1000).toFixed(3)} mm`;
/** Everything wrong with the top of five at the default: it ends anywhere but 5.87 mm below 4.5 m within 0.3 mm, named. */
export function topFailures(reply: JsonObject, what: string): string[] {
  const low = sink(reply, 5, what);
  return Math.abs(low - SINK) <= SINK_WITHIN ? [] : [`${cube(5)}: ${what} ends the top of five ${mm(low)} below 4.5 m, not ${mm(SINK)} within ${mm(SINK_WITHIN)}`];
}

// ---------------------------------------------------------------------------------------------------
// The check (the base's `check` call: `{ok: true, issues: [{code, severity, path, actual, what, …}]}`).

export const FIELD = 'solver/contact_hz';
export const check = (w: JsonObject): JsonObject => ({ call: 'check', world: w });
function issuesOf(reply: JsonObject, what: string): JsonObject[] {
  expect(reply['ok'], `${what}: the check answers: ${show(reply)}`).toBe(true);
  return arr(reply['issues'], `${what}: issues`).map((v, i) => obj(v, `${what}: issues[${i}]`));
}
/** A number named in a sentence: `80`, `80.0` or `80.` at a sentence's end, never inside `180`, `0.80` or `80.5`. */
const names = (text: string, n: number): boolean => new RegExp(`(?<![\\d.])${n}(?![\\d]|\\.\\d*[1-9])`).test(text);
/**
 * Everything wrong with a refusal of `solver.contact_hz: hz` under the bound `most`: no `out_of_range` issue at the
 * field, or one that doesn't name the value (`actual`) or the bound (in its sentence, `what`). Each failure names the field.
 */
export function refusalFailures(reply: JsonObject, hz: number, most: number, what: string): string[] {
  const issues = issuesOf(reply, what);
  const mine = issues.filter((i) => i['path'] === FIELD && i['code'] === 'out_of_range' && i['severity'] === 'error');
  if (mine.length !== 1) return [`${FIELD}: ${what} is refused with ${mine.length} out_of_range issues at the field, one expected (${hz} Hz is above the bound ${most} Hz); its issues: ${show(issues)}`];
  const out: string[] = [];
  const i = mine[0]!;
  if (i['actual'] !== hz) out.push(`${FIELD}: ${what}: the issue names the value ${show(i['actual'])}, not ${hz}`);
  const text = typeof i['what'] === 'string' ? i['what'] : '';
  if (!names(text, most)) out.push(`${FIELD}: ${what}: the issue's sentence doesn't name the bound ${most}: ${JSON.stringify(text)}`);
  return out;
}
/** Everything wrong with an accepted world: any error, or any issue at the field. */
export function acceptFailures(reply: JsonObject, what: string): string[] {
  return issuesOf(reply, what).filter((i) => i['severity'] === 'error' || i['path'] === FIELD).map((i) => `${what} isn't accepted: ${show(i)}`);
}

// ---------------------------------------------------------------------------------------------------
// The resting stack in the behavior kit's data (README: The fixture).

export const FIXTURE = 'resting_stack';
export interface StackFixture { world: JsonObject; steps: number; answer: number; tolerance: JsonValue; top: string; built: number; raw: JsonObject }
const vec = (v: JsonValue | undefined, what: string): number[] => arr(v, what).map((x, i) => num(x, `${what}[${i}]`));
/** The interface's `resting_stack`, held exactly once, with its top body: the dynamic body built highest. */
export function stackFixture(reply: JsonObject, what: string): StackFixture {
  expect(reply['ok'], `${what}: the interface's fixtures answer (call behavior_fixtures): ${show(reply)}`).toBe(true);
  const all = arr(reply['fixtures'], `${what}: fixtures`).map((v, i) => obj(v, `${what}: fixtures[${i}]`));
  const mine = all.filter((f) => f['name'] === FIXTURE);
  expect(mine.length, `${what}: the kit's data holds ${FIXTURE} once; it holds ${all.map((f) => String(f['name'])).join(', ')}`).toBe(1);
  const raw = mine[0]!;
  const w = obj(raw['world'], `${FIXTURE}: world`);
  const bodies = obj(w['bodies'], `${FIXTURE}: world.bodies`);
  const dynamic = Object.keys(bodies).filter((id) => obj(bodies[id], id)['kind'] === 'dynamic');
  expect(dynamic.length, `${FIXTURE}: its world holds dynamic bodies`).toBeGreaterThan(0);
  const height = (id: string): number => vec(obj(obj(bodies[id], id)['pose'], `${id}: pose`)['pos'], `${id}: pose.pos`)[1]!;
  const top = dynamic.reduce((a, b) => (height(b) > height(a) ? b : a));
  return { world: w, steps: num(raw['steps'], `${FIXTURE}: steps`), answer: num(raw['answer'], `${FIXTURE}: answer`), tolerance: raw['tolerance'] ?? null, top, built: height(top), raw };
}
/** Everything about the fixture's data that isn't the issue's stack: five 1 m cubes, 1,000 kg/m³, friction 0.5, 120 Hz, 4 substeps, the default 30 Hz. */
export function dataFailures(f: StackFixture): string[] {
  const out: string[] = [];
  const w = f.world;
  const gravity = Array.isArray(w['gravity']) ? Math.hypot(...(w['gravity'] as number[])) : NaN;
  if ((w['step_rate'] ?? RATE) !== RATE || (w['substeps'] ?? 4) !== 4 || !(Math.abs(gravity - G) < 1e-9)) out.push(`${FIXTURE}'s world isn't at g = 9.81 m/s², 120 Hz and 4 substeps: ${show({ step_rate: w['step_rate'] ?? null, substeps: w['substeps'] ?? null, gravity: w['gravity'] ?? null })}`);
  const hz = isObject(w['solver']) ? w['solver']['contact_hz'] : undefined;
  if (hz !== undefined && hz !== 30) out.push(`${FIXTURE}'s world writes solver.contact_hz ${show(hz)}; the answer 5.87 mm is the default's, 30 Hz`);
  const bodies = obj(w['bodies'], 'bodies');
  const shapes = obj(w['shapes'], 'shapes');
  const materials = isObject(w['contact_materials']) ? w['contact_materials'] : {};
  const dynamic = Object.keys(bodies).filter((id) => obj(bodies[id], id)['kind'] === 'dynamic');
  if (dynamic.length !== 5) out.push(`${FIXTURE}'s world holds ${dynamic.length} dynamic bodies, five expected`);
  for (const id of dynamic) {
    const uses = arr(obj(bodies[id], id)['shapes'], `${id}: shapes`).map((u, i) => obj(u, `${id}: shapes[${i}]`));
    const shape = uses.length === 1 && isObject(shapes[String(uses[0]!['shape'])]) ? (shapes[String(uses[0]!['shape'])] as JsonObject) : {};
    if (shape['kind'] !== 'box' || JSON.stringify(shape['half']) !== '[0.5,0.5,0.5]') out.push(`${FIXTURE}: ${id} isn't one 1 m cube: ${show(uses)} ${show(shape)}`);
    const m = uses.length === 1 && isObject(materials[String(uses[0]!['contact_material'])]) ? (materials[String(uses[0]!['contact_material'])] as JsonObject) : {};
    if (m['density'] !== 1000 || (m['friction'] ?? 0.5) !== 0.5) out.push(`${FIXTURE}: ${id}'s contact material isn't 1,000 kg/m³ at friction 0.5: ${show(m)}`);
  }
  if (Math.abs(f.built - 4.5) > 1e-9) out.push(`${FIXTURE}: its top body ${f.top} is built at ${f.built} m, not 4.5 m`);
  // The printed answer, 5.87 mm, within half a unit of its last digit (the closed form is 5.867 mm), in metres.
  if (Math.abs(f.answer - SINK) > 0.000005 + 1e-12) out.push(`${FIXTURE}: the answer ${f.answer} m isn't the issue's 5.87 mm (0.00587 m)`);
  if (JSON.stringify(f.tolerance) !== JSON.stringify({ m: SINK_WITHIN })) out.push(`${FIXTURE}: tolerance ${show(f.tolerance)}, the issue's is 0.3 mm ({"m": 0.0003})`);
  return out;
}
/** Everything wrong with the kit's row for the fixture read as a pass on `backend`: the interface's answer and tolerance, `pass`, measured within 0.3 mm of 5.87 mm. */
export function rowFailures(r: KitResult, f: StackFixture, backend: string): string[] {
  const out: string[] = [];
  if (r.backend !== backend) out.push(`${FIXTURE}'s row names backend ${r.backend}, not ${backend}`);
  if (r.result !== 'pass') out.push(`${backend} ${FIXTURE} reads ${r.result}, not pass: ${show(r.raw)}`);
  if (r.answer !== f.answer || JSON.stringify(r.tolerance) !== JSON.stringify(f.tolerance)) out.push(`${FIXTURE}: the row's answer and tolerance ${show(r.answer)} ${show(r.tolerance ?? null)} aren't the interface's ${f.answer} ${show(f.tolerance)}`);
  if (r.measured === null) out.push(`${FIXTURE}: the row lists no measured value beside its answer: ${show(r.raw)}`);
  else if (!(Math.abs(r.measured - SINK) <= SINK_WITHIN)) out.push(`${FIXTURE}: measured ${r.measured} m is outside ${SINK} ± ${SINK_WITHIN} m`);
  return out;
}
/** The fixture's own world baked for its own steps: how far its top body ends below where it was built. */
export const fixtureBake = (f: StackFixture): JsonObject => ({ call: 'bake', world: f.world, steps: f.steps, read: [f.top] });
export function fixtureSink(reply: JsonObject, f: StackFixture, what: string): number {
  return f.built - statesOf(reply, f.top, what).at(-1)!.pos[1];
}
export const hashesOf = (reply: JsonObject, what: string): string[] => {
  expect(reply['ok'], `${what} is baked, not refused: ${show(reply)}`).toBe(true);
  return arr(reply['step_hashes'], `${what}: step_hashes`).map((h, i) => str(h, `${what}: step_hashes[${i}]`));
};
