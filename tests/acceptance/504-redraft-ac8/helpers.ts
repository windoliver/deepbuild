// Test-side tools for the blind redraft of #504 AC8: `deep-motion eval` (#391's JSON-lines CLI, with #493's camera
// poses, `project` and `shots` blocks), built once per file; the film the test sends; and the reference math its
// expected values come from (camera@1's pinhole, as the 493 README states it). Nothing here stands in for the code under
// test: every value a test compares comes from the binary, every expected value from the issue's and the design's text.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/504-redraft-ac8 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
export const MOTION_NAME = 'deep-motion';
/** rustup's cargo on the reference Mac (Homebrew's rustup keeps it off the default PATH). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
/** Every `it` passes this timeout: a first build of `deep-motion` on a loaded machine can take many minutes. */
export const TIMEOUT = 3_600_000;

/** The criterion's ID (scripts/proof-change.mjs `criterionId`: the first eight hex digits of the SHA-256 of its text). */
export const AC8 = '#504.a17a1463';

// ---------------------------------------------------------------------------------------------------
// Time

/** Flicks in one second (Time and the flick). */
export const FLICKS = 705_600_000;
/** One sample at 30 a second, in flicks (23,520,000: whole). */
export const F30 = FLICKS / 30;
/** The 30-a-second samples k·F30 with from ≤ k·F30 < to, both in seconds. */
export function samples30(from: number, to: number): number[] {
  const out: number[] = [];
  for (let k = Math.ceil((from * FLICKS) / F30); k * F30 < Math.round(to * FLICKS); k++) out.push(k * F30);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)}`).toBe(true);
  return value as number;
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A check that must fail on a planted program: at least one failure, and one holding each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the planted program passes the check it must fail`).toBeGreaterThan(0);
  for (const n of named) expect(failures.some((f) => f.includes(n)), `${what}: a failure says "${n}"; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// The build: `cargo build --locked --bin deep-motion` once per file, in beforeAll, the binary copied out under its own
// name; a test that uses a build that failed fails with cargo's error.

function cargo(args: string[]): string {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading/.test(l)).join('\n')}`;
}

export interface Built { bin: () => string }
export function useMotion(): Built {
  let dir = ''; let error = ''; let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-504-ac8-motion-'));
    error = cargo(['build', '--locked', '--bin', MOTION_NAME]);
    if (error === '') { bin = join(dir, MOTION_NAME); copyFileSync(join(TARGET, 'debug', exe(MOTION_NAME)), bin); }
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return { bin: () => { expect(error, `the binary builds: cargo build --locked --bin ${MOTION_NAME}`).toBe(''); return bin; } };
}

// ---------------------------------------------------------------------------------------------------
// deep-motion eval (README: The surface under test)

export interface EvalLine { doc: JsonObject; times: number[]; project: string[]; planted?: string }

