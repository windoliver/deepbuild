// Test-side tools for the #449 acceptance tests (README: The surface under test). They build `deep-gpu` (#377's GPU
// layer, the binary that draws particles@1) and, for criterion 1, `deep-physics` (#2009's, so a world's occurrence
// list is baked apart from the program under test); drive `deep-gpu run` through this suite's `particles` call (the
// document check, its estimate, and each particle's CPU f64 closed form, the compute operator's captured columns and
// the item's closed-form bounds at the times asked) and through `view3d` with this suite's `particles` and
// `particle_cull` fields; build the fixture documents more than one criterion reads; and hold the reviewed references
// the readings are judged by: flight under gravity and linear drag, plane bounces solved as quadratic roots, the fold
// into a box, the chi-squared bound at 99%, the evaluated-data hash, and an animated PNG of the canvas's own frames.
// Each check that a criterion's planted program must fail returns its failures as sentences that name what failed.
// Nothing here stands in for the emitter, the solver, the check or the renderer.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/449 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const target = (): string => (process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'));
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  NO_COLOR: '1',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (scripts/proof-change.mjs). */
export const CRITERIA = {
  1: '#449.0fcfd1ef', 2: '#449.7930d605', 3: '#449.c614478f', 4: '#449.00a9a9b4', 5: '#449.3a94376c', 6: '#449.6717a1ad',
  7: '#449.3af744f9', 8: '#449.21cedb6d', 9: '#449.dd4fc4ae', 10: '#449.31a6c28c', 11: '#449.776a76da', 17: '#449.3f28ed99',
} as const;
/** A test title's prefix: `AC<n> #449.<id>`. */
export const ac = (n: keyof typeof CRITERIA): string => `AC${n} ${CRITERIA[n]}`;

/** Every test passes this timeout: a cold build of deep-gpu takes many minutes. */
export const TIMEOUT = 3_600_000;
const MIB = 1024 * 1024;

// ---------------------------------------------------------------------------------------------------
// JSON and failures

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const show = (v: unknown): string => JSON.stringify(v)?.slice(0, 1200) ?? 'undefined';
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
export const clone = <T extends JsonValue>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export const SHA = /^[0-9a-f]{64}$/;
export const fmt = (x: number, digits = 6): string => (Number.isFinite(x) ? x.toFixed(digits) : String(x));
export const fmtV = (v: readonly number[] | null, digits = 6): string => (v === null ? 'none' : `(${v.map((x) => fmt(x, digits)).join(', ')})`);

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}${failures.length > 40 ? `\n  … and ${failures.length - 40} more` : ''}`).toEqual([]);
}
/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.slice(0, 20).join('\n  ')}`).toBe(true);
  }
}
/** A test that can't be judged here fails with this, never passes. */
export function inconclusive(reason: string): never {
  return expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** A host or tool this machine lacks: the test fails with this message, never passes. */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
/** The compute operator's columns and the pixels come from the GPU layer on Metal: INCONCLUSIVE off macOS. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer runs the compute operator and draws on macOS's Metal device; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// Time: flicks (705,600,000 a second, Units and axes), and seeded random times

export const FLICKS = 705_600_000;
export const flicks = (s: number): number => Math.round(s * FLICKS);
export const secondsOf = (f: number): number => f / FLICKS;
/** A frame's time in flicks at `fps`, as view3d computes it (n × FLICKS ÷ fps, whole flicks). */
export const frameFlicks = (n: number, fps: number): number => Math.floor((n * FLICKS) / fps);
/** A seeded generator in [0, 1) (mulberry32), so every run draws the same "random" times. */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
/** `n` distinct times in whole flicks strictly between `from` and `to` seconds, each one `keep` accepts, ascending. */
export function randomFlicks(seed: number, n: number, from: number, to: number, keep: (s: number) => boolean = () => true): number[] {
  const rnd = random(seed);
  const out = new Set<number>();
  for (let tries = 0; out.size < n; tries++) {
    if (tries > n * 1000) throw Error(`randomFlicks: fewer than ${n} times in (${from}, ${to}) s pass the filter`);
    const f = flicks(from + (to - from) * rnd());
    if (f > flicks(from) && f < flicks(to) && keep(secondsOf(f))) out.add(f);
  }
  return [...out].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each binary built once per file with `cargo build --locked --bin <name>`, copied out of the target folder.

export type BinName = 'deep-gpu' | 'deep-physics';
function cargo(args: string[]): string {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV } });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ENOENT') return `BLOCKED: cargo isn't on this machine (looked on PATH and in ${RUSTUP_BIN})`;
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Checking|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
export interface Bins { bin: (name: BinName) => string }
/** Builds every listed binary before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBins(names: readonly BinName[]): Bins {
  let dir = '';
  const made = new Map<BinName, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-449-bins-'));
    for (const name of names) {
      const error = cargo(['build', '--locked', '--bin', name]);
      const bin = join(dir, name);
      if (error === '') copyFileSync(join(target(), 'debug', name), bin);
      made.set(name, { bin, error });
    }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(name: BinName): string {
      const entry = made.get(name);
      if (!entry) throw Error(`the file didn't list ${name} in useBins`);
      if (entry.error.startsWith('BLOCKED:')) throw Error(entry.error);
      expect(entry.error, `${name} builds: cargo build --locked --bin ${name}`).toBe('');
      return entry.bin;
    },
  };
}

