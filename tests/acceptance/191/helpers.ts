// Test-side tools for the #191 acceptance tests (README: The surface under test). They build and drive the physics
// runner `deep-physics` (JSON lines in, one reply per line), natively, with this suite's test backends, and on wasm32
// through `node scripts/physics-wasm32.mjs`; `deep-show run` for the trial; and the reference-Mac gate for budgets.
// Nothing here stands in for the behavior kit, a backend, the trial or a decision: every result, row and issue read here
// is the implementation's own, and every expected value comes from the issue's text, computed or copied here.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/191 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const targetOf = (root: string): string => (process.env['CARGO_TARGET_DIR'] ? resolve(root, process.env['CARGO_TARGET_DIR']) : join(root, 'target'));
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
export const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
/** Every test passes this timeout: first builds of Rapier and deep-show take many minutes on a shared machine. */
export const TIMEOUT = 3_600_000;
/** A file's builds before its tests: several first builds of deep-show on a loaded shared machine take hours. */
export const BUILD_TIMEOUT = 4 * TIMEOUT;
const MIB = 1024 * 1024;

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#191.8c7c5edf', 2: '#191.7542a335', 3: '#191.5e3fd235', 4: '#191.11530f89', 5: '#191.db04732f', 6: '#191.7d1f689f',
  7: '#191.55b756cb', 8: '#191.8b5fd147', 9: '#191.d1baa3cb', 10: '#191.9d50a1a7', 11: '#191.e5696c9f', 12: '#191.a949ec63',
} as const;

export const G = 9.81;
export const RATE = 120;
export const STEP = 1 / RATE;
export const REFERENCE = 'rapier3d';
export const WASM32 = 'wasm32-unknown-unknown';

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v)}`).toBe(true);
  return v as JsonValue[];
}
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${show(v)}`).toBe(true);
  return v as number;
}
export function str(v: JsonValue | undefined, what: string): string {
  expect(typeof v, `${what} is a string, got ${show(v)}`).toBe('string');
  return v as string;
}
export const strs = (v: JsonValue | undefined, what: string): string[] => arr(v, what).map((x, i) => str(x, `${what}[${i}]`));
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A planted twin is caught: the judge that passes the real program finds something wrong with the twin's answer. */
export function caught(failures: readonly string[], what: string): void {
  expect(failures.length, `${what}: the planted twin is caught (the judge finds nothing wrong with its answer)`).toBeGreaterThan(0);
}
/** Some failure names every one of `names` (the criterion's "naming …"). */
export function named(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.some((f) => names.every((n) => f.includes(n))), `${what}: a failure names ${names.join(', ')}; failures:\n  ${failures.join('\n  ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// The builds: `deep-physics` as shipped, and with the `test-backends` feature (README: Names this suite chooses).

function cargo(args: string[], env: NodeJS.ProcessEnv = {}, cwd = REPO): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ENOENT') blocked(`cargo isn't on this machine (looked on PATH and in ${RUSTUP_BIN})`);
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Checking|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  return '';
}

export const PHYSICS_BIN = 'deep-physics';
/** The physics builds: `shipped` is the crate's default features; `test` adds `test-backends`; `release` is shipped, optimized. */
export type PhysicsBuild = 'shipped' | 'test' | 'release';
const physicsArgs = (b: PhysicsBuild): string[] =>
  ['build', '--locked', ...(b === 'release' ? ['--release'] : []), '-p', 'deep-physics-rapier', '--bin', PHYSICS_BIN, ...(b === 'test' ? ['--features', 'test-backends'] : [])];

let binDir = '';
const built = new Map<PhysicsBuild, { bin: string; error: string }>();
/** Builds each listed physics build once before a file's tests (the slow part); each test reports its own build's failure. */
export function prebuild(builds: PhysicsBuild[]): void {
  beforeAll(() => { for (const b of builds) { try { physicsBin(b); } catch { /* each test reports it */ } } }, BUILD_TIMEOUT);
  afterAll(() => { if (binDir) rmSync(binDir, { recursive: true, force: true }); binDir = ''; built.clear(); });
}
export function physicsBin(b: PhysicsBuild): string {
  let entry = built.get(b);
  if (!entry) {
    if (!binDir) binDir = mkdtempSync(join(tmpdir(), 'deep-191-bin-'));
    const bin = join(binDir, `${PHYSICS_BIN}-${b}`);
    const error = cargo(physicsArgs(b));
    if (error === '') copyFileSync(join(targetOf(REPO), b === 'release' ? 'release' : 'debug', PHYSICS_BIN), bin);
    entry = { bin, error };
    built.set(b, entry);
  }
  expect(entry.error, `${PHYSICS_BIN} builds (cargo ${physicsArgs(b).join(' ')})`).toBe('');
  return entry.bin;
}