/** `deep-motion eval` with one line in: it exits 0 with one JSON line out. */
export function evalOne(bin: string, line: EvalLine): JsonObject {
  const input: JsonObject = { doc: line.doc, times: line.times, project: line.project };
  if (line.planted !== undefined) input['planted'] = line.planted;
  const run = spawnSync(bin, ['eval'], { cwd: REPO, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, `${MOTION_NAME} eval finished within its timeout`).toBe(false);
  expect(run.error?.message ?? '', `${MOTION_NAME} eval ran`).toBe('');
  expect(run.status, `${MOTION_NAME} eval exits 0; stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const lines = (run.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${MOTION_NAME} eval: one output line for the one input line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { answer = lines[0]!; }
  return obj(answer, `${MOTION_NAME} eval: the answer`);
}

export interface Frame { t: number; cameras: JsonObject; projected: JsonObject }
export interface Accepted { frames: Frame[]; shots: JsonObject; raw: JsonObject }

/** An answer that accepted its document, with one frame per time, in order. */
function accepted(answer: JsonObject, times: readonly number[], what: string): Accepted {
  const frames = arr(answer['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    return { t: num(f['t'], `${what}: frames[${i}].t`), cameras: isObject(f['cameras']) ? f['cameras'] : {}, projected: isObject(f['projected']) ? f['projected'] : {} };
  });
  expect(frames.map((f) => f.t), `${what}: one frame per time, in the times' order`).toEqual([...times]);
  return { frames, shots: isObject(answer['shots']) ? answer['shots'] : {}, raw: answer };
}
export function evalOk(bin: string, line: EvalLine, what: string): Accepted {
  const answer = evalOne(bin, line);
  expect(answer['ok'], `${what} is accepted: ${show(answer)}`).toBe(true);
  return accepted(answer, line.times, what);
}
/** A planted program's frames: a name the binary doesn't know answers `bad_input`, and the test stops on it. */
export function evalPlanted(bin: string, line: EvalLine & { planted: string }, what: string): Accepted {
  const answer = evalOne(bin, line);
  expect(answer['ok'], `${what}: the planted program ${line.planted} answers with frames: ${show(answer)}`).toBe(true);
  return accepted(answer, line.times, what);
}

// ---------------------------------------------------------------------------------------------------
// What the tests read of an answer, and camera@1's reference math

export type V3 = [number, number, number];
function v3(value: JsonValue | undefined, what: string): V3 {
  const a = arr(value, what);
  expect(a.length, `${what} has three numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
}
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

/** The part of a Pose (the 493 README: Pose) the reference projection reads. */
export interface Pose { position: V3; target: V3; fov: number; roll: number }
export function poseOf(f: Frame, camera: string, what: string): Pose {
  const p = obj(f.cameras[camera], `${what}: cameras.${camera} at ${f.t} flicks`);
  return { position: v3(p['position'], `${what}: cameras.${camera}.position`), target: v3(p['target'], `${what}: cameras.${camera}.target`), fov: num(p['fov'], `${what}: cameras.${camera}.fov`), roll: num(p['roll'], `${what}: cameras.${camera}.roll`) };
}
/** A world point through a perspective pose with no roll, in px of a frame of `size` (camera@1: the field of view spans
 * the wider side; screen right is forward × +Y, screen up right × forward; px y runs down). */
export function projectPoint(pose: Pose, p: V3, size: [number, number]): [number, number] {
  const forward = unit(sub(pose.target, pose.position));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const v = sub(p, pose.position);
  const focal = Math.max(size[0], size[1]) / 2 / Math.tan((pose.fov * Math.PI) / 360);
  const s = focal / dot(v, forward);
  return [size[0] / 2 + dot(v, right) * s, size[1] / 2 - dot(v, up) * s];
}

/** An item's projection on a frame (the 493 README: `project`): its bounds' center and the box of their corners, in px. */
export interface Projection { center: [number, number]; box: [number, number, number, number] }
export function projOf(f: Frame, id: string, what: string): Projection {
  const p = obj(f.projected[id], `${what}: projected.${id} at ${f.t} flicks`);
  const c = arr(p['center'], `${what}: projected.${id}.center`); const b = arr(p['box'], `${what}: projected.${id}.box`);
  expect(c.length, `${what}: projected.${id}.center has two numbers`).toBe(2);
  expect(b.length, `${what}: projected.${id}.box has four numbers`).toBe(4);
  return { center: [num(c[0], 'x'), num(c[1], 'y')], box: [num(b[0], 'x0'), num(b[1], 'y0'), num(b[2], 'x1'), num(b[3], 'y1')] };
}
/** The safe frame of a document in px (Document envelope: `safe: f32, u = 24`; 1 u is 1 px at the document's size). */
export function safeFrame(doc: JsonObject): [number, number, number, number] {
  const size = doc['size'] as number[]; const safe = typeof doc['safe'] === 'number' ? doc['safe'] : 24;
  return [safe, safe, size[0]! - safe, size[1]! - safe];
}
/** A shot's union from the answer's `shots` block (the 493 README), as [lo, hi]. */
export function unionOf(a: Accepted, shot: string, what: string): [V3, V3] {
  const u = obj(obj(a.shots[shot], `${what}: shots.${shot}`)['union'], `${what}: shots.${shot}.union`);
  return [v3(u['lo'], `${what}: shots.${shot}.union.lo`), v3(u['hi'], `${what}: shots.${shot}.union.hi`)];
}

// ---------------------------------------------------------------------------------------------------
// Documents as the test writes them (README: The surface under test)

export const LAYER = 'main';
/** A perspective camera@1 (fov 40 across the wider side) orbiting its target. */
export function camera3d(id: string, orbit: { azimuth: number; elevation: number; distance: number }): JsonObject {
  return { id, kind: 'camera@1', layer: LAYER, name: `Camera ${id}`, order: `a0${id}`, params: { projection: 'perspective', target: [0, 0, 0], orbit, fov: 40 } };
}
/** A figure part: a 3D box (Marks in 3D: `mark.box {size: m}`, centred on its position) whose parent is an assembly. */
export function part(id: string, assembly: string, pos: V3, size: number | V3): JsonObject {
  return { id, kind: 'mark.box@1', layer: LAYER, name: `Part ${id}`, order: `b${id}`, role: 'part', parent: assembly, params: { size, paint: { fill: { role: 'accent' } } }, at: { pos } };
}