/** The other architecture this Mac runs: deep-gpu built for x86_64 macOS, run under Rosetta 2 (criterion 3). */
export const X86 = 'x86_64-apple-darwin';
/** Why an x86_64 build can't run on this machine, or null when it can. */
export function x86Unavailable(): string | null {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return `this is ${process.platform} ${process.arch}, not an arm64 Mac that runs x86_64 binaries under Rosetta 2`;
  const targets = spawnSync('rustup', ['target', 'list', '--installed'], { cwd: REPO, encoding: 'utf8', env: { ...process.env, ...CARGO_ENV } });
  if (targets.error) return `rustup can't run: ${targets.error.message}`;
  if (!(targets.stdout ?? '').split('\n').map((l) => l.trim()).includes(X86)) return `rustup lists no ${X86} target for the pinned toolchain`;
  if (spawnSync('arch', ['-x86_64', '/usr/bin/true']).status !== 0) return 'Rosetta 2 isn\'t available to run an x86_64 binary';
  return null;
}
/** `cargo build --locked --target x86_64-apple-darwin --bin deep-gpu`, copied into `dir`. */
export function buildX86(dir: string): string {
  const error = cargo(['build', '--locked', '--target', X86, '--bin', 'deep-gpu']);
  if (error.startsWith('BLOCKED:')) throw Error(error);
  expect(error, `deep-gpu builds for ${X86}: cargo build --locked --target ${X86} --bin deep-gpu`).toBe('');
  const bin = join(dir, 'deep-gpu-x86_64');
  copyFileSync(join(target(), X86, 'debug', 'deep-gpu'), bin);
  return bin;
}

/** A fresh temporary folder per test (outputs, generated documents), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-449-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
/** Writes a JSON file under `dir` and returns its absolute path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}
export const fixturePath = (...parts: string[]): string => join(HERE, 'fixtures', ...parts);
export function fixture(...parts: string[]): JsonObject {
  const v = JSON.parse(readFileSync(fixturePath(...parts), 'utf8')) as JsonValue;
  if (!isObject(v)) throw Error(`fixture ${parts.join('/')} is not a JSON object`);
  return v;
}
/** The look every GPU test draws with (fixtures/look.json: #420's acceptance look). */
export const look = (): JsonObject => fixture('look.json');

// ---------------------------------------------------------------------------------------------------
// Running binaries: one JSON line in, one JSON line out.

/** `deep-gpu --planted` names this suite adds (README: Planted programs). */
export type Planted =
  | 'count_cap_65536_every_class' | 'count_cap_1048576_every_class' | 'bounce_first_two_planes' | 'land_floor_plane_only'
  | 'drag_first_order' | 'drag_euler_120' | 'turbulence_table_zeros' | 'bounds_emit_region_only' | 'hides_at_span_end';