/** This suite's test backends, each wrapping Rapier, selected with `deep-physics --backend <name>` in the test build. */
export type TestBackend =
  | 'friction_average' | 'no_joint_limits' | 'restitution_min' | 'drops_cap' | 'query_ignores_groups'
  | 'rapier_caps' | 'no_soft_bodies' | 'loose_tolerance';
/** This suite's planted names (`deep-physics --planted <name>`), each one criterion's wrong program. */
export type Planted = 'kit_runs_excluded' | 'kit_admits_unfixtured' | 'pair_filter_default' | 'swept_collision_off' | 'recipe_leaves_ccd_off';
export interface Runner { backend?: TestBackend; planted?: Planted; build?: PhysicsBuild }

function readReplies(status: number | null, stdout: string, stderr: string, calls: JsonObject[], what: string): JsonObject[] {
  expect(status, `${what} exits 0; stdout: ${stdout.slice(0, 1000)}; stderr: ${stderr.slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call; stdout: ${stdout.slice(0, 1000)}`).toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 120)})`));
}

/** Runs `calls` through one `deep-physics [--backend b] [--planted p]` process: exit 0, one JSON reply per call, in order. */
export function physics(calls: JsonObject[], r: Runner = {}): JsonObject[] {
  const args = [...(r.backend ? ['--backend', r.backend] : []), ...(r.planted ? ['--planted', r.planted] : [])];
  const bin = physicsBin(r.build ?? (r.backend ? 'test' : 'shipped'));
  const what = `${PHYSICS_BIN} ${args.join(' ')}`.trim();
  const run = spawnSync(bin, args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 4096 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished in time`).toBe('');
  if (run.error && code !== 'EPIPE') throw Error(`${what}: ${run.error.message}`);
  return readReplies(run.status, run.stdout ?? '', run.stderr ?? '', calls, what);
}
export const one = (call: JsonObject, r: Runner = {}): JsonObject => physics([call], r)[0]!;

/** `node scripts/physics-wasm32.mjs`: the physics crate built for wasm32-unknown-unknown, run in Node's WebAssembly engine. */
export const WASM32_SCRIPT = join(REPO, 'scripts', 'physics-wasm32.mjs');
export function wasm32(calls: JsonObject[]): JsonObject[] {
  const run = spawnSync(process.execPath, [WASM32_SCRIPT], { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 4096 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL', env: { ...process.env, ...CARGO_ENV } });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', 'node scripts/physics-wasm32.mjs finished in time').toBe('');
  if (run.error) throw Error(`node scripts/physics-wasm32.mjs: ${run.error.message}`);
  return readReplies(run.status, run.stdout ?? '', run.stderr ?? '', calls, 'deep-physics on wasm32 (node scripts/physics-wasm32.mjs)');
}

// ---------------------------------------------------------------------------------------------------
// World documents (physics.world@1 as the base's runner reads it: maps by ID, shape uses on bodies).

export type Vec3 = [number, number, number];
export function world(parts: JsonObject): JsonObject {
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: RATE, substeps: 4, gravity: [0, -G, 0], seed: 191, mode: 'dynamic',
    capacity: { bodies: 16, shapes: 16, joints: 8, contacts: 64, particles: 0 },
    backend: { name: REFERENCE, version: '=0.36.1' },
    contact_materials: { m: { friction: 0.5, restitution: 0, density: 1000 } },
    ...parts,
  };
}
export const sphere = (radius: number): JsonObject => ({ kind: 'sphere', radius });
export const box = (half: Vec3): JsonObject => ({ kind: 'box', half });
export const use = (shape: string, material = 'm'): JsonObject => ({ shape, contact_material: material });

