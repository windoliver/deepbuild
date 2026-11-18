// Test-side tools for the #182 acceptance tests (README: The surface under test). They build and drive the physics
// runner `deep-physics` (JSON lines in, one reply per line), as shipped, with this suite's test backends and released;
// `deep-show run` for the conformance kit and a logic item beside a world; `deep-physics` built for Linux x86_64 in a
// linux/amd64 container for the golden; and the reference-Mac gate for budgets. Nothing here stands in for the
// character body, its controller, the kit, a golden or a logic item: every state, row, result and issue read here is
// the implementation's own, and every expected value comes from the issue's text, computed here.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Vec3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/182 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
export const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
/** Every test passes this timeout: first builds of Rapier and deep-show take long on a shared machine. */
export const TIMEOUT = 3_600_000;
/** A file's builds before its tests: a first deep-show build on a loaded shared machine takes hours. */
export const BUILD_TIMEOUT = 4 * TIMEOUT;
/** An emulated Linux x86_64 build of Rapier and its math crates takes long (as #2010's suite found). */
export const LINUX_TIMEOUT = 3 * TIMEOUT;
const MIB = 1024 * 1024;

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: '#182.78fd65bc', 2: '#182.d146e624', 3: '#182.11a4f4a4', 4: '#182.3f233106', 5: '#182.b30809e4', 6: '#182.e8a0f46c',
  7: '#182.3a7d3534', 8: '#182.a3e169f2', 9: '#182.e3211fef', 10: '#182.ca0e2323', 11: '#182.60fc90f0', 12: '#182.e7c14b4e',
  13: '#182.bb969ef1', 14: '#182.7b2434da', 15: '#182.999cb64d', 16: '#182.7b0f1d9a', 17: '#182.adc48e67',
} as const;

// The issue's numbers.
export const G = 9.81;
export const RATE = 120;
/** One step's length, s. */
export const DT = 1 / RATE;
/** The body every criterion names: a capsule of radius 0.3 m and half height 0.6 m (1.8 m tall), offset 0.01 m. */
export const RADIUS = 0.3;
export const HALF_HEIGHT = 0.6;
/** From the body's frame (the tall capsule's centre) down to its lowest point. */
export const HALF_TALL = HALF_HEIGHT + RADIUS;
export const OFFSET = 0.01;
export const HERO = 'hero';
export const REFERENCE = 'rapier3d';
export const CHARACTER_CAP = 'character_controller';

// ---------------------------------------------------------------------------------------------------
// JSON

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: JsonValue | undefined, n = 1500): string => JSON.stringify(v)?.slice(0, n) ?? 'undefined';
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
export function bool(v: JsonValue | undefined, what: string): boolean {
  expect(typeof v, `${what} is a bool, got ${show(v)}`).toBe('boolean');
  return v as boolean;
}
export const strs = (v: JsonValue | undefined, what: string): string[] => arr(v, what).map((x, i) => str(x, `${what}[${i}]`));
export const vec3 = (v: JsonValue | undefined, what: string): Vec3 => arr(v, what).map((x, i) => num(x, `${what}[${i}]`)) as Vec3;
export const sha256 = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A planted twin is caught: the judge that passes the real program finds something wrong with the twin's output. */
export function caught(failures: readonly string[], what: string): void {
  expect(failures.length, `${what}: the wrong program is caught (the judge finds nothing wrong with it)`).toBeGreaterThan(0);
}
/** Some failure names every one of `names` (the criterion's "naming …"). */
export function named(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.some((f) => names.every((n) => f.includes(n))), `${what}: a failure names ${names.join(', ')}; failures:\n  ${failures.join('\n  ')}`).toBe(true);
}