export interface Startup { backend?: 'noop'; planted?: Planted; x86?: boolean }
/** One `deep-gpu run` scenario `{out, calls}`: exit 0, one answer line, accepted, one reply per call. */
export function runGpu(bin: string, out: string, calls: JsonObject[], s: Startup = {}): JsonObject[] {
  const args = ['run', ...(s.backend ? ['--backend', s.backend] : []), ...(s.planted ? ['--planted', s.planted] : [])];
  const what = `deep-gpu ${args.join(' ')}${s.x86 ? ' (x86_64, under Rosetta 2)' : ''}`;
  const run = spawnSync(s.x86 ? 'arch' : bin, s.x86 ? ['-x86_64', bin, ...args] : args, {
    cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL',
  });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished within its timeout`).toBe('');
  if (run.error) throw Error(`${what}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(run.status, `${what} exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one answer line for the one scenario line`).toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what} refused the scenario: ${show(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((r, i) => obj(r, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(calls.length);
  return replies;
}
/** `deep-physics` (#2009): calls on stdin, one JSON reply line per call. */
export function runPhysics(bin: string, calls: JsonObject[]): JsonObject[] {
  const run = spawnSync(bin, [], { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`deep-physics: ${run.error.message}`);
  expect(run.status, `deep-physics exits 0; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-physics: one reply per call').toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `deep-physics: reply ${i}`));
}

// ---------------------------------------------------------------------------------------------------
// Documents (README: Document fields). Every particles item with planes or a landing sits at the world origin,
// unrotated, unless a fixture says otherwise.

export const SIZE: [number, number] = [320, 240];
/** A whole document as a session holds it (#378): an `id`, one writer layer, every item in it. */
export function sessionDoc(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(items)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, layer: 'main', ...item };
  return {
    format: 1, id: `doc-449-${slug}`, profile: 'scene', title, description: `${title}: a #449 acceptance fixture.`, size: SIZE, seed: 449,
    ...('cam' in items ? { camera: 'cam' } : {}),
    requires: { modules: { scene3d: '^1', effects: '^1' } },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    ...extra,
    items: withIds,
  };
}
export const camera = (position: V3, target: V3, fov = 40): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov } });
export const markBox = (size: V3, pos: V3, role: string): JsonObject => ({ kind: 'mark.box@1', params: { size, paint: { fill: { role } } }, at: { pos } });
export const particlesItem = (params: JsonObject, pos: V3 = [0, 0, 0]): JsonObject => ({ kind: 'particles@1', params, at: { pos } });
/** How a particles item draws in these fixtures. */
export const SPARK_LOOK: JsonObject = { size: 4, opacity: 1, color: [{ at: 0, role: 'spark-a' }, { at: 1, role: 'spark-b' }] };

/** A bounce plane: the set n · p = offset (m); particles stay where n · p ≥ offset (README: Document fields). */
export interface Plane { normal: V3; offset: number }
export const planeJson = (p: Plane): JsonObject => ({ normal: p.normal, offset: p.offset });
/** Criterion 6's planes in the issue's order, x = 1, x = −1, y = 1, y = −1, z = 1 and z = −1 m, each normal into the box. */
export const BOX_PLANES: readonly Plane[] = [
  { normal: [-1, 0, 0], offset: -1 }, { normal: [1, 0, 0], offset: -1 },
  { normal: [0, -1, 0], offset: -1 }, { normal: [0, 1, 0], offset: -1 },
  { normal: [0, 0, -1], offset: -1 }, { normal: [0, 0, 1], offset: -1 },
];
/** Criterion 6: one particle launched from the origin at (3, 2, 0.5) m/s with no gravity or drag in the box. */
export const BOX_VELOCITY: V3 = [3, 2, 0.5];
export function boxDoc(then: 'die' | 'rest', planes: readonly Plane[] = BOX_PLANES): JsonObject {
  return sessionDoc(`Six-plane box ${then}${planes.length === 6 ? '' : ` ${planes.length} planes`}`, {
    cam: camera([2.6, 1.8, 4.2], [0, 0, 0], 45),
    back: markBox([2, 2, 0.02], [0, 0, -1.01], 'floor'),
    left: markBox([0.02, 2, 2], [-1.01, 0, 0], 'floor'),
    base: markBox([2, 0.02, 2], [0, -1.01, 0], 'floor'),
    bead: particlesItem({
      count: 1, emit: { shape: 'point', bursts: [{ t: '0s', count: 1 }] }, life: [10, 10],
      motion: { ballistic: { velocity: BOX_VELOCITY, gravity: [0, 0, 0], drag: 0 }, bounce: { planes: planes.map(planeJson), restitution: 1, friction: 0, max: 4, then } },
      draw: 'puff', ...SPARK_LOOK, size: 18,
    }),
  }, { transport: { span: '3s' } });
}

/**
 * Criteria 2 and 10: 64 sparks burst from the origin at 0 s, 2 to 4 m/s up a cone about +Y, under gravity with no drag,
 * bouncing off a floor y = −0.5 m and a wall x = 1.2 m (restitution 0.5, friction 0, at most 3 bounces, then they die),
 * with an undeclared box in the way of some, which they never bounce off.
 */
export const SPARK_PLANES: readonly Plane[] = [{ normal: [0, 1, 0], offset: -0.5 }, { normal: [-1, 0, 0], offset: -1.2 }];
export const SPARK_BOUNCE = { restitution: 0.5, max: 3, life: 5 } as const;
export const OBSTACLE = { size: [0.6, 0.6, 0.6] as V3, pos: [-0.8, 0, 0] as V3 };
export function sparksDoc(): JsonObject {
  return sessionDoc('Sparks on two planes', {
    cam: camera([0.5, 1.5, 5], [0.2, 0, 0], 50),
    floor: markBox([4, 0.02, 3], [0.2, -0.51, 0], 'floor'),
    wall: markBox([0.02, 2, 3], [1.21, 0.5, 0], 'floor'),
    obstacle: markBox(OBSTACLE.size, OBSTACLE.pos, 'crate'),
    sparks: particlesItem({
      count: 64, emit: { shape: 'point', bursts: [{ t: '0s', count: 64 }] }, life: [SPARK_BOUNCE.life, SPARK_BOUNCE.life],
      motion: {
        ballistic: { v0: [2, 4], gravity: [0, -9.81, 0], drag: 0 },
        bounce: { planes: SPARK_PLANES.map(planeJson), restitution: SPARK_BOUNCE.restitution, friction: 0, max: SPARK_BOUNCE.max, then: 'die' },
      },
      draw: 'spark', ...SPARK_LOOK,
    }),
  }, { transport: { span: '3s' } });
}

/**
 * Criteria 3, 9 and 10: 256 puffs burst at 0 s from a 0.2 m ball, drifting up at 0.3 to 0.6 m/s with drag 0.2/s and a
 * lift of 0.5 m/s², with the turbulence given (or none). Strength in m, frequency 1/m, travel s.
 */
export interface Turbulence { strength: number; seed: number; paths?: number; steps?: number }
export function smokeDoc(turbulence: Turbulence | null, title = 'Smoke'): JsonObject {
  const params: JsonObject = {
    count: 256, emit: { shape: 'sphere', radius: 0.2, bursts: [{ t: '0s', count: 256 }] }, life: [4, 4],
    motion: { ballistic: { v0: [0.3, 0.6], gravity: [0, 0.5, 0], drag: 0.2 } },
    draw: 'dot', ...SPARK_LOOK,
  };
  if (turbulence) params['turbulence'] = { strength: turbulence.strength, frequency: 1, paths: turbulence.paths ?? 32, steps: turbulence.steps ?? 64, travel: 4, seed: turbulence.seed };
  return sessionDoc(title, { cam: camera([0, 1.5, 6], [0, 1.2, 0], 50), smoke: particlesItem(params) }, { transport: { span: '4s' } });
}

/**
 * Criteria 7 and 17: 4,096 particles born over 0 to 1 s (rate 4,096/s, span 1 s) at y = 5 m across a 2 × 2 m square,
 * falling under 9.81 m/s² with no drag onto the collection `ground`: a 1 m cube resting on a 4 × 4 m floor whose top is
 * y = 0, under the square's centre. `bounce`: the landing bounces with restitution 0.5. `moving`: a channel moves the cube.
 */
export const RAIN = { count: 4096, height: 5, side: 2, cell: 0.05, cube: 1, floor: 4 } as const;
export function landingDoc(variant: 'rest' | 'bounce' | 'moving' = 'rest'): JsonObject {
  const params: JsonObject = {
    count: RAIN.count, emit: { shape: { box: { size: [RAIN.side, 0, RAIN.side] } }, rate: RAIN.count, span: 1 }, life: [3, 3],
    motion: { ballistic: { velocity: [0, 0, 0], gravity: [0, -9.81, 0], drag: 0 } },
    land: { on: 'ground', cell: RAIN.cell, then: variant === 'bounce' ? 'bounce' : 'rest' },
    draw: 'dot', ...SPARK_LOOK, size: 3,
  };
  if (variant === 'bounce') (params['motion'] as JsonObject)['bounce'] = { planes: [], restitution: 0.5, friction: 0, max: 3, then: 'rest' };
  const extra: JsonObject = { transport: { span: '4s' }, collections: { ground: { members: ['cube', 'floor'] } } };
  if (variant === 'moving') {
    extra['channels'] = { slide: { target: 'items/cube/at/pos', type: 'vec3', keys: { k0: { t: '0s', value: [0, 0.5, 0], interp: 'linear' }, k1: { t: '2s', value: [0.5, 0.5, 0], interp: 'linear' } } } };
  }
  return sessionDoc(`Landing ${variant}`, {
    cam: camera([4.5, 4, 6.5], [0, 1.2, 0], 45),
    floor: markBox([RAIN.floor, 0.1, RAIN.floor], [0, -0.05, 0], 'floor'),
    cube: markBox([RAIN.cube, RAIN.cube, RAIN.cube], [0, 0.5, 0], 'block'),
    rain: particlesItem(params, [0, RAIN.height, 0]),
  }, extra);
}

/** Criteria 4 and 10: the parity fixture, `fixtures/parity/vfx/emit-shapes.film`. */
export const EMIT_SHAPES = ['parity', 'vfx', 'emit-shapes.film'] as const;
export const emitShapes = (): JsonObject => fixture(...EMIT_SHAPES);
/** Every particles item of `doc` with its burst count and its count set to `n` (adding or dropping particles only). */
export function withBursts(doc: JsonObject, n: number): JsonObject {
  const out = clone(doc);
  for (const item of Object.values(obj(out['items'], 'items'))) {
    if (!isObject(item) || item['kind'] !== 'particles@1') continue;
    const p = obj(item['params'], 'params');
    p['count'] = n;
    for (const b of arr(obj(p['emit'], 'emit')['bursts'], 'emit.bursts')) obj(b, 'a burst')['count'] = n;
  }
  return out;
}
export const particleIds = (doc: JsonObject): string[] =>
  Object.entries(obj(doc['items'], 'items')).filter(([, v]) => isObject(v) && v['kind'] === 'particles@1').map(([k]) => k);

// ---------------------------------------------------------------------------------------------------
// The `particles` call (README: The surface under test)

export interface ParticlesSpec { doc: string; t?: number[]; items?: string[]; gpu?: boolean; bounds?: boolean }
export const particlesCall = (s: ParticlesSpec): JsonObject => ({ call: 'particles', ...(s as unknown as JsonObject) });

export interface Issue { code: string; severity: string; ids: string[]; path: string; actual: JsonValue; what: string; raw: JsonObject }
export interface Estimate {
  cls: string; operatorMs: number; storageBytes: number;
  items: Map<string, { elements: number; operatorMs: number; scratchBytes: number }>;
}
export interface Hit { t: number; at: V3; plane: number | null }
export interface Particle { row: number; born: number; from: V3; velocity: V3; life: number; hits: Hit[]; rest: { t: number; at: V3 } | null; ends: number }
export interface Sample { t: number; cpu: (V3 | null)[]; gpu: (V3 | null)[] | null; bounds: [V3, V3] | null }
export interface Reading { id: string; count: number; particles: Particle[]; turbulence: { table: string; paths: number; steps: number } | null; at: Sample[] }
export interface Checked { outcome: 'checked' | 'refused'; issues: Issue[]; estimate: Estimate | null; items: Map<string, Reading>; raw: JsonObject }

function v3(v: JsonValue | undefined, what: string): V3 {
  if (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))) return v as V3;
  throw Error(`${what} is [x, y, z], got ${show(v)}`);
}
const v3OrNull = (v: JsonValue | undefined, what: string): V3 | null => (v === null ? null : v3(v, what));
function issueOf(v: JsonValue, what: string): Issue {
  const o = obj(v, what);
  return {
    code: str(o['code'], `${what}.code`), severity: str(o['severity'], `${what}.severity`),
    ids: arr(o['ids'] ?? [], `${what}.ids`).map((x, i) => str(x, `${what}.ids[${i}]`)),
    path: typeof o['path'] === 'string' ? o['path'] : '', actual: o['actual'] ?? null, what: typeof o['what'] === 'string' ? o['what'] : '', raw: o,
  };
}
function particleOf(v: JsonValue, what: string): Particle {
  if (!isObject(v)) throw Error(`${what} is a particle object, got ${show(v)}`);
  const n = (k: string): number => {
    const x = v[k];
    if (typeof x !== 'number' || !Number.isFinite(x)) throw Error(`${what}.${k} is a finite number, got ${show(x)}`);
    return x;
  };
  const hits = Array.isArray(v['hits']) ? v['hits'] : null;
  if (hits === null) throw Error(`${what}.hits is a list, got ${show(v['hits'])}`);
  const rest = v['rest'];
  return {
    row: n('row'), born: n('born'), from: v3(v['from'], `${what}.from`), velocity: v3(v['velocity'], `${what}.velocity`), life: n('life'), ends: n('ends'),
    hits: hits.map((h, k) => {
      if (!isObject(h) || typeof h['t'] !== 'number') throw Error(`${what}.hits[${k}] is {t, at, plane}, got ${show(h)}`);
      const plane = h['plane'];
      if (plane !== null && typeof plane !== 'number') throw Error(`${what}.hits[${k}].plane is an index or null, got ${show(plane)}`);
      return { t: h['t'], at: v3(h['at'], `${what}.hits[${k}].at`), plane };
    }),
    rest: rest === null || rest === undefined ? null : isObject(rest) && typeof rest['t'] === 'number' ? { t: rest['t'], at: v3(rest['at'], `${what}.rest.at`) } : (() => { throw Error(`${what}.rest is {t, at} or null, got ${show(rest)}`); })(),
  };
}
function rows(v: JsonValue | undefined, count: number, what: string): (V3 | null)[] {
  if (!Array.isArray(v) || v.length !== count) throw Error(`${what} holds one entry per row, ${count}, got ${Array.isArray(v) ? v.length : show(v)}`);
  return v.map((p, i) => v3OrNull(p, `${what}[${i}]`));
}
function readingOf(id: string, v: JsonValue, want: { gpu: boolean; bounds: boolean; times: number[] }, what: string): Reading {
  const o = obj(v, what);
  const count = num(o['count'], `${what}.count`);
  const at = arr(o['at'], `${what}.at`).map((s, k): Sample => {
    const q = obj(s, `${what}.at[${k}]`);
    const w = `${what}.at[${k}]`;
    const bounds = q['bounds'];
    if (want.bounds && bounds === undefined) throw Error(`${w} has no bounds, which the call asked for`);
    let b: [V3, V3] | null = null;
    if (want.bounds && bounds !== null) {
      if (!Array.isArray(bounds) || bounds.length !== 2) throw Error(`${w}.bounds is [min, max], got ${show(bounds)}`);
      b = [v3(bounds[0], `${w}.bounds[0]`), v3(bounds[1], `${w}.bounds[1]`)];
    }
    if (want.gpu && q['gpu'] === undefined) throw Error(`${w} has no gpu columns, which the call asked for`);
    return { t: num(q['t'], `${w}.t`), cpu: rows(q['cpu'], count, `${w}.cpu`), gpu: want.gpu ? rows(q['gpu'], count, `${w}.gpu`) : null, bounds: b };
  });
  expect(at.map((s) => s.t), `${what}: one reading at each time asked, in order`).toEqual(want.times);
  const turb = o['turbulence'];
  return {
    id, count, at,
    particles: arr(o['particles'], `${what}.particles`).map((p, i) => particleOf(p, `${what}.particles[${i}]`)),
    turbulence: isObject(turb) ? { table: str(turb['table'], `${what}.turbulence.table`), paths: num(turb['paths'], `${what}.turbulence.paths`), steps: num(turb['steps'], `${what}.turbulence.steps`) } : null,
  };
}
/** A `particles` reply: answered (no call refusal), the check's outcome and issues, its estimate and readings. */
export function checkOf(reply: JsonObject, call: JsonObject, what: string): Checked {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what}: the particles call answers (README: The surface under test) rather than refusing the call: ${show(reply)}`).toBeUndefined();
  const outcome = str(reply['outcome'], `${what}: outcome`);
  expect(['checked', 'refused'], `${what}: outcome is checked or refused`).toContain(outcome);
  const issues = arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => issueOf(v, `${what}: issues[${i}]`));
  let estimate: Estimate | null = null;
  const items = new Map<string, Reading>();
  if (outcome === 'checked') {
    const e = obj(reply['estimate'], `${what}: estimate`);
    estimate = {
      cls: str(e['class'], `${what}: estimate.class`), operatorMs: num(e['operator_ms'], `${what}: estimate.operator_ms`), storageBytes: num(e['storage_bytes'], `${what}: estimate.storage_bytes`),
      items: new Map(Object.entries(obj(e['items'], `${what}: estimate.items`)).map(([k, x]) => {
        const q = obj(x, `${what}: estimate.items.${k}`);
        return [k, { elements: num(q['elements'], `${what}: estimate.items.${k}.elements`), operatorMs: num(q['operator_ms'], `${what}: estimate.items.${k}.operator_ms`), scratchBytes: num(q['scratch_bytes'], `${what}: estimate.items.${k}.scratch_bytes`) }];
      })),
    };
    const times = Array.isArray(call['t']) ? (call['t'] as number[]) : [];
    if (times.length) {
      const want = { gpu: call['gpu'] === true, bounds: call['bounds'] === true, times };
      for (const [k, v] of Object.entries(obj(reply['items'], `${what}: items`))) items.set(k, readingOf(k, v, want, `${what}: items.${k}`));
    }
  }
  return { outcome: outcome as Checked['outcome'], issues, estimate, items, raw: reply };
}
export const errors = (c: Checked): Issue[] => c.issues.filter((i) => i.severity === 'error');
/** A `particles` reply whose check passed: outcome checked, no error issue. */
export function passed(reply: JsonObject, call: JsonObject, what: string): Checked {
  const c = checkOf(reply, call, what);
  expect(c.outcome, `${what}: the check passes, got ${c.outcome} with ${show(errors(c).map((i) => i.raw))}`).toBe('checked');
  expect(errors(c).map((i) => i.raw), `${what}: no error issue`).toEqual([]);
  return c;
}
export function reading(c: Checked, id: string, what: string): Reading {
  const r = c.items.get(id);
  expect(r, `${what}: the reply reads item ${id}; it reads ${show([...c.items.keys()])}`).toBeDefined();
  return r!;
}
/** The error issues of a refused check that name `id` among their `ids`. */
export function refusalsNaming(c: Checked, id: string): Issue[] {
  return c.outcome === 'refused' ? errors(c).filter((i) => i.ids.includes(id)) : [];
}
/** Live rows at a sample: the particles the CPU (or the GPU) places at that time. */
export const liveRows = (list: (V3 | null)[]): number[] => list.flatMap((p, i) => (p === null ? [] : [i]));

// ---------------------------------------------------------------------------------------------------
// view3d (#378, #380's `from`) with this suite's `particles` and `particle_cull` fields

export interface View3Spec {
  doc: string; size?: [number, number]; fps?: number; from?: number; frames?: number;
  particles?: string[]; particle_cull?: 'none'; capture?: 'every' | number[]; targets?: 'final'[];
}
export const view3d = (c: View3Spec): JsonObject => ({ call: 'view3d', look: look(), size: SIZE, ...(c as unknown as JsonObject) });
export interface Frame { frame: number; pixelHash: string | null; final: string | null; particles: Map<string, { hash: string; live: number; culled: boolean }> }
export function framesOf(reply: JsonObject, what: string, items: readonly string[] = []): Frame[] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} was drawn, not refused: ${show(reply)}`).toBeUndefined();
  return arr(reply['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    const at = `${what}: frame ${String(f['frame'])}`;
    const particles = new Map<string, { hash: string; live: number; culled: boolean }>();
    if (items.length) {
      const p = obj(f['particles'], `${at}: particles (README: view3d's particles field)`);
      for (const id of items) {
        const q = obj(p[id], `${at}: particles.${id}`);
        expect(q['hash'], `${at}: particles.${id}.hash is a SHA-256`).toMatch(SHA);
        expect(typeof q['culled'], `${at}: particles.${id}.culled is true or false`).toBe('boolean');
        particles.set(id, { hash: q['hash'] as string, live: num(q['live'], `${at}: particles.${id}.live`), culled: q['culled'] as boolean });
      }
    }
    return {
      frame: num(f['frame'], `${what}: frames[${i}].frame`),
      pixelHash: typeof f['pixel_hash'] === 'string' ? f['pixel_hash'] : null,
      final: typeof f['final'] === 'string' ? f['final'] : null,
      particles,
    };
  });
}
/**
 * The evaluated-data hash (README: view3d's `particles`): SHA-256 over the rows in order, a live row as the byte 1
 * then x, y and z as f64 little-endian, a row with no live particle as the byte 0.
 */
