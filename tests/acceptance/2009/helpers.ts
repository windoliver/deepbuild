// Test-side tools for the #2009 acceptance tests (README: The surface under test). They build and drive the physics
// module's runner `deep-physics` (JSON lines in, one reply per line), write the world documents the criteria name, and
// judge what the runner answers. Nothing here stands in for the physics module: every state, issue and checkpoint read
// here is the implementation's own; every expected value comes from the issue's text, computed here.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2009 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
export const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
/** Every test passes this timeout: a first build of Rapier, and the oracle lane's long runs, take many minutes. */
export const TIMEOUT = 3_600_000;
const MIB = 1024 * 1024;

/** A host or tool this machine lacks: the test fails with this message, never passes (invariant 2). */
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = { 1: '#2009.59ac371b', 2: '#2009.67d10d73', 3: '#2009.43ed60cb', 4: '#2009.e7924149' } as const;

/** The pinned backend (the issue's Scope and `backend.version: =0.36.1`). */
export const BACKEND = 'rapier3d';
export const PIN = '0.36.1';
export const G = 9.81;

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
export function vec(v: JsonValue | undefined, n: number, what: string): number[] {
  const a = arr(v, what);
  expect(a.length, `${what} has ${n} numbers`).toBe(n);
  return a.map((x, i) => num(x, `${what}[${i}]`));
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 30).join('\n  ')}`).toEqual([]);
}
/** A planted twin is caught: the judge that passes the real program finds something wrong with the twin's answer. */
export function caught(failures: readonly string[], what: string): void {
  expect(failures.length, `${what}: the planted twin is caught (the judge finds nothing wrong with its answer)`).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-physics`, once per test file, copied out of the target folder.

function cargoError(args: string[], env: NodeJS.ProcessEnv = {}): string {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * MIB, env: { ...process.env, ...CARGO_ENV, ...env } });
  if (run.error && (run.error as NodeJS.ErrnoException).code === 'ENOENT') blocked(`cargo isn't on this machine (looked on PATH and in ${RUSTUP_BIN})`);
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Checking|Documenting|Finished|Downloaded|Downloading|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
export { cargoError };

export const PHYSICS_BIN = 'deep-physics';
/** `deep-physics --planted <name>`: each one criterion's wrong program (README: Planted twins). */
export type Planted =
  | 'caps_allow_restitution_threshold' | 'caps_allow_rolling_resistance' | 'caps_allow_tangent_speed'
  | 'caps_allow_dynamic_gear' | 'restore_ignores_version';

let binDir = '';
let built: { bin: string; error: string } | undefined;
/** Builds deep-physics before a file's tests (the slow part); each test then reports its own build failure. */
export function prebuild(): void {
  beforeAll(() => { try { physicsBin(); } catch { /* each test reports it */ } }, TIMEOUT);
  afterAll(() => { if (binDir) rmSync(binDir, { recursive: true, force: true }); binDir = ''; built = undefined; });
}
export function physicsBin(): string {
  if (!built) {
    if (!binDir) binDir = mkdtempSync(join(tmpdir(), 'deep-2009-bin-'));
    const bin = join(binDir, PHYSICS_BIN);
    const error = cargoError(['build', '--locked', '--bin', PHYSICS_BIN]);
    if (error === '') copyFileSync(join(TARGET, 'debug', PHYSICS_BIN), bin);
    built = { bin, error };
  }
  expect(built.error, `${PHYSICS_BIN} builds (cargo build --locked --bin ${PHYSICS_BIN})`).toBe('');
  return built.bin;
}