/** The issue's fast-body fixture (criteria 11 and 12): a sphere of radius 0.05 m at 200 m/s along +x, its centre 10 m before
 * the near face of a static wall 0.02 m thick and 2 m tall, at 120 Hz and 4 substeps. `ccd` undefined leaves it unset. */
export const WALL_NEAR = 10;
export const WALL_FAR = 10.02;
export const BALL_RADIUS = 0.05;
export const BALL_SPEED = 200;
export function fastBallWorld(ccd: boolean | undefined): JsonObject {
  const ball: JsonObject = { kind: 'dynamic', shapes: [use('ball')], pose: { pos: [0, 0, 0] }, velocity: { linear: [BALL_SPEED, 0, 0] } };
  if (ccd !== undefined) ball['ccd'] = ccd;
  return world({
    shapes: { ball: sphere(BALL_RADIUS), wall: box([0.01, 1, 1]) },
    bodies: { ball, wall: { kind: 'static', shapes: [use('wall')], pose: { pos: [WALL_NEAR + 0.01, 0, 0] } } },
  });
}
/** A ball of radius 0.1 m rolling without slipping at 2 m/s on a static floor (0.017 m a step), `ccd` unset. */
export function rollingBallWorld(): JsonObject {
  const r = 0.1;
  return world({
    shapes: { ball: sphere(r), floor: box([50, 0.1, 50]) },
    bodies: {
      ball: { kind: 'dynamic', shapes: [use('ball')], pose: { pos: [0, r, 0] }, velocity: { linear: [2, 0, 0], angular: [0, 0, -(2 / r) * (180 / Math.PI)] } },
      floor: { kind: 'static', shapes: [use('floor')], pose: { pos: [0, -0.1, 0] } },
    },
  });
}

export const bake = (w: JsonObject, steps: number, extra: JsonObject = {}): JsonObject => ({ call: 'bake', world: w, steps, ...extra });

export interface State { pos: Vec3; linear: Vec3 }
/** An accepted bake's states of body `id`, one per step from the built state at index 0. */
export function statesOf(reply: JsonObject, id: string, what: string): State[] {
  expect(reply['ok'], `${what} is baked: ${show(reply)}`).toBe(true);
  const series = arr(obj(reply['bodies'], `${what}: bodies`)[id], `${what}: bodies.${id}`);
  return series.map((v, j) => {
    const s = obj(v, `${what}: bodies.${id}[${j}]`);
    const vec = (x: JsonValue | undefined, k: string): Vec3 => arr(x, `${what}: bodies.${id}[${j}].${k}`).map((n, i) => num(n, `${k}[${i}]`)) as Vec3;
    return { pos: vec(s['pos'], 'pos'), linear: vec(s['linear'], 'linear') };
  });
}
export interface Row { step: number; kind: string; a: string; b: string | null; raw: JsonObject }
export function rowsOf(reply: JsonObject, what: string): Row[] {
  return arr(reply['occurrences'], `${what}: occurrences`).map((v, i) => {
    const o = obj(v, `${what}: occurrences[${i}]`);
    return { step: num(o['step'], `${what}: occurrences[${i}].step`), kind: str(o['kind'], `${what}: occurrences[${i}].kind`), a: String(o['a']), b: o['b'] === null || o['b'] === undefined ? null : String(o['b']), raw: o };
  });
}
/** The first row of `kind` between bodies `x` and `y`, in either order. */
export const firstBetween = (rows: Row[], kind: string, x: string, y: string): Row | undefined =>
  rows.find((r) => r.kind === kind && ((r.a === x && r.b === y) || (r.a === y && r.b === x)));

// ---------------------------------------------------------------------------------------------------
// The behavior kit (README: The surface under test): `behavior_fixtures`, `behavior_kit` and `backend`.