export function evaluatedHash(cpu: (V3 | null)[]): string {
  const out = Buffer.alloc(cpu.reduce((n, p) => n + (p === null ? 1 : 25), 0));
  let o = 0;
  for (const p of cpu) {
    if (p === null) { out[o++] = 0; continue; }
    out[o++] = 1;
    for (const x of p) { out.writeDoubleLE(x, o); o += 8; }
  }
  return sha256(out);
}

// ---------------------------------------------------------------------------------------------------
// References (reviewed test code): flight, bounces, the box fold, bounds, chi-squared

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const gap = (a: V3, b: V3): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/**
 * Free flight τ s after leaving p0 at v0 under gravity g with linear drag d (1/s): p0 + v0 (1 − e^(−dτ)) ÷ d +
 * g (τ ÷ d − (1 − e^(−dτ)) ÷ d²); with no drag, p0 + v0 τ + g τ² ÷ 2.
 */
export function flight(p0: V3, v0: V3, g: V3, d: number, tau: number): V3 {
  if (d === 0) return [0, 1, 2].map((k) => p0[k]! + v0[k]! * tau + 0.5 * g[k]! * tau * tau) as V3;
  const gone = -Math.expm1(-d * tau);
  return [0, 1, 2].map((k) => p0[k]! + (v0[k]! * gone) / d + g[k]! * (tau / d - gone / (d * d))) as V3;
}
/** A free coordinate folded into [−1, 1], as a reflection off ±1 does (criterion 6). */
export function fold(u: number): number {
  const w = (((u + 1) % 4) + 4) % 4;
  return w <= 2 ? w - 1 : 3 - w;
}