/** Runs `calls` through one `deep-physics [--planted p]` process: exit 0, one JSON reply per call, in order. */
export function physics(calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = planted ? ['--planted', planted] : [];
  const what = `${PHYSICS_BIN} ${args.join(' ')}`.trim();
  const run = spawnSync(physicsBin(), args, { cwd: REPO, input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 4096 * MIB, timeout: TIMEOUT - 300_000, killSignal: 'SIGKILL' });
  const code = (run.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished in time`).toBe('');
  if (run.error && code !== 'EPIPE') throw Error(`${what}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(run.status, `${what} exits 0; stdout: ${stdout.slice(0, 1000)}; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${what}: one reply per call`).toBe(calls.length);
  return lines.map((l, i) => obj(JSON.parse(l) as JsonValue, `${what}: reply ${i} (to ${show(calls[i]).slice(0, 120)})`));
}
export const one = (call: JsonObject, planted?: Planted): JsonObject => physics([call], planted)[0]!;

// ---------------------------------------------------------------------------------------------------
// World documents (README: The world document). Fields are the issue's; the layout of the maps is this suite's.

export type Vec3 = [number, number, number];
export interface WorldParts { [field: string]: JsonValue }
/** A physics.world@1 document: the issue's defaults spelled where a test leans on them, `parts` over the rest. */
export function world(parts: WorldParts): JsonObject {
  return {
    kind: 'physics.world@1',
    dimensions: 3,
    step_rate: 120,
    substeps: 4,
    gravity: [0, -G, 0],
    seed: 2009,
    mode: 'dynamic',
    capacity: { bodies: 64, shapes: 64, joints: 64, contacts: 256, particles: 0 },
    backend: { name: BACKEND, version: `=${PIN}` },
    ...parts,
  };
}
export const sphere = (radius: number): JsonObject => ({ kind: 'sphere', radius });
export const box = (half: Vec3): JsonObject => ({ kind: 'box', half });
/** A static floor body whose top face is y = 0. */
export const floor = (material: string, half: Vec3 = [30, 0.1, 30]): JsonObject =>
  ({ kind: 'static', shapes: [{ shape: 'floor', contact_material: material }], pose: { pos: [0, -half[1], 0] } });
export const dynamic = (shape: string, material: string, pos: Vec3, extra: JsonObject = {}): JsonObject =>
  ({ kind: 'dynamic', shapes: [{ shape, contact_material: material }], pose: { pos }, ...extra });

export const check = (w: JsonObject): JsonObject => ({ call: 'check', world: w });
export const bake = (w: JsonObject, steps: number, extra: JsonObject = {}): JsonObject => ({ call: 'bake', world: w, steps, ...extra });

// ---------------------------------------------------------------------------------------------------
// Reading a bake

export interface State { pos: Vec3; rot: number[]; linear: Vec3; angular: Vec3; contactImpulse: number | null }
function state(v: JsonValue | undefined, what: string): State {
  const s = obj(v, what);
  const ci = s['contact_impulse'];
  return {
    pos: vec(s['pos'], 3, `${what}.pos`) as Vec3,
    rot: vec(s['rot'], 4, `${what}.rot`),
    linear: vec(s['linear'], 3, `${what}.linear`) as Vec3,
    angular: vec(s['angular'], 3, `${what}.angular`) as Vec3,
    contactImpulse: ci === undefined ? null : num(ci, `${what}.contact_impulse`),
  };
}
/** An accepted bake's states of body `id`: index j is the state after j × `every` steps, from the built state at 0. */
export function statesOf(reply: JsonObject, id: string, count: number, what: string): State[] {
  expect(reply['ok'], `${what} is baked: ${show(reply)}`).toBe(true);
  const series = arr(obj(reply['bodies'], `${what}: bodies`)[id], `${what}: bodies.${id}`);
  expect(series.length, `${what}: bodies.${id} holds ${count} states (the built state, then one per sample)`).toBe(count);
  return series.map((v, j) => state(v, `${what}: bodies.${id}[${j}]`));
}
export const speed = (v: readonly number[]): number => Math.hypot(...v);
export const RAD = Math.PI / 180;

// ---------------------------------------------------------------------------------------------------
// Judging a check's issues (canvas primitives: What holds a document to its rules)

export function issuesOf(reply: JsonObject, what: string): JsonObject[] {
  expect(reply['ok'], `${what}: the check ran: ${show(reply)}`).toBe(true);
  return arr(reply['issues'], `${what}: issues`).map((v, i) => obj(v, `${what}: issues[${i}]`));
}
const errors = (issues: JsonObject[]): JsonObject[] => issues.filter((i) => i['severity'] === 'error');
/** The path's field names, whatever its separator or prefix (`solver/restitution_threshold`, `/solver/…`, `a.b`). */
const segments = (path: JsonValue | undefined): string[] => (typeof path === 'string' ? path.split(/[/.]/).filter((s) => s !== '') : []);
const endsWith = (path: string[], tail: readonly string[]): boolean => path.length >= tail.length && tail.every((s, i) => path[path.length - tail.length + i] === s);

export interface Want { field: readonly string[]; actual: JsonValue; id?: string }
/**
 * A refusal at check naming the field and the backend (README: Refusals): an error issue whose `path` ends with the
 * field's path, whose `actual` is the refused value, whose `what` names `rapier3d` and, for a joint, whose `ids` name it.
 */
export function refusalFailures(issues: JsonObject[], want: Want): string[] {
  const named = errors(issues).filter((i) => endsWith(segments(i['path']), want.field));
  if (named.length === 0) return [`no error issue names the field ${want.field.join('/')} (issues: ${show(issues)})`];
  const good = named.filter((i) => JSON.stringify(i['actual']) === JSON.stringify(want.actual)
    && typeof i['what'] === 'string' && i['what'].includes(BACKEND)
    && (want.id === undefined || (Array.isArray(i['ids']) && i['ids'].includes(want.id))));
  return good.length ? [] : [`the issue at ${want.field.join('/')} doesn't hold actual ${show(want.actual)}, a \`what\` naming ${BACKEND}${want.id ? ` and ids naming ${want.id}` : ''}: ${show(named)}`];
}
/** Admitted: the check ran and raised no error. */
export function admittedFailures(issues: JsonObject[]): string[] {
  return errors(issues).map((i) => `error issue ${show(i)}`);
}
