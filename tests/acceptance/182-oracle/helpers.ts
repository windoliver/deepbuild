// Test-side tools for the #182 Oracle lane (README): the physics runner `deep-physics` built as shipped and with the
// #182 suite's test backends, asked the same calls on the same surface as `tests/acceptance/182/` (README there: The
// surface under test), with upstream's worlds written as our physics.world@1 documents. Nothing here stands in for the
// character body or its controller: every state and row read here is the implementation's own.

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
export const REPO = join(HERE, '..', '..', '..');
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
export const TIMEOUT = 3_600_000;
const BUILD_TIMEOUT = 4 * TIMEOUT;
const MIB = 1024 * 1024;
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}; this is not a pass`); };

/** The #182 criteria IDs (scripts/proof-change.mjs) the upstream tests are linked to. */
export const AC = {
  1: '#182.78fd65bc', 2: '#182.d146e624', 3: '#182.11a4f4a4', 6: '#182.e8a0f46c', 8: '#182.a3e169f2', 10: '#182.ca0e2323', 12: '#182.e7c14b4e',
} as const;

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
const vec3 = (v: JsonValue | undefined, what: string): Vec3 => arr(v, what).map((x, i) => {
  expect(typeof x === 'number', `${what}[${i}] is a number`).toBe(true);
  return x as number;
}) as Vec3;
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
export function caught(failures: readonly string[], what: string): void {
  expect(failures.length, `${what}: the wrong program is caught (upstream's assertions find nothing wrong with it)`).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------------------------------
// The builds.

type Build = 'shipped' | 'test';
const ARGS: Record<Build, string[]> = {
  shipped: ['build', '--locked', '-p', 'deep-physics-rapier', '--bin', 'deep-physics'],
  test: ['build', '--locked', '-p', 'deep-physics-rapier', '--bin', 'deep-physics', '--features', 'test-backends'],
};
let binDir = '';
const built = new Map<Build, { bin: string; error: string }>();
function cargo(args: string[]): string {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV } });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ENOENT') blocked(`cargo isn't on this machine (looked on PATH and in ${RUSTUP_BIN})`);
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
function binOf(b: Build, judge = true): string {
  let entry = built.get(b);
  if (!entry) {
    if (!binDir) binDir = mkdtempSync(join(tmpdir(), 'deep-182-oracle-bin-'));
    const bin = join(binDir, `deep-physics-${b}`);
    const error = cargo(ARGS[b]);
    if (error === '') copyFileSync(join(TARGET, 'debug', 'deep-physics'), bin);
    entry = { bin, error };
    built.set(b, entry);
  }
  if (judge) expect(entry.error, `${b} builds (cargo ${ARGS[b].join(' ')})`).toBe('');
  return entry.bin;
}
export function prebuild(builds: Build[]): void {
  beforeAll(() => { for (const b of builds) { try { binOf(b, false); } catch { /* each test reports it */ } } }, BUILD_TIMEOUT * builds.length);
  afterAll(() => { if (binDir) rmSync(binDir, { recursive: true, force: true }); binDir = ''; built.clear(); });
}

/** The #182 suite's wrong programs this lane runs (its README: The surface under test). */
export interface Runner { backend?: 'ground_distance_1mm'; planted?: 'slope_limit_ignored' | 'character_as_kinematic' }
export function physics(calls: JsonObject[], r: Runner = {}): JsonObject[] {
  const args = [...(r.backend ? ['--backend', r.backend] : []), ...(r.planted ? ['--planted', r.planted] : [])];
  const what = `deep-physics ${args.join(' ')}`.trim();
  const run = spawnSync(binOf(r.backend ? 'test' : 'shipped'), args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 4096 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished in time`).toBe('');
  if (run.error && code !== 'EPIPE') throw Error(`${what}: ${run.error.message}`);
  expect(run.status, `${what} exits 0; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call`).toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i}`));
}

// ---------------------------------------------------------------------------------------------------
// Upstream's worlds as ours: the engine's default step of 1/60 s (`step_rate: 60`), 4 substeps, gravity (0, −9.81, 0)
// unless upstream sets it to zero; a cuboid of half extents h is a box of `half` h; a ball character of radius r is our
// one capsule of radius r and half height 0.001 m (our character holds one capsule); a fixed body is `static`.

export const BALL_HALF_HEIGHT = 0.001;
export interface Part { half: Vec3; pos: Vec3; rotZ?: number }
/** A world of static cuboids `statics`, `movers` (character or dynamic bodies, as written) and their extra shapes. */
export function upstreamWorld(o: { statics: Record<string, Part>; movers: Record<string, JsonObject>; shapes?: JsonObject; gravity?: Vec3; inputs: JsonObject; density?: number }): JsonObject {
  const shapes: JsonObject = { ...(o.shapes ?? {}) };
  const bodies: JsonObject = {};
  for (const [id, p] of Object.entries(o.statics)) {
    shapes[id] = { kind: 'box', half: p.half };
    const rot = p.rotZ === undefined ? {} : { rot: [0, 0, Math.sin(p.rotZ / 2), Math.cos(p.rotZ / 2)] };
    bodies[id] = { kind: 'static', shapes: [{ shape: id, contact_material: 'm' }], pose: { pos: p.pos, ...rot } };
  }
  Object.assign(bodies, o.movers);
  return {
    kind: 'physics.world@1', dimensions: 3, step_rate: 60, substeps: 4, gravity: o.gravity ?? [0, -9.81, 0], seed: 182, mode: 'dynamic',
    capacity: { bodies: 16, shapes: 16, joints: 0, contacts: 256, particles: 0 }, backend: { name: 'rapier3d', version: '=0.36.1' },
    contact_materials: { m: { friction: 0.5, restitution: 0, density: o.density ?? 1 } }, shapes, bodies, inputs: o.inputs,
  };
}
/** A ball character of radius `r` (our capsule) at `pos`, with its `character` fields. */
export const ballCharacter = (shape: string, pos: Vec3, character: JsonObject = {}): JsonObject =>
  ({ kind: 'character', shapes: [{ shape, contact_material: 'm' }], pose: { pos }, character });
export const capsule = (r: number): JsonObject => ({ kind: 'capsule', half_height: BALL_HALF_HEIGHT, radius: r });
/** A move input for each character. */
export const moves = (ids: string[]): JsonObject => ({ walk: { kind: 'move', targets: ids } });
export const walk = (id: string, step: number, v: Vec3): JsonObject => ({ step, kind: 'move', target: id, data: { velocity: v } });
export const rad = (r: number): number => (r * 180) / Math.PI;

export interface State { pos: Vec3; linear: Vec3; grounded: boolean | null }
export function statesOf(reply: JsonObject, id: string, what: string): State[] {
  expect(reply['ok'], `${what} ran: ${show(reply)}`).toBe(true);
  return arr(obj(reply['bodies'], `${what}: bodies`)[id], `${what}: bodies.${id}`).map((v, j) => {
    const s = obj(v, `${what}: bodies.${id}[${j}]`);
    const c = s['character'];
    const grounded = isObject(c) && typeof c['grounded'] === 'boolean' ? c['grounded'] : null;
    return { pos: vec3(s['pos'], `${what}: ${id}[${j}].pos`), linear: vec3(s['linear'], `${what}: ${id}[${j}].linear`), grounded };
  });
}
export interface Row { step: number; kind: string; a: string; b: string | null }
export function rowsOf(reply: JsonObject, what: string): Row[] {
  return arr(reply['occurrences'], `${what}: occurrences`).map((v, i) => {
    const o = obj(v, `${what}: occurrences[${i}]`);
    return { step: Number(o['step']), kind: String(o['kind']), a: String(o['a']), b: o['b'] === null || o['b'] === undefined ? null : String(o['b']) };
  });
}
export const touched = (rows: Row[], x: string, y: string): Row[] =>
  rows.filter((r) => r.kind === 'contact_begin' && ((r.a === x && r.b === y) || (r.a === y && r.b === x)));