/**
 * A particle's path off planes, with no drag and no friction, solved as the design says: each next bounce is the
 * earliest of the planes' quadratic roots at which the particle meets a plane moving against its normal; it leaves with
 * v − (1 + e)(v · n) n; after `max` bounces it dies (or rests) where it last bounced, and its life ends at born + life.
 */
export interface Path { hits: { t: number; at: V3; plane: number }[]; ends: number; rest: V3 | null; at: (t: number) => V3 | null }
export function bouncePath(born: number, p0: V3, v0: V3, g: V3, planes: readonly Plane[], e: number, max: number, life: number, then: 'die' | 'rest'): Path {
  const segs: { t0: number; p: V3; v: V3 }[] = [{ t0: born, p: p0, v: v0 }];
  const hits: Path['hits'] = [];
  let ends = born + life;
  let rest: V3 | null = null;
  for (;;) {
    const s = segs[segs.length - 1]!;
    let best = Infinity;
    let which = -1;
    planes.forEach((pl, j) => {
      const a = dot(pl.normal, g) / 2; const b = dot(pl.normal, s.v); const c = dot(pl.normal, s.p) - pl.offset;
      const roots: number[] = [];
      if (Math.abs(a) < 1e-300) { if (b !== 0) roots.push(-c / b); } else {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const q = -0.5 * (b + Math.sign(b || 1) * Math.sqrt(disc));
          roots.push(q / a);
          if (q !== 0) roots.push(c / q);
        }
      }
      for (const tau of roots) if (tau > 1e-12 && 2 * a * tau + b < 0 && tau < best) { best = tau; which = j; }
    });
    const t = s.t0 + best;
    if (which < 0 || t >= born + life) break;
    const at = flight(s.p, s.v, g, 0, best);
    const v = add(s.v, scale(g, best));
    const n = planes[which]!.normal;
    hits.push({ t, at, plane: which });
    if (hits.length >= max) {
      if (then === 'die') ends = t; else rest = at;
      segs.push({ t0: t, p: at, v: [0, 0, 0] });
      break;
    }
    segs.push({ t0: t, p: at, v: sub(v, scale(n, (1 + e) * dot(v, n))) });
  }
  const restAt = rest;
  return {
    hits, ends, rest: restAt,
    at(t: number): V3 | null {
      if (t < born || t >= ends) return null;
      let s = segs[0]!;
      for (const x of segs) if (x.t0 <= t) s = x;
      if (restAt && s === segs[segs.length - 1]) return restAt;
      return flight(s.p, s.v, g, 0, t - s.t0);
    },
  };
}