/** A fresh folder per call (a bake store, an evidence store), deleted after the test. */
export function useTemp(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-182-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// The builds: `deep-physics` as shipped, with `test-backends`, and released; deep-show's full set.

function cargo(args: string[], env: NodeJS.ProcessEnv = {}, cwd = REPO): string {
  const run = spawnSync('cargo', args, { cwd, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ENOENT') blocked(`cargo isn't on this machine (looked on PATH and in ${RUSTUP_BIN})`);
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Checking|Finished|Downloaded|Downloading|Updating|Locking|Documenting/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
export const cargoError = cargo;

/** The builds this suite drives: `shipped` deep-physics, `test` with `test-backends`, `release` shipped and optimized, `show` deep-show's full set. */
export type Build = 'shipped' | 'test' | 'release' | 'show';
const ARGS: Record<Build, string[]> = {
  shipped: ['build', '--locked', '-p', 'deep-physics-rapier', '--bin', 'deep-physics'],
  test: ['build', '--locked', '-p', 'deep-physics-rapier', '--bin', 'deep-physics', '--features', 'test-backends'],
  release: ['build', '--locked', '--release', '-p', 'deep-physics-rapier', '--bin', 'deep-physics'],
  show: ['build', '--locked', '-p', 'deep-show', '--bin', 'deep-show'],
};
const OUT: Record<Build, [string, string]> = {
  shipped: ['debug', 'deep-physics'], test: ['debug', 'deep-physics'], release: ['release', 'deep-physics'], show: ['debug', 'deep-show'],
};
let binDir = '';
const built = new Map<Build, { bin: string; error: string }>();
/** Builds each listed build once before a file's tests (the slow part); each test reports its own build's failure. */
export function prebuild(builds: Build[]): void {
  beforeAll(() => { for (const b of builds) { try { binOf(b, false); } catch { /* each test reports it */ } } }, BUILD_TIMEOUT * builds.length);
  afterAll(() => { if (binDir) rmSync(binDir, { recursive: true, force: true }); binDir = ''; built.clear(); });
}
/** The built binary, copied out of the target folder; a test using a build that failed fails here, naming cargo's error. */
export function binOf(b: Build, judge = true): string {
  let entry = built.get(b);
  if (!entry) {
    if (!binDir) binDir = mkdtempSync(join(tmpdir(), 'deep-182-bin-'));
    const [profile, name] = OUT[b];
    const bin = join(binDir, `${name}-${b}`);
    const error = cargo(ARGS[b]);
    if (error === '') copyFileSync(join(TARGET, profile, name), bin);
    entry = { bin, error };
    built.set(b, entry);
  }
  if (judge) expect(entry.error, `${b} builds (cargo ${ARGS[b].join(' ')})`).toBe('');
  return entry.bin;
}

/** This suite's test backends (README), each wrapping Rapier, chosen with `deep-physics --backend <name>` in the test build. */
export type TestBackend = 'no_character_controller' | 'steps_too_high' | 'ignores_snap' | 'ground_distance_1mm' | 'ignores_launch_airborne';
/** This suite's planted names (`deep-physics --planted <name>`), each one criterion's wrong program. */
export type Planted =
  | 'slope_limit_ignored' | 'checkpoint_drops_vertical' | 'kit_passes_excluded' | 'character_as_kinematic' | 'place_keeps_vertical'
  | 'ceiling_keeps_upward' | 'crouch_stands_on_release' | 'corner_one_wall_at_a_time';
export interface Runner { backend?: TestBackend; planted?: Planted; build?: 'shipped' | 'test' | 'release' }

function replies(status: number | null, stdout: string, stderr: string, calls: JsonObject[], what: string): JsonObject[] {
  expect(status, `${what} exits 0; stdout: ${stdout.slice(0, 1000)}; stderr: ${stderr.slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call; stdout: ${stdout.slice(0, 1000)}`).toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i} (to ${show(calls[i], 120)})`));
}

/** Runs `calls` through one `deep-physics [--backend b] [--planted p]` process: exit 0, one JSON reply per call, in order. */
export function physics(calls: JsonObject[], r: Runner = {}): JsonObject[] {
  const args = [...(r.backend ? ['--backend', r.backend] : []), ...(r.planted ? ['--planted', r.planted] : [])];
  const bin = binOf(r.build ?? (r.backend ? 'test' : 'shipped'));
  const what = `deep-physics ${args.join(' ')}`.trim();
  const run = spawnSync(bin, args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 4096 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished in time`).toBe('');
  if (run.error && code !== 'EPIPE') throw Error(`${what}: ${run.error.message}`);
  return replies(run.status, run.stdout ?? '', run.stderr ?? '', calls, what);
}
export const one = (call: JsonObject, r: Runner = {}): JsonObject => physics([call], r)[0]!;

// ---------------------------------------------------------------------------------------------------
// World documents (physics.world@1 as the base's runner reads it: maps by ID, shape uses on bodies).

export const box = (half: Vec3): JsonObject => ({ kind: 'box', half });
export const use = (shape: string, material = 'm'): JsonObject => ({ shape, contact_material: material });
export const CAPSULE: JsonObject = { kind: 'capsule', half_height: HALF_HEIGHT, radius: RADIUS };

/** A static part of a level: its shape, in its body's frame, and the body's pose (rot a quaternion [x, y, z, w]). */
export interface Static { shape: JsonObject; pos: Vec3; rot?: [number, number, number, number] }
/** A static box spanning x0…x1 and y0…y1, and −z…z. */
export const slab = (x0: number, x1: number, y0: number, y1: number, z = 2): Static =>
  ({ shape: box([(x1 - x0) / 2, (y1 - y0) / 2, z]), pos: [(x0 + x1) / 2, (y0 + y1) / 2, 0] });
/** A ramp: a convex wedge whose top face rises from (x0, y0) to (x1, y1) along +x (y1 > y0), spanning −z…z. */
export const ramp = (x0: number, y0: number, x1: number, y1: number, z = 2): Static => ({
  shape: { kind: 'convex', points: [[x0, y0, -z], [x0, y0, z], [x1, y0, -z], [x1, y0, z], [x1, y1, -z], [x1, y1, z]] }, pos: [0, 0, 0],
});
/** A ramp whose top face falls from (x0, y1) to (x1, y0) along +x. */
export const rampDown = (x0: number, y0: number, x1: number, y1: number, z = 2): Static => ({
  shape: { kind: 'convex', points: [[x0, y0, -z], [x0, y0, z], [x0, y1, -z], [x0, y1, z], [x1, y0, -z], [x1, y0, z]] }, pos: [0, 0, 0],
});
const deg = (d: number): number => (d * Math.PI) / 180;
/** The horizontal run of a ramp of angle `angle`° that rises `rise` m. */
export const run = (rise: number, angle: number): number => rise / Math.tan(deg(angle));

/** The character's fields (README: `character`), each left to its default when absent. */
export interface Hero { slope?: number; step?: number; snap?: number; crouch?: number; gravityScale?: number }
/** A character body of the issue's capsule at `pos` (its frame, the tall capsule's centre). */
export function heroBody(pos: Vec3, h: Hero = {}, extra: JsonObject = {}): JsonObject {
  const character: JsonObject = {};
  if (h.slope !== undefined) character['slope_limit'] = h.slope;
  if (h.step !== undefined) character['step'] = { height: h.step };
  if (h.snap !== undefined) character['snap'] = h.snap;
  if (h.crouch !== undefined) character['crouch'] = { height: h.crouch };
  return {
    kind: 'character', shapes: [use('capsule')], pose: { pos }, character,
    ...(h.gravityScale !== undefined ? { gravity_scale: h.gravityScale } : {}), ...extra,
  };
}
/** The frame height of a body standing on a surface at `top`: its lowest point `offset` above it. */
export const standing = (top: number): number => top + OFFSET + HALF_TALL;

/** The inputs a character world declares: move and jump (derived from `on` when given), launch, place and crouch. */
export function heroInputs(on?: JsonObject, target = HERO): JsonObject {
  const from = on ? { on } : {};
  return {
    walk: { kind: 'move', targets: [target], ...from }, hop: { kind: 'jump', targets: [target], ...from },
    boost: { kind: 'launch', targets: [target] }, put: { kind: 'place', targets: [target] }, duck: { kind: 'crouch', targets: [target] },
  };
}

export interface WorldParts {
  statics: Record<string, Static>;
  /** Moving bodies by ID (character, dynamic), as written. */
  movers: Record<string, JsonObject>;
  shapes?: JsonObject;
  inputs?: JsonObject;
  outputs?: JsonObject;
  gravity?: Vec3;
  rate?: number;
  capacity?: JsonObject;
  extra?: JsonObject;
}
/** A world at 120 Hz (unless `rate`), 4 substeps, g 9.81 m/s²: each static under its own shape, the capsule as `capsule`. */
export function characterWorld(p: WorldParts): JsonObject {
  const shapes: JsonObject = { capsule: CAPSULE, ...(p.shapes ?? {}) };
  const bodies: JsonObject = {};
  for (const [id, s] of Object.entries(p.statics)) {
    shapes[id] = s.shape;
    bodies[id] = { kind: 'static', shapes: [use(id)], pose: s.rot ? { pos: s.pos, rot: s.rot } : { pos: s.pos } };
  }
  for (const [id, b] of Object.entries(p.movers)) bodies[id] = b;
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: p.rate ?? RATE, substeps: 4, gravity: p.gravity ?? [0, -G, 0], seed: 182, mode: 'dynamic',
    capacity: p.capacity ?? { bodies: 32, shapes: 32, joints: 0, contacts: 256, particles: 0 },
    backend: { name: REFERENCE, version: '=0.36.1' },
    contact_materials: { m: { friction: 0.5, restitution: 0, density: 1000 } },
    shapes, bodies, inputs: p.inputs ?? heroInputs(),
    ...(p.outputs ? { outputs: p.outputs } : {}), ...(p.extra ?? {}),
  };
}

/** A track entry for the hero (Input track entries: `{step, kind, target, data}`), stamped `step`. */
export const entry = (step: number, kind: string, data: JsonObject = {}, target = HERO): JsonObject => ({ step, kind, target, data });
export const walk = (step: number, v: Vec3): JsonObject => entry(step, 'move', { velocity: v });
export const jump = (step: number, height = 1): JsonObject => entry(step, 'jump', { height });

/**
 * The issue's discrete jump: the height gained after each step from the jump's step on (index 0 is the jump's step).
 * The jump's step moves it by v0 × dt; each later step first lowers its vertical speed by g × dt, then moves by it; a
 * launch at index `at` sets the vertical speed to `v` on that step instead, and moves it by v × dt.
 */
export function discreteHeights(v0: number, steps: number, launch?: { at: number; v: number }): number[] {
  const out: number[] = [];
  let y = 0;
  let v = v0;
  for (let i = 0; i < steps; i++) {
    if (i > 0) v -= G * DT;
    if (launch && i === launch.at) v = launch.v;
    y += v * DT;
    out.push(y);
  }
  return out;
}
/** A flat floor (top at y = 0, x −10 … 30) and the body standing on it at x = 0. */
export function flatWorld(extra: Partial<WorldParts> = {}): JsonObject {
  return characterWorld({ statics: { floor: slab(-10, 30, -1, 0, 4) }, movers: { [HERO]: heroBody([0, standing(0), 0]) }, ...extra });
}

export const bake = (w: JsonObject, steps: number, extra: JsonObject = {}): JsonObject => ({ call: 'bake', world: w, steps, ...extra });
export const check = (w: JsonObject, extra: JsonObject = {}): JsonObject => ({ call: 'check', world: w, ...extra });

// ---------------------------------------------------------------------------------------------------
// Reading a bake (README: a character body's state in `bodies`).

export interface Character { wants: Vec3; vertical: number; grounded: boolean; sliding: boolean; crouched: JsonValue; touching: string[] }
export interface State { pos: Vec3; linear: Vec3; character: Character | null }
function characterOf(v: JsonValue | undefined, what: string): Character | null {
  if (v === undefined || v === null) return null;
  const c = obj(v, what);
  const touching = c['touching'] === undefined ? [] : arr(c['touching'], `${what}.touching`).map((t) => (isObject(t) ? String(t['body']) : String(t)));
  return {
    wants: vec3(c['wants'], `${what}.wants`), vertical: num(c['vertical'], `${what}.vertical`),
    grounded: bool(c['grounded'], `${what}.grounded`), sliding: bool(c['sliding'], `${what}.sliding`),
    crouched: c['crouched'] ?? null, touching,
  };
}
/** An accepted bake's (or seek's) states of body `id`, index i the state after `from + i` steps. */
export function statesOf(reply: JsonObject, id: string, what: string): State[] {
  expect(reply['ok'], `${what} ran: ${show(reply)}`).toBe(true);
  const series = arr(obj(reply['bodies'], `${what}: bodies`)[id], `${what}: bodies.${id}`);
  return series.map((v, j) => {
    const s = obj(v, `${what}: bodies.${id}[${j}]`);
    return { pos: vec3(s['pos'], `${what}: bodies.${id}[${j}].pos`), linear: vec3(s['linear'], `${what}: bodies.${id}[${j}].linear`), character: characterOf(s['character'], `${what}: bodies.${id}[${j}].character`) };
  });
}
/** The character state of each state, failing where a state holds none. */
export function characterStates(states: State[], what: string): Character[] {
  return states.map((s, i) => {
    expect(s.character, `${what}: state ${i} holds the character's own state (README: \`character\`)`).not.toBeNull();
    return s.character!;
  });
}
/** The tall capsule's lowest point: its frame less 0.9 m (README: the frame stays the tall capsule's, crouched or not). */
export const lowest = (s: State): number => s.pos[1] - HALF_TALL;
export const hashesOf = (reply: JsonObject, what: string): string[] => strs(reply['step_hashes'], `${what}: step_hashes`);

export interface Row { step: number; kind: string; a: string; b: string | null; raw: JsonObject }
export function rowsOf(reply: JsonObject, what: string): Row[] {
  return arr(reply['occurrences'], `${what}: occurrences`).map((v, i) => {
    const o = obj(v, `${what}: occurrences[${i}]`);
    return { step: num(o['step'], `${what}: occurrences[${i}].step`), kind: str(o['kind'], `${what}: occurrences[${i}].kind`), a: String(o['a']), b: o['b'] === null || o['b'] === undefined ? null : String(o['b']), raw: o };
  });
}
/** Rows of `kind` between bodies `x` and `y`, in either order. */
export const between = (rows: Row[], kind: string, x: string, y: string): Row[] =>
  rows.filter((r) => r.kind === kind && ((r.a === x && r.b === y) || (r.a === y && r.b === x)));
/** The design's physics kinds in the order the list sorts them (Occurrence list). */
export const KINDS = ['contact_begin', 'contact_end', 'hit', 'force', 'sensor_enter', 'sensor_exit', 'break', 'tear', 'rest', 'wake', 'crossing', 'fault'];
/** Every pair of neighbouring rows out of the list's order, (step, kind, a, b), IDs in canonical (byte) order. */
export function unsorted(rows: Row[]): string[] {
  const key = (r: Row): [number, number, string, string] => [r.step, KINDS.indexOf(r.kind), r.a, r.b ?? ''];
  const out: string[] = [];
  for (let i = 1; i < rows.length; i++) {
    const [p, q] = [key(rows[i - 1]!), key(rows[i]!)];
    const cmp = p[0] - q[0] || p[1] - q[1] || (p[2] < q[2] ? -1 : p[2] > q[2] ? 1 : 0) || (p[3] < q[3] ? -1 : p[3] > q[3] ? 1 : 0);
    if (cmp > 0) out.push(`rows ${i - 1} and ${i} are out of the sorted order: ${show(rows[i - 1]!.raw, 200)} before ${show(rows[i]!.raw, 200)}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// The course (criteria 5 and 6): a 1 m gap, the 30° ramp rising 2 m, then the 0.3 m step, driven for 1,200 steps.

export const COURSE = 'course';
export const COURSE_STEPS = 1200;
/** The jumps' steps: over the gap (axis 0.4 m before its edge), and on the step's floor. */
export const COURSE_JUMPS = [96, 960];
export const COURSE_WALK: Vec3 = [2, 0, 0];
/** The course's levels: `start` to x 2, the 1 m gap, `shelf`, the 30° `ramp` (rising 2 m), `top`, then `step` 0.3 m up; `pit` under it all. */
export function courseStatics(): Record<string, Static> {
  const foot = 5;
  const crest = foot + run(2, 30);
  return {
    pit: slab(-4, 31, -5, -4), start: slab(-3, 2, -1, 0), shelf: slab(3, foot, -1, 0), ramp: ramp(foot, 0, crest, 2),
    top: slab(crest, 11, -1, 2), step: slab(11, 30, -1, 2.3),
  };
}
/** The course world, its move and jump inputs taking `on` (a logic item's, or a control's), with a velocity output to a readout. */
export function courseWorld(inputs: JsonObject): JsonObject {
  return characterWorld({
    statics: courseStatics(),
    movers: { [HERO]: heroBody([0, standing(0), 0], { slope: 45, step: 0.35 }) },
    inputs,
    outputs: { speed: { from: HERO, read: 'velocity', to: 'speed_readout' }, footing: { from: HERO, read: 'grounded' } },
  });
}
/** The entries the driving logic item fires, as the bake keeps them: the walk at step 0 and the two jumps. */
export const courseTrack = (): JsonObject[] => [walk(0, COURSE_WALK), ...COURSE_JUMPS.map((s) => jump(s))];

// ---------------------------------------------------------------------------------------------------
// The behavior kit (#191's calls): `behavior_fixtures`, `behavior_kit`, `backend`.

export interface KitResult { backend: string; fixture: string; measured: number | null; caps: string[]; result: string; what: string; raw: JsonObject }
export interface KitReport { backend: string; verdict: string; results: KitResult[]; raw: JsonObject }
export const KIT: JsonObject = { call: 'behavior_kit' };
export function kitReport(reply: JsonObject, what: string): KitReport {
  expect(reply['ok'], `${what}: the behavior kit ran (call behavior_kit): ${show(reply)}`).toBe(true);
  const results = arr(reply['results'], `${what}: results`).map((v, i) => {
    const o = obj(v, `${what}: results[${i}]`);
    return {
      backend: str(o['backend'], `${what}: results[${i}].backend`), fixture: str(o['fixture'], `${what}: results[${i}].fixture`),
      measured: typeof o['measured'] === 'number' ? o['measured'] : null, caps: strs(o['caps'] ?? [], `${what}: results[${i}].caps`),
      result: str(o['result'], `${what}: results[${i}].result`), what: typeof o['what'] === 'string' ? o['what'] : '', raw: o,
    };
  });
  return { backend: str(reply['backend'], `${what}: backend`), verdict: str(reply['verdict'], `${what}: verdict`), results, raw: reply };
}
export function resultOf(k: KitReport, fixture: string, what: string): KitResult {
  const r = k.results.filter((x) => x.fixture === fixture);
  expect(r.length, `${what}: the kit's report holds fixture ${fixture} once; it holds ${k.results.map((x) => x.fixture).join(', ')}`).toBe(1);
  return r[0]!;
}
export interface FixtureData { name: string; world: JsonObject; steps: number; track: JsonValue; caps: string[] }
export function fixturesOf(reply: JsonObject, what: string): FixtureData[] {
  expect(reply['ok'], `${what}: the interface's fixtures answer (call behavior_fixtures): ${show(reply)}`).toBe(true);
  return arr(reply['fixtures'], `${what}: fixtures`).map((v, i) => {
    const o = obj(v, `${what}: fixtures[${i}]`);
    return {
      name: str(o['name'], `${what}: fixtures[${i}].name`), world: obj(o['world'], `${what}: fixtures[${i}].world`),
      steps: num(o['steps'], `${what}: fixtures[${i}].steps`), track: o['track'] ?? [], caps: strs(o['caps'] ?? [], `${what}: fixtures[${i}].caps`),
    };
  });
}
export function fixtureOf(list: FixtureData[], name: string, what: string): FixtureData {
  const f = list.find((x) => x.name === name);
  expect(f, `${what}: the interface holds fixture ${name}; it holds ${list.map((x) => x.name).join(', ')}`).toBeDefined();
  return f!;
}
export function capsOf(reply: JsonObject, what: string): string[] {
  expect(reply['ok'], `${what}: the backend's manifest answers (call backend): ${show(reply)}`).toBe(true);
  return strs(reply['caps'], `${what}: caps`);
}
/** The character fixtures (README: Fixture names): the four the Scope names, and criterion 10's rules. */
export const CHARACTER_FIXTURES = ['character/slope', 'character/step', 'character/snap', 'character/jump'] as const;
export const RULE_FIXTURES = ['character/grounded_0.04', 'character/grounded_0.07', 'character/sliding_30', 'character/sliding_50'] as const;

/** A fixture world's character bodies and the lowest point of each one's capsule below its frame. */
export function charactersIn(w: JsonObject, what: string): Map<string, number> {
  const out = new Map<string, number>();
  const shapes = obj(w['shapes'], `${what}: shapes`);
  for (const [id, b] of Object.entries(obj(w['bodies'], `${what}: bodies`))) {
    if (!isObject(b) || b['kind'] !== 'character') continue;
    const u = obj(arr(b['shapes'], `${what}: bodies.${id}.shapes`)[0], `${what}: bodies.${id}.shapes[0]`);
    const s = obj(shapes[str(u['shape'], `${what}: bodies.${id}.shapes[0].shape`)], `${what}: ${id}'s capsule`);
    out.set(id, num(s['half_height'], `${what}: ${id}'s half_height`) + num(s['radius'], `${what}: ${id}'s radius`));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (#393's convention): one scenario line on stdin, one answer `{ok, replies}`.

export const SESSION = 'sess-182';
const SESSIONS: JsonObject = { [SESSION]: { thread: 'thread-182', name: 'Claude Code: character course', process: { pid: 4182, start: 1_000 } } };
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 4182, ppid: 1, start: 1_000 }];
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB182D${String(n).padStart(18, '0')}`;
export function scenario(evidence: string, docs: string[], calls: JsonObject[]): JsonObject {
  const panels: JsonObject = {};
  const docMap: JsonObject = {};
  docs.forEach((d, i) => { panels[`p${i + 1}`] = { rect: [0, 0, 800, 600] }; docMap[d] = { panel: `p${i + 1}` }; });
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels, docs: docMap, calls };
}
export function runShow(sc: JsonObject, what: string): JsonObject[] {
  const r = spawnSync(binOf('show'), ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 4096 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${what}: deep-show run did not finish within its timeout`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${what}: deep-show run exits 0; stdout: ${stdout.slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(out['ok'], `${what}: deep-show run answers the scenario ok: ${show(out)}`).toBe(true);
  const list = arr(out['replies'], `${what}: replies`).map((x, i) => obj(x, `${what}: replies[${i}]`));
  expect(list.length, `${what}: one reply per call`).toBe(arr(sc['calls'], 'calls').length);
  return list;
}
/** The evidence store (`<2 hex>/<62 hex>`), where a document's programs are found by SHA-256. */
export function putEvidence(evidence: string, bytes: Uint8Array): string {
  const h = sha256(bytes);
  mkdirSync(join(evidence, h.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, h.slice(0, 2), h.slice(2)), bytes);
  return h;
}
export const showCall = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
export function presented(reply: JsonObject | undefined, what: string): void {
  expect(reply?.['outcome'], `${what} is presented: ${show(reply?.['issues'] ?? reply ?? null, 2500)}`).toBe('presented');
  const errors = arr(reply!['issues'] ?? [], `${what}: issues`).filter((i) => isObject(i) && i['severity'] === 'error');
  expect(errors, `${what} is presented with no error`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// The second machine: this checkout built for linux/amd64 in Docker with the rust image of rust-toolchain.toml's channel,
// its caches under target/acceptance-182-linux/, as #2010's suite does. Nothing is pulled: no Docker or image is BLOCKED.

const LINUX = join(TARGET, 'acceptance-182-linux');
export const LINUX_TRIPLE = 'x86_64-unknown-linux-gnu';
function linuxImage(): string {
  const channel = /channel\s*=\s*"([^"]+)"/.exec(readFileSync(join(REPO, 'rust-toolchain.toml'), 'utf8'))?.[1];
  if (!channel) throw Error('rust-toolchain.toml names no channel');
  return `rust:${channel}-slim-bookworm`;
}
function docker(args: string[], input?: string, timeoutMs = 600_000): { status: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const r = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: timeoutMs, killSignal: 'SIGKILL', ...(input !== undefined ? { input } : {}) });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  if (r.error && !timedOut) return { status: null, stdout: '', stderr: r.error.message, timedOut };
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut };
}
let linuxBuilt: string | undefined;
/** Runs `calls` through one deep-physics process built from this checkout, in a linux/amd64 container. */
export function onLinux(calls: JsonObject[]): JsonObject[] {
  const image = linuxImage();
  if (linuxBuilt === undefined) {
    const info = docker(['info', '--format', '{{.ServerVersion}}'], undefined, 30_000);
    if (info.status !== 0) blocked(`Docker is unreachable (${info.stderr.trim().split('\n').slice(-1)[0] ?? ''}); the second machine, Linux x86_64, runs in a linux/amd64 container`);
    const arch = docker(['image', 'inspect', '--format', '{{.Architecture}}', image], undefined, 30_000);
    if (arch.status !== 0 || arch.stdout.trim() !== 'amd64') blocked(`Docker has no linux/amd64 image ${image} here and this suite pulls nothing; run: docker pull --platform linux/amd64 ${image}`);
    for (const d of ['target', 'registry', 'git']) mkdirSync(join(LINUX, d), { recursive: true });
    const b = docker([
      'run', '--rm', '--platform', 'linux/amd64',
      '-v', `${REPO}:/src:ro`, '-v', `${join(LINUX, 'target')}:/target`,
      '-v', `${join(LINUX, 'registry')}:/usr/local/cargo/registry`, '-v', `${join(LINUX, 'git')}:/usr/local/cargo/git`,
      '-w', '/src', '-e', 'CARGO_TARGET_DIR=/target', '-e', `RUSTUP_TOOLCHAIN=${image.replace(/^rust:/, '').replace(/-slim-bookworm$/, '')}`,
      '-e', `CARGO_INCREMENTAL=${CARGO_ENV['CARGO_INCREMENTAL'] ?? '0'}`, '-e', `CARGO_PROFILE_DEV_DEBUG=${CARGO_ENV['CARGO_PROFILE_DEV_DEBUG'] ?? '0'}`,
      image, 'cargo', 'build', '--locked', '-p', 'deep-physics-rapier', '--bin', 'deep-physics',
    ], undefined, LINUX_TIMEOUT - 1_800_000);
    linuxBuilt = b.status === 0 ? '' : `cargo build in ${image} (linux/amd64) failed${b.timedOut ? ' (timed out)' : ''}:\n${b.stderr.slice(-4000)}`;
  }
  expect(linuxBuilt, 'deep-physics builds for Linux x86_64').toBe('');
  const text = `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`;
  const r = docker(['run', '--rm', '-i', '--platform', 'linux/amd64', '-v', `${join(LINUX, 'target')}:/target:ro`, image, '/target/debug/deep-physics'], text, 1_800_000);
  expect(r.timedOut ? 'timed out' : '', 'deep-physics on linux/amd64 finished in time').toBe('');
  return replies(r.status, r.stdout, r.stderr, calls, 'deep-physics on linux/amd64');
}

// ---------------------------------------------------------------------------------------------------
// The merge base, exported whole by `git archive` into the (git-ignored) target folder and built apart.

export function mergeBase(): string {
  return execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
}
/** A release `deep-physics` built from the merge base in its own checkout and target folder, copied to `to`; '' or cargo's error. */
export function mergeBasePhysics(sha: string, to: string): string {
  const dir = join(TARGET, 'acceptance-182-base', sha.slice(0, 12));
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
  const error = cargo(['build', '--locked', '--release', '-p', 'deep-physics-rapier', '--bin', 'deep-physics'], { CARGO_TARGET_DIR: join(dir, 'target') }, dir);
  if (error === '') copyFileSync(join(dir, 'target', 'release', 'deep-physics'), to);
  return error;
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (as #191's and #185's suites).

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
  const shown = `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit.toFixed(4)} (margin ${(margin * 100).toFixed(0)}%)`;
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