export type Tolerance = { unit: 'relative' | 'm' | 'deg' | 'steps'; value: number };
export function toleranceOf(v: JsonValue | undefined, what: string): Tolerance {
  const o = obj(v, what);
  const keys = Object.keys(o);
  expect(keys.length === 1 && ['relative', 'm', 'deg', 'steps'].includes(keys[0]!), `${what} is one of {relative | m | deg | steps: n}, got ${show(o)}`).toBe(true);
  return { unit: keys[0] as Tolerance['unit'], value: num(o[keys[0]!], `${what}.${keys[0]}`) };
}
export const showTolerance = (t: Tolerance): string => (t.unit === 'relative' ? `${+(t.value * 100).toFixed(6)}%` : `${t.value} ${t.unit}`);

export interface KitResult {
  backend: string; fixture: string; measured: number | null; answer: number | null; tolerance: JsonValue | undefined;
  caps: string[]; result: 'pass' | 'fail' | 'excluded_by_caps'; what: string; raw: JsonObject;
}
export interface KitReport {
  backend: string; target: string; admitted: boolean; refused: JsonObject | null; verdict: string; results: KitResult[]; raw: JsonObject;
}
export const kitCall = (): JsonObject => ({ call: 'behavior_kit' });
export function kitReport(reply: JsonObject, what: string): KitReport {
  expect(reply['ok'], `${what}: the behavior kit ran (call behavior_kit): ${show(reply)}`).toBe(true);
  const results = arr(reply['results'], `${what}: results`).map((v, i) => {
    const o = obj(v, `${what}: results[${i}]`);
    const r = str(o['result'], `${what}: results[${i}].result`);
    expect(['pass', 'fail', 'excluded_by_caps'], `${what}: results[${i}].result`).toContain(r);
    return {
      backend: str(o['backend'], `${what}: results[${i}].backend`), fixture: str(o['fixture'], `${what}: results[${i}].fixture`),
      measured: typeof o['measured'] === 'number' ? o['measured'] : null, answer: typeof o['answer'] === 'number' ? o['answer'] : null,
      tolerance: o['tolerance'], caps: o['caps'] === undefined ? [] : strs(o['caps'], `${what}: results[${i}].caps`),
      result: r as KitResult['result'], what: typeof o['what'] === 'string' ? o['what'] : '', raw: o,
    };
  });
  return {
    backend: str(reply['backend'], `${what}: backend`), target: str(reply['target'], `${what}: target`),
    admitted: reply['admitted'] === true, refused: isObject(reply['refused']) ? reply['refused'] : null,
    verdict: str(reply['verdict'], `${what}: verdict`), results, raw: reply,
  };
}
export function resultOf(k: KitReport, fixture: string, what: string): KitResult {
  const r = k.results.filter((x) => x.fixture === fixture);
  expect(r.length, `${what}: the kit's report holds fixture ${fixture} once; it holds ${k.results.map((x) => x.fixture).join(', ')}`).toBe(1);
  return r[0]!;
}

export interface FixtureData { name: string; world: JsonObject; measure: JsonValue; answer: number; tolerance: JsonValue; caps: string[] }
export function fixturesOf(reply: JsonObject, what: string): FixtureData[] {
  expect(reply['ok'], `${what}: the interface's fixtures answer (call behavior_fixtures): ${show(reply)}`).toBe(true);
  return arr(reply['fixtures'], `${what}: fixtures`).map((v, i) => {
    const o = obj(v, `${what}: fixtures[${i}]`);
    return {
      name: str(o['name'], `${what}: fixtures[${i}].name`), world: obj(o['world'], `${what}: fixtures[${i}].world`), measure: o['measure'] ?? null,
      answer: num(o['answer'], `${what}: fixtures[${i}].answer`), tolerance: o['tolerance'] ?? null, caps: strs(o['caps'] ?? [], `${what}: fixtures[${i}].caps`),
    };
  });
}
export interface BackendInfo { backend: string; reference: boolean; caps: string[]; tolerances: JsonObject; raw: JsonObject }
export function backendOf(reply: JsonObject, what: string): BackendInfo {
  expect(reply['ok'], `${what}: the backend's manifest answers (call backend): ${show(reply)}`).toBe(true);
  return {
    backend: str(reply['backend'], `${what}: backend`), reference: reply['reference'] === true, caps: strs(reply['caps'], `${what}: caps`),
    tolerances: isObject(reply['tolerances']) ? reply['tolerances'] : {}, raw: reply,
  };
}