/** Slack for "lies inside" in f64 (m). */
export const INSIDE_M = 1e-9;
/** Each sample where a live particle (CPU f64) lies outside the item's bounds, naming the item, the time and the row. */
export function outsideBounds(r: Reading): string[] {
  const out: string[] = [];
  for (const s of r.at) {
    const live = liveRows(s.cpu);
    if (!live.length) continue;
    const when = `${r.id} at t = ${fmt(secondsOf(s.t), 6)} s`;
    if (s.bounds === null) { out.push(`${when}: ${live.length} particles are live and the item reports no bounds`); continue; }
    const [lo, hi] = s.bounds;
    const outside = live.filter((i) => { const p = s.cpu[i]!; return [0, 1, 2].some((k) => p[k]! < lo[k]! - INSIDE_M || p[k]! > hi[k]! + INSIDE_M); });
    if (outside.length) {
      const i = outside[0]!;
      out.push(`${when}: ${outside.length} of ${live.length} live particles lie outside its bounds ${fmtV(lo)} to ${fmtV(hi)}, first particle row ${i} at ${fmtV(s.cpu[i]!)}`);
    }
  }
  return out;
}

/** Pearson's statistic of `counts` against cell probabilities `probs`. */
export function chiSquared(counts: readonly number[], probs: readonly number[]): number {
  const n = counts.reduce((a, b) => a + b, 0);
  return counts.reduce((s, c, i) => s + (c - n * probs[i]!) ** 2 / (n * probs[i]!), 0);
}
function lnGamma(z: number): number {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61503916999185, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let x = c[0]!;
  for (let i = 1; i < 9; i++) x += c[i]! / (z - 1 + i);
  const t = z - 1 + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z - 0.5) * Math.log(t) - t + Math.log(x);
}
/** The regularized lower incomplete gamma P(a, x), by its series. */
function lowerGamma(a: number, x: number): number {
  let term = 1 / a; let sum = term;
  for (let n = 1; n < 10_000 && term > sum * 1e-17; n++) { term *= x / (a + n); sum += term; }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}
