// The tools of #182's Oracle port of upstream's character_controller_climb_test (README: The surface under test). They
// build and drive the physics runner `deep-physics` (JSON lines in, one reply per line), write the upstream test's world
// as our physics.world@1 document, and read a bake's character states. Written in the style of
// tests/acceptance/191-oracle and tests/acceptance/2009-oracle and their suites' helpers; nothing is imported across
// suites. Every value read here is the implementation's own answer; every expected value is upstream's, in the test file.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Vec3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (this folder is three levels down). */
const REPO = join(HERE, '..', '..', '..');
const targetOf = (root: string): string => (process.env['CARGO_TARGET_DIR'] ? resolve(root, process.env['CARGO_TARGET_DIR']) : join(root, 'target'));
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
/** Every test passes this timeout: a first build of Rapier takes many minutes on a shared machine. */
export const TIMEOUT = 3_600_000;
/** The file's build before its test, on a loaded shared machine. */
const BUILD_TIMEOUT = 4 * TIMEOUT;
const MIB = 1024 * 1024;

/** A tool this machine lacks: the test fails with this message, never passes (invariant 2). */
const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

// ---------------------------------------------------------------------------------------------------
// JSON

const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${show(v)}`).toBe(true);
  return v as JsonObject;
}
function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${show(v)}`).toBe(true);
  return v as JsonValue[];
}
function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${show(v)}`).toBe(true);
  return v as number;
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A wrong program is caught: the judge that passes the real program finds something wrong with its answer. */
export function caught(failures: readonly string[], what: string): void {
  expect(failures.length, `${what}: the wrong program is caught (the judge finds nothing wrong with its answer)`).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-physics` as shipped, built once before the file's test and copied out of the target folder.

const PHYSICS_BIN = 'deep-physics';
const BUILD_ARGS = ['build', '--locked', '-p', 'deep-physics-rapier', '--bin', PHYSICS_BIN];

/** cargo's error, or '' when it built; no cargo at all is BLOCKED. */
function cargoBuild(): string {
  const run = spawnSync('cargo', BUILD_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, timeout: BUILD_TIMEOUT - 60_000, killSignal: 'SIGKILL', env: { ...process.env, ...CARGO_ENV } });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ENOENT') blocked(`cargo isn't on this machine (looked on PATH and in ${RUSTUP_BIN})`);
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${BUILD_ARGS.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Checking|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  return '';
}

let binDir = '';
let built: { bin: string; error: string } | null = null;
/** Builds `deep-physics` once before the file's test (the slow part); the test reports the build's failure. */
export function prebuild(): void {
  beforeAll(() => { try { physicsBin(); } catch { /* the test reports it */ } }, BUILD_TIMEOUT);
  afterAll(() => { if (binDir) rmSync(binDir, { recursive: true, force: true }); binDir = ''; built = null; });
}
function physicsBin(): string {
  if (!built) {
    if (!binDir) binDir = mkdtempSync(join(tmpdir(), 'deep-182-climb-bin-'));
    const bin = join(binDir, PHYSICS_BIN);
    const error = cargoBuild();
    if (error === '') copyFileSync(join(targetOf(REPO), 'debug', PHYSICS_BIN), bin);
    built = { bin, error };
  }
  expect(built.error, `${PHYSICS_BIN} builds (cargo ${BUILD_ARGS.join(' ')})`).toBe('');
  return built.bin;
}

/** The #182 suite's wrong program this port must reject (`deep-physics --planted <name>`): a controller that climbs
 * any slope under 45° whatever the body's `slope_limit`. */
export type Planted = 'slope_limit_ignored';

/** Runs `calls` through one `deep-physics [--planted p]` process (stopped by its own PID on timeout): exit 0, one JSON
 * reply per call, in order. */
export function physics(calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = planted ? ['--planted', planted] : [];
  const what = `${PHYSICS_BIN} ${args.join(' ')}`.trim();
  const run = spawnSync(physicsBin(), args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1024 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished in time`).toBe('');
  if (run.error && code !== 'EPIPE') throw Error(`${what}: ${run.error.message}`);
  expect(run.status, `${what} exits 0; stdout: ${(run.stdout ?? '').slice(0, 1000)}; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call; stdout: ${(run.stdout ?? '').slice(0, 1000)}`).toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i}`));
}

// ---------------------------------------------------------------------------------------------------
// The upstream test's world as our document (README: Upstream's world as ours).

/** Upstream's default step, 1/60 s (IntegrationParameters::default()). */
export const UPSTREAM_RATE = 60;
/** Upstream's world: 60 Hz, 4 solver iterations (our substeps), gravity (0, −9.81, 0) as it passes to its step, and a
 * collider's defaults (friction 0.5, density 1 kg/m³, restitution 0) as one contact material. */
export function upstreamWorld(parts: JsonObject): JsonObject {
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: UPSTREAM_RATE, substeps: 4, gravity: [0, -9.81, 0], seed: 182, mode: 'dynamic',
    capacity: { bodies: 16, shapes: 16, joints: 8, contacts: 64, particles: 0 },
    backend: { name: 'rapier3d', version: '=0.36.1' },
    contact_materials: { m: { friction: 0.5, restitution: 0, density: 1 } },
    ...parts,
  };
}
export const box = (half: Vec3): JsonObject => ({ kind: 'box', half });
export const capsule = (radius: number, half_height: number): JsonObject => ({ kind: 'capsule', radius, half_height });
export const use = (shape: string): JsonObject => ({ shape, contact_material: 'm' });
/** Upstream's `.rotation(Vector::Z * angle)`, `angle` in radians, as our quaternion [x, y, z, w]. */
export const aboutZ = (angle: number): number[] => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];

// ---------------------------------------------------------------------------------------------------
// A bake's character states.

/** One state of a character body: its pose's position, and `character.grounded` after that step's move (null at the
 * built state, index 0, which no move has reached). */
export interface Stepped { pos: Vec3; grounded: boolean | null }
/** An accepted bake's states of character body `id`, one per step from the built state at index 0. */
export function characterStates(reply: JsonObject, id: string, what: string): Stepped[] {
  expect(reply['ok'], `${what} is baked: ${show(reply)}`).toBe(true);
  return arr(obj(reply['bodies'], `${what}: bodies`)[id], `${what}: bodies.${id}`).map((v, k) => {
    const at = `${what}: bodies.${id}[${k}]`;
    const s = obj(v, at);
    const pos = arr(s['pos'], `${at}.pos`).map((x, i) => num(x, `${at}.pos[${i}]`)) as Vec3;
    if (k === 0) return { pos, grounded: null };
    const grounded = obj(s['character'], `${at}.character`)['grounded'];
    expect(typeof grounded, `${at}.character.grounded is true or false, got ${show(grounded)}`).toBe('boolean');
    return { pos, grounded: grounded as boolean };
  });
}