/** The caps that run a body kind's controller (README): fixtures needing them join with #182 and #251. */
export const CHARACTER_CAP = 'character_controller';
export const SOFT_CAP = 'soft_bodies';

/** The fixtures the issue's Scope lists, with its answers as printed and its tolerances (README: Fixture names). */
export type Side = 'both' | 'at_most' | 'exact';
export interface Expected { name: string; answer: string | null; tolerance: Tolerance | null; side: Side; seconds?: boolean }
const rel = (value: number): Tolerance => ({ unit: 'relative', value });
export const EXPECTED: Expected[] = [
  { name: 'free_fall', answer: '4.905', tolerance: rel(0.01), side: 'both' },
  { name: 'projectile_range', answer: '10.19', tolerance: rel(0.01), side: 'both' },
  { name: 'pendulum_period', answer: '2.010', tolerance: rel(0.01), side: 'both' },
  { name: 'bounce_max', answer: '0.81', tolerance: rel(0.03), side: 'both' },
  { name: 'bounce_min', answer: '0.25', tolerance: rel(0.03), side: 'both' },
  { name: 'bounce_average', answer: '0.49', tolerance: rel(0.03), side: 'both' },
  { name: 'bounce_geometric', answer: '0.45', tolerance: rel(0.03), side: 'both' },
  { name: 'bounce_multiply', answer: '0.2025', tolerance: rel(0.03), side: 'both' },
  { name: 'slide_geometric', answer: '3.186', tolerance: rel(0.03), side: 'both' },
  { name: 'slide_average', answer: '2.548', tolerance: rel(0.03), side: 'both' },
  { name: 'slide_min', answer: '6.371', tolerance: rel(0.03), side: 'both' },
  { name: 'slide_max', answer: '1.593', tolerance: rel(0.03), side: 'both' },
  { name: 'slide_multiply', answer: '7.964', tolerance: rel(0.03), side: 'both' },
  { name: 'slope_hold', answer: '0', tolerance: { unit: 'm', value: 0.001 }, side: 'both' },
  { name: 'slope_slide', answer: '1.314', tolerance: rel(0.03), side: 'both' },
  { name: 'hinge_limit', answer: '30', tolerance: { unit: 'deg', value: 0.5 }, side: 'at_most' },
  { name: 'slider_limit', answer: '0.5', tolerance: { unit: 'm', value: 0.005 }, side: 'at_most' },
  { name: 'hinge_motor', answer: '90', tolerance: rel(0.01), side: 'both' },
  { name: 'first_contact_time', answer: '0.4515', tolerance: { unit: 'steps', value: 1 }, side: 'both', seconds: true },
  { name: 'first_contact_speed', answer: '4.429', tolerance: rel(0.02), side: 'both' },
  { name: 'sensor_entry', answer: '0.3193', tolerance: { unit: 'steps', value: 1 }, side: 'both', seconds: true },
  { name: 'sleep', answer: null, tolerance: { unit: 'steps', value: 2 }, side: 'at_most' },
  { name: 'sleep_off', answer: '0', tolerance: null, side: 'exact' },
  { name: 'queries', answer: '0', tolerance: null, side: 'exact' },
  { name: 'ccd_wall', answer: '0.04975', tolerance: { unit: 'steps', value: 1 }, side: 'both', seconds: true },
];
/** The sensor matrix's cells (criterion 10): each sensor body kind against each crosser, and a body inside from the start. */
export const SENSORS = ['static', 'kinematic', 'dynamic'] as const;
export const CROSSERS = ['dynamic', 'kinematic', 'character', 'placed', 'inside'] as const;
export const cell = (sensor: string, crosser: string): string => `sensor/${sensor}/${crosser}`;
export const CELLS = SENSORS.flatMap((s) => CROSSERS.map((c) => cell(s, c)));
/** The cells that need a character controller (README: the character and `place` cells join with #182). */
export const needsCharacter = (fixture: string): boolean => /\/(character|placed)$/.test(fixture);
/** Each cell's rows (criterion 10): one enter and one exit at these steps, within `within` steps. */
export function cellSteps(fixture: string): { enter: number; exit: number; within: number } {
  if (fixture.endsWith('/placed')) return { enter: 300, exit: 360, within: 0 };
  if (fixture.endsWith('/inside')) return { enter: 1, exit: 240, within: 0 };
  return { enter: 75, exit: 165, within: 1 };
}