/** The fixed chi-squared bound at 99% for `df` degrees of freedom (23 → 41.638, 31 → 52.191, as tables give). */
export function chi2Bound99(df: number): number {
  let lo = 0; let hi = 10 * df + 100;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (lowerGamma(df / 2, m / 2) < 0.99) lo = m; else hi = m; }
  return lo;
}

// ---------------------------------------------------------------------------------------------------
// The taste call's recordings: the canvas's own PNG frames put into one animated PNG unchanged (#252's helper)

function chunks(png: Buffer, what: string): { type: string; data: Buffer }[] {
  expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), `${what} is a PNG`).toBe(true);
  const out: { type: string; data: Buffer }[] = [];
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o);
    out.push({ type: png.toString('latin1', o + 4, o + 8), data: png.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
  }
  return out;
}
function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length, 0); head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), body])) >>> 0, 0);
  return Buffer.concat([head, body, crc]);
}
/** An animated PNG of the canvas's PNG frames at `fps`, looping, their compressed image data moved over unchanged. */
export function apng(frames: Buffer[], fps: number, what: string): Buffer {
  const parsed = frames.map((f, i) => chunks(f, `${what}: frame ${i}`));
  const ihdr = parsed[0]!.find((c) => c.type === 'IHDR')!.data;
  parsed.forEach((p, i) => expect(p.find((c) => c.type === 'IHDR')?.data.equals(ihdr), `${what}: frame ${i} has the first frame's size and format`).toBe(true));
  const width = ihdr.readUInt32BE(0); const height = ihdr.readUInt32BE(4);
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0);
  const extra = parsed[0]!.filter((c) => !['IHDR', 'IDAT', 'IEND', 'acTL', 'fcTL', 'fdAT'].includes(c.type)).map((c) => chunk(c.type, c.data));
  const parts: Buffer[] = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...extra, chunk('acTL', actl)];
  let seq = 0;
  parsed.forEach((p, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0); fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8); fctl.writeUInt16BE(1, 20); fctl.writeUInt16BE(fps, 22);
    parts.push(chunk('fcTL', fctl));
    const data = Buffer.concat(p.filter((c) => c.type === 'IDAT').map((c) => c.data));
    if (i === 0) parts.push(chunk('IDAT', data));
    else { const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0); parts.push(chunk('fdAT', Buffer.concat([s, data]))); }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