/** Half a unit in the last digit the issue prints: how far the interface's exact answer may sit from the printed one. */
const printedHalfUnit = (printed: string): number => 0.5 * 10 ** -((printed.split('.')[1] ?? '').length);
/** The tolerance as an absolute bound on `|measured − answer|` (steps are 1/120 s for an answer in seconds). */
export function bound(t: Tolerance, answer: number, seconds = false): number {
  if (t.unit === 'relative') return t.value * Math.abs(answer);
  if (t.unit === 'steps') return seconds ? t.value * STEP : t.value;
  return t.value;
}

/** The sleep fixture's answer from its world: the world's sleep time in steps (Physics: behavior kit; solver.sleep.time 0.5 s by default). */
export function sleepAnswer(w: JsonObject): number {
  const sleep = isObject(w['solver']) && isObject(w['solver']['sleep']) ? w['solver']['sleep'] : {};
  const time = typeof sleep['time'] === 'number' ? sleep['time'] : 0.5;
  const rate = typeof w['step_rate'] === 'number' ? w['step_rate'] : RATE;
  return Math.round(time * rate);
}

/**
 * Everything wrong with one result read as a pass on the reference backend: the interface's answer and tolerance are
 * the issue's, the result is `pass`, and its measured value lies within the tolerance on the issue's side.
 */
export function passFailures(r: KitResult, e: Expected, data: FixtureData | undefined): string[] {
  const out: string[] = [];
  const at = `${r.backend} ${r.fixture}`;
  if (r.result !== 'pass') out.push(`${at} reads ${r.result}, not pass: ${show(r.raw)}`);
  if (r.measured === null) out.push(`${at} lists no measured value beside its answer: ${show(r.raw)}`);
  if (r.answer === null) { out.push(`${at} lists no answer: ${show(r.raw)}`); return out; }
  const answer = e.answer === null ? (data ? sleepAnswer(data.world) : null) : Number(e.answer);
  if (answer !== null) {
    const off = Math.abs(r.answer - answer);
    const allowed = e.answer === null ? 0 : printedHalfUnit(e.answer) + 1e-12;
    if (off > allowed) out.push(`${at}: the answer ${r.answer} isn't the issue's ${e.answer ?? `${answer} steps (the world's sleep time)`}`);
  }
  if (e.tolerance) {
    let t: Tolerance | null = null;
    try { t = toleranceOf(r.tolerance, `${at}.tolerance`); } catch (err) { out.push((err as Error).message.split('\n')[0]!); }
    if (t && (t.unit !== e.tolerance.unit || Math.abs(t.value - e.tolerance.value) > 1e-12)) out.push(`${at}: tolerance ${show(r.tolerance ?? null)}, the issue's is ${showTolerance(e.tolerance)}`);
    if (r.measured !== null) {
      const b = bound(e.tolerance, r.answer, e.seconds);
      const ok = e.side === 'at_most' ? r.measured <= r.answer + b + 1e-12 : Math.abs(r.measured - r.answer) <= b + 1e-12;
      if (!ok) out.push(`${at}: measured ${r.measured} is outside ${e.side === 'at_most' ? 'at most ' : ''}${r.answer} ± ${b}`);
    }
  } else if (r.measured !== null && r.measured !== r.answer) out.push(`${at}: measured ${r.measured}, the answer is exactly ${r.answer}`);
  return out;
}

/** Everything wrong with a sensor cell's result read as a pass: its own rows hold exactly one enter and one exit at the issue's steps. */
export function cellFailures(r: KitResult): string[] {
  const out: string[] = [];
  const at = `${r.backend} ${r.fixture}`;
  if (r.result !== 'pass') out.push(`${at} reads ${r.result}, not pass: ${show(r.raw)}`);
  const rows = Array.isArray(r.raw['occurrences']) ? (r.raw['occurrences'] as JsonValue[]).filter(isObject) : null;
  if (!rows) return [...out, `${at} lists no occurrences (its sensor rows): ${show(r.raw)}`];
  const want = cellSteps(r.fixture);
  for (const [kind, step] of [['sensor_enter', want.enter], ['sensor_exit', want.exit]] as const) {
    const got = rows.filter((x) => x['kind'] === kind).map((x) => x['step']);
    if (got.length !== 1) out.push(`${at}: ${got.length} ${kind} rows (${show(got as JsonValue)}), one expected`);
    else if (typeof got[0] !== 'number' || Math.abs(got[0] - step) > want.within) out.push(`${at}: ${kind} at step ${show(got[0] as JsonValue)}, expected ${step}${want.within ? ` within ${want.within} step` : ''}`);
  }
  return out;
}

/** A result that fails, as a fail must name it (Physics: behavior kit): the backend and the fixture, in its fields and its text. */
export function failFailures(r: KitResult, backend: string): string[] {
  const out: string[] = [];
  if (r.result !== 'fail') out.push(`${r.backend} ${r.fixture} reads ${r.result}, not fail: ${show(r.raw)}`);
  if (r.backend !== backend) out.push(`${r.fixture}'s result names backend ${r.backend}, not ${backend}`);
  if (!r.what.includes(backend) || !r.what.includes(r.fixture)) out.push(`${r.fixture}'s fail text doesn't name the backend ${backend} and the fixture: ${JSON.stringify(r.what)}`);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// deep-show for the trial (#185's test implementations of test.sim@1) and the merge base.

export const SHOW_BIN = 'deep-show';
export const SIM = 'test.sim@1';
export const A = 'test.sim.a';
export const B = 'test.sim.b';
/** The deep-show builds the trial reads (README): the build in use (A), the candidate (B) and the planted B. */
export const SHOW_BUILDS = {
  inUse: ['core', 'test-sim-a', 'test-sim-behavior'],
  candidate: ['core', 'test-sim-b', 'test-sim-behavior'],
  plantedB: ['core', 'test-sim-b-plus-one', 'test-sim-behavior'],
} as const;
export type ShowBuild = keyof typeof SHOW_BUILDS;
const showArgs = (features: readonly string[]): string[] => ['build', '--locked', '--bin', SHOW_BIN, '--no-default-features', '--features', features.join(',')];

let showDir = '';
const shows = new Map<ShowBuild, { bin: string; error: string }>();
export function prebuildShow(builds: ShowBuild[]): void {
  beforeAll(() => { for (const b of builds) { try { showBin(b); } catch { /* each test reports it */ } } }, BUILD_TIMEOUT);
  afterAll(() => { if (showDir) rmSync(showDir, { recursive: true, force: true }); showDir = ''; shows.clear(); });
}
export function showBin(b: ShowBuild): string {
  let entry = shows.get(b);
  if (!entry) {
    if (!showDir) showDir = mkdtempSync(join(tmpdir(), 'deep-191-show-'));
    const bin = join(showDir, `${SHOW_BIN}-${b}`);
    const error = cargo(showArgs(SHOW_BUILDS[b]));
    if (error === '') copyFileSync(join(targetOf(REPO), 'debug', SHOW_BIN), bin);
    entry = { bin, error };
    shows.set(b, entry);
  }
  expect(entry.error, `${SHOW_BIN} builds (cargo ${showArgs(SHOW_BUILDS[b]).join(' ')})`).toBe('');
  return entry.bin;
}

const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }];
export const DOC = '01JB191000000000000000000A';
export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  return { evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 800, 600] } }, docs: { [DOC]: { panel: 'main' } }, calls };
}
/** `deep-show run`: one scenario, accepted, one reply per call; and the run's wall time in ms. */
export function showRun(bin: string, sc: JsonObject): { replies: JsonObject[]; ms: number } {
  const at = performance.now();
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const ms = performance.now() - at;
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${SHOW_BIN} run finished in time`).toBe('');
  if (run.error) throw Error(`${SHOW_BIN} run: ${run.error.message}`);
  expect(run.status, `${SHOW_BIN} run exits 0; stdout: ${(run.stdout ?? '').slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW_BIN} run: one answer line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW_BIN} run: the answer`);
  expect(out['ok'], `${SHOW_BIN} run accepted the scenario: ${show(out)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the calls').length);
  return { replies, ms };
}

/** A board holding one test.sim@1 item (the form of #185's parity fixtures); its text holds no number. */
export function simBoard(title: string, value: number): JsonObject {
  return {
    format: 1, profile: 'board', title, description: 'A corpus document of the test.sim test canvas module.', size: [320, 200],
    requires: { modules: { 'test.sim': '^1' } },
    items: { s1: { id: 's1', kind: 'test.sim@1', name: 'Item s1', order: 'a0', params: { box: [20, 20, 60, 40], value } } },
  };
}
export const SIM_ITEM = 's1';
export const TRACK_STEPS = 1200;
/** A recorded input track of 1,200 steps: `set` entries moving the item's value at the given steps. */
export function trackCall(store: string, document: JsonObject, sets: [number, number][]): JsonObject {
  return {
    call: 'track_record', store, document, steps: TRACK_STEPS,
    entries: sets.map(([step, value]) => ({ step, kind: 'set', target: SIM_ITEM, data: { path: 'params.value', value } })),
  };
}

// ---------------------------------------------------------------------------------------------------
// The merge base, exported whole by `git archive` into the (git-ignored) target folder and built apart.

export function mergeBase(): string {
  return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
}
/** A release `deep-physics` built from the merge base in its own checkout and target folder, copied to `to`; '' or cargo's error. */
export function mergeBasePhysics(sha: string, to: string): string {
  const dir = join(REPO, 'target', 'acceptance-191-base', sha.slice(0, 12));
  const done = join(dir, '.exported');
  if (!existsSync(done)) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tar = join(dir, '..', `${sha.slice(0, 12)}.tar`);
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha], { cwd: REPO });
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    rmSync(tar, { force: true });
    writeFileSync(done, sha);
  }
  const error = cargo(['build', '--locked', '--release', '-p', 'deep-physics-rapier', '--bin', PHYSICS_BIN], { CARGO_TARGET_DIR: join(dir, 'target') }, dir);
  if (error === '') copyFileSync(join(dir, 'target', 'release', PHYSICS_BIN), to);
  return error;
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (as tests/acceptance/185).

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing here would be a reading, not a budget result; null on a reference Mac fit to judge. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = sh('pmset', '-g', 'batt');
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const [oneMinute] = loadavg();
  if (oneMinute! > availableParallelism()) return `loaded past its core count: 1-minute load ${oneMinute!.toFixed(1)} on ${availableParallelism()} cores`;
  return null;
}

export type Judged = { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; shown: string };
/** The design's rule on five runs after warm-up: PASS all within the limit, FAIL all over it by more than the margin (the larger of 5% and their spread), else INCONCLUSIVE. */
export function judgeRuns(name: string, runs: number[], limit: number): Judged {
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit.toFixed(3)} (margin ${(margin * 100).toFixed(0)}%)`;
  if (runs.length !== 5) return { status: 'INCONCLUSIVE', shown: `${shown}: not five runs` };
  if (runs.every((r) => r <= limit)) return { status: 'PASS', shown };
  if (runs.every((r) => r > limit * (1 + margin))) return { status: 'FAIL', shown };
  return { status: 'INCONCLUSIVE', shown };
}
/** Any FAIL fails the test, else any INCONCLUSIVE skips it as INCONCLUSIVE, else it passes. */
export function settle(ctx: TestContext, judged: Judged[]): void {
  for (const j of judged) console.log(`${j.status} ${j.shown}`);
  expect(judged.filter((j) => j.status === 'FAIL').map((j) => j.shown), 'no budget is judged FAIL').toEqual([]);
  const open = judged.filter((j) => j.status === 'INCONCLUSIVE');
  if (open.length) ctx.skip(`INCONCLUSIVE ${open.map((j) => j.shown).join('; ')}`);
}
/** Off the reference Mac, or on a loaded one, a budget is a reading: the test skips as INCONCLUSIVE, never passes. */
export function gate(ctx: TestContext): void {
  const problem = environmentProblem();
  if (problem) ctx.skip(`INCONCLUSIVE: ${problem}`);
}
export const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
