// Test-side tools for the #493 acceptance tests: `deep-motion eval` (#391's JSON-lines CLI, as #417, #489, #490, #491
// and #492 extended it, with this suite's camera poses, projections and shots) and `deep-show run` (#393's scenarios,
// with #387's `eval`, #490's `fn`, #305's build sets and this suite's `film` block), each built once per file; the
// documents the tests send (films with cameras, shots and transitions); the pictures (PNG from the evidence store);
// and the reference math the expected values come from. Nothing here stands in for the camera: every value a test
// compares comes from a binary, every expected value from the issue's text computed here.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/493 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const FIXTURES = join(HERE, 'fixtures');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
export const MOTION_NAME = 'deep-motion';
export const SHOW_NAME = 'deep-show';
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes this timeout: a first build of `deep-show` can take many minutes. */
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #493.0b1b1a95',
  2: 'AC2 #493.872906a8',
  3: 'AC3 #493.f2d3692f',
  4: 'AC4 #493.07d4fcd4',
  5: 'AC5 #493.d8794d67',
  6: 'AC6 #493.7831f8ec',
  7: 'AC7 #493.5bfe22ba',
  8: 'AC8 #493.55016885',
  9: 'AC9 #493.b76c663b',
  10: 'AC10 #493.0704e790',
  11: 'AC11 #493.219170de',
  12: 'AC12 #493.c0595506',
  13: 'AC13 #493.d82a99aa',
  14: 'AC14 #493.e7031693',
  15: 'AC15 #493.44160e6c',
  16: 'AC16 #493.54b680f8',
  17: 'AC17 #493.f3a08e63',
  18: 'AC18 #493.e1213b8a',
  19: 'AC19 #493.55c15e8b',
  20: 'AC20 #493.b09e45f7',
} as const;

// ---------------------------------------------------------------------------------------------------
// Time

/** Flicks in one second (Time and the flick). */
export const FLICKS = 705_600_000;
/** One frame at 60 fps, in flicks. */
export const F60 = FLICKS / 60;
/** Seconds to whole flicks (exact for the decimal seconds the tests write). */
export const fl = (s: number): number => Math.round(s * FLICKS);
/** Flicks to seconds in f64. */
export const secs = (flicks: number): number => flicks / FLICKS;
/** A time field as the time grammar's text, `"<s>s"`. */
export const at = (s: number): string => `${s}s`;
/** The 60 fps frames k·Δ with from ≤ k·Δ < to, both in seconds. */
export function frames60(from: number, to: number): number[] {
  const out: number[] = [];
  for (let k = Math.ceil(fl(from) / F60); k * F60 < fl(to); k++) out.push(k * F60);
  return out;
}
/** Times every rate in 24, 60 and 144 fps has a frame on: multiples of 1/12 s in [from, to). */
export function commonFrames(from: number, to: number): number[] {
  const step = FLICKS / 12; const out: number[] = [];
  for (let k = Math.ceil(fl(from) / step); k * step < fl(to); k++) out.push(k * step);
  return out;
}
/** A seeded generator (mulberry32), so a failing run replays: the same seed gives the same times. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** `n` distinct seeded whole-flick times in [from, to), ascending. */
export function seededTimes(seed: number, n: number, from: number, to: number): number[] {
  const rand = seeded(seed);
  const set = new Set<number>();
  while (set.size < n) set.add(from + Math.floor(rand() * (to - from)));
  return [...set].sort((a, b) => a - b);
}
/** The same list in a seeded order. */
export function shuffled<T>(list: readonly T[], seed: number): T[] {
  const rand = seeded(seed); const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
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
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)}`).toBe('string');
  return value as string;
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
/** Whether a value's JSON text holds `needle` (an ID, a name). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A check that must fail on a planted program: at least one failure, and one naming each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the planted program passes the check it must fail`).toBeGreaterThan(0);
  for (const n of named) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}
/** Relative difference, |a − b| ÷ |b|. */
export const rel = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds its binaries once, in beforeAll, copied out under their own names; a test that uses a
// build that failed fails with cargo's error.

function cargo(args: string[]): string {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading/.test(l)).join('\n')}`;
}

export interface Built { bin: () => string }
/** `cargo build --locked --bin deep-motion`, once per file. */
export function useMotion(): Built {
  let dir = ''; let error = ''; let bin = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-493-motion-'));
    error = cargo(['build', '--locked', '--bin', MOTION_NAME]);
    if (error === '') { bin = join(dir, MOTION_NAME); copyFileSync(join(TARGET, 'debug', exe(MOTION_NAME)), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return { bin: () => { expect(error, `the binary builds: cargo build --locked --bin ${MOTION_NAME}`).toBe(''); return bin; } };
}

export interface ShowBuilds { bin: (features: string) => string }
/** `cargo build --locked --bin deep-show --no-default-features --features <set>` for each listed set, once per file. */
export function useShow(featureSets: readonly string[]): ShowBuilds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-493-show-'));
    for (const features of featureSets) {
      const error = cargo(['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', features]);
      const bin = join(dir, `${SHOW_NAME}-${features.replace(/[^a-z0-9+.-]/g, '_')}`);
      if (error === '') copyFileSync(join(TARGET, 'debug', exe(SHOW_NAME)), bin);
      made.set(features, { bin, error });
    }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return {
    bin(features: string): string {
      const entry = made.get(features);
      if (!entry) throw Error(`the file didn't list the feature set ${features} in useShow`);
      expect(entry.error, `the binary builds: ${SHOW_NAME} --no-default-features --features ${features}`).toBe('');
      return entry.bin;
    },
  };
}

interface Started { timedOut: boolean; error: string; status: number | null; stdout: string; stderr: string; lines: JsonValue[] }
function start(bin: string, args: string[], text: string): Started {
  const run = spawnSync(bin, args, { cwd: REPO, input: text, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l): JsonValue => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { timedOut, error: run.error?.message ?? '', status: run.status, stdout, stderr: (run.stderr ?? '').slice(-1500), lines };
}

// ---------------------------------------------------------------------------------------------------
// deep-motion eval (README: The surface under test)

export interface EvalLine { doc: JsonObject; times: number[]; planted?: string; look?: JsonValue; view?: JsonObject; project?: string[] }
const lineOf = (l: EvalLine): JsonObject => {
  const out: JsonObject = { doc: l.doc, times: l.times };
  if (l.planted !== undefined) out['planted'] = l.planted;
  if (l.look !== undefined) out['look'] = l.look;
  if (l.view !== undefined) out['view'] = l.view;
  if (l.project !== undefined) out['project'] = l.project;
  return out;
};

/** `deep-motion eval`, one answer per line, in order; the run exits 0 with one line out per line in. */
export function evalAll(bin: string, lines: EvalLine[]): JsonObject[] {
  const r = start(bin, ['eval'], `${lines.map((l) => JSON.stringify(lineOf(l))).join('\n')}\n`);
  expect(r.timedOut, `${MOTION_NAME} eval finished within its timeout`).toBe(false);
  expect(r.error, `${MOTION_NAME} eval ran`).toBe('');
  expect(r.status, `${MOTION_NAME} eval exits 0; stderr: ${r.stderr}`).toBe(0);
  expect(r.lines.length, `${MOTION_NAME} eval: one output line per input line`).toBe(lines.length);
  return r.lines.map((l, i) => obj(l, `${MOTION_NAME} eval: answer ${i}`));
}
export const evalOne = (bin: string, line: EvalLine): JsonObject => evalAll(bin, [line])[0]!;

export interface Frame { t: number; items: JsonObject; cameras: JsonObject; projected: JsonObject; raw: JsonObject }
export interface Accepted { frames: Frame[]; shots: JsonObject; raw: JsonObject }

/** An answer that accepted its document, with one frame per time, in order. */
export function accepted(answer: JsonObject, times: readonly number[], what: string): Accepted {
  expect(answer['ok'], `${what} is accepted: ${show(answer)}`).toBe(true);
  const frames = arr(answer['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    return {
      t: num(f['t'], `${what}: frames[${i}].t`), raw: f,
      items: isObject(f['items']) ? f['items'] : {}, cameras: isObject(f['cameras']) ? f['cameras'] : {}, projected: isObject(f['projected']) ? f['projected'] : {},
    };
  });
  expect(frames.map((f) => f.t), `${what}: one frame per time, in the times' order`).toEqual([...times]);
  return { frames, shots: isObject(answer['shots']) ? answer['shots'] : {}, raw: answer };
}
export function evalOk(bin: string, line: EvalLine, what: string): Accepted {
  return accepted(evalOne(bin, line), line.times, what);
}
/** A refused document: `{ok: false, …}`, its whole JSON. */
export function refused(answer: JsonObject, what: string): JsonObject {
  expect(answer['ok'], `${what} is refused: ${show(answer)}`).toBe(false);
  return answer;
}
/** A planted program's frames: a name the binary doesn't know answers `bad_input`, and the test stops on it. */
export function evalPlanted(bin: string, line: EvalLine & { planted: string }, what: string): Accepted {
  const answer = evalOne(bin, line);
  expect(answer['ok'], `${what}: the planted program ${line.planted} answers with frames: ${show(answer)}`).toBe(true);
  return accepted(answer, line.times, what);
}

// ---------------------------------------------------------------------------------------------------
// The camera's pose (README: Pose) and what the tests derive from it

export type V3 = [number, number, number];
export interface Pose { position: V3; target: V3; azimuth: number; elevation: number; distance: number; fov: number; view_width: number; roll: number; shot: string | null; raw: JsonObject }
function v3(value: JsonValue | undefined, what: string): V3 {
  const a = arr(value, what);
  expect(a.length, `${what} has three numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
}
/** A Pose object as the surface writes it (`cameras.<id>`, `shots.<id>.framed`, `film.cameras.<id>`). */
export function poseFrom(value: JsonValue | undefined, what: string): Pose {
  const p = obj(value, what);
  const shot = p['shot'];
  return {
    position: v3(p['position'], `${what}.position`), target: v3(p['target'], `${what}.target`), azimuth: num(p['azimuth'], `${what}.azimuth`),
    elevation: num(p['elevation'], `${what}.elevation`), distance: num(p['distance'], `${what}.distance`), fov: num(p['fov'], `${what}.fov`),
    view_width: num(p['view_width'], `${what}.view_width`), roll: num(p['roll'], `${what}.roll`), shot: typeof shot === 'string' ? shot : null, raw: p,
  };
}
/** A frame's evaluated pose of one camera. */
export const poseOf = (f: Frame, camera: string, what: string): Pose => poseFrom(f.cameras[camera], `${what}: cameras.${camera} at ${f.t} flicks`);
/** An item's evaluated position, `items.<id>.at.pos`. */
export const itemPos = (f: Frame, id: string, what: string): V3 => v3(obj(obj(f.items[id], `${what}: items.${id}`)['at'], `${what}: items.${id}.at`)['pos'], `${what}: items.${id}.at.pos`);
/** A shot's framed pose from the answer's `shots` block. */
export function framedOf(a: Accepted, shot: string, what: string): Pose {
  return poseFrom(obj(a.shots[shot], `${what}: shots.${shot}`)['framed'], `${what}: shots.${shot}.framed`);
}
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => scale(a, 1 / norm(a));
export const deg = (r: number): number => (r * 180) / Math.PI;
export const rad = (d: number): number => (d * Math.PI) / 180;
/** An angle in (−180, 180]. */
export const wrap = (d: number): number => { const w = ((d % 360) + 360) % 360; return w > 180 ? w - 360 : w; };
/** The aim, target − position. */
export const aim = (p: Pose): V3 => sub(p.target, p.position);
/** The aim's heading in degrees, 0 looking down −Z, positive turning right (toward +X), as a pan at angle 0 turns. */
export const aimYaw = (p: Pose): number => { const d = aim(p); return deg(Math.atan2(d[0], -d[2])); };
/** The aim's pitch in degrees, positive up. */
export const aimPitch = (p: Pose): number => { const d = aim(p); return deg(Math.asin(d[1] / norm(d))); };
/** The eye's azimuth about the target in degrees (Camera camera@1: azimuth 0 puts the eye on +Z of the target). */
export const eyeAzimuth = (p: Pose): number => { const d = sub(p.position, p.target); return deg(Math.atan2(d[0], d[2])); };
/** The angle between two poses' aims, degrees. */
export const aimAngle = (a: Pose, b: Pose): number => deg(Math.acos(Math.min(1, Math.max(-1, dot(unit(aim(a)), unit(aim(b)))))));
export const maxDiff = (a: V3, b: V3): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** An item's projection on a frame (README: `project`): the bounds' center and the box of its corners, in px. */
export interface Projection { center: [number, number]; box: [number, number, number, number] }
export function projOf(f: Frame, id: string, what: string): Projection {
  const p = obj(f.projected[id], `${what}: projected.${id} at ${f.t} flicks`);
  const c = arr(p['center'], `${what}: projected.${id}.center`); const b = arr(p['box'], `${what}: projected.${id}.box`);
  expect(c.length, `${what}: projected.${id}.center has two numbers`).toBe(2);
  expect(b.length, `${what}: projected.${id}.box has four numbers`).toBe(4);
  return { center: [num(c[0], 'x'), num(c[1], 'y')], box: [num(b[0], 'x0'), num(b[1], 'y0'), num(b[2], 'x1'), num(b[3], 'y1')] };
}
export const heightOf = (p: Projection): number => p.box[3] - p.box[1];
/** The safe frame of a document in px (Document envelope: `safe: f32, u = 24`; 1 u is 1 px at the document's size). */
export function safeFrame(doc: JsonObject): [number, number, number, number] {
  const size = doc['size'] as number[]; const safe = typeof doc['safe'] === 'number' ? doc['safe'] : 24;
  return [safe, safe, size[0]! - safe, size[1]! - safe];
}

// ---------------------------------------------------------------------------------------------------
// Documents as the tests write them (README: Documents)

export const LAYER = 'main';
export const LAYERS: JsonObject = { [LAYER]: { writer: 'agent-a', title: 'Main', order: 'a0' } };
/** A film: size 1920 × 1080 unless given, its camera `cam`. */
export function film(id: string, items: JsonObject[], extra: JsonObject = {}, transport: JsonObject = { span: '4s' }, size: [number, number] = [1920, 1080]): JsonObject {
  return {
    format: 1, id, profile: 'film', title: `#493 ${id}`, description: `The #493 acceptance tests' film ${id}.`, size, camera: 'cam', layers: LAYERS,
    transport, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
/** A perspective camera@1 (fov 40 across the wider side), orbiting its target at the design's default angles. */
export function camera3d(params: JsonObject = {}, id = 'cam'): JsonObject {
  return { id, kind: 'camera@1', layer: LAYER, name: `Camera ${id}`, order: `a0${id}`, params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 45, elevation: 30, distance: 10 }, fov: 40, ...params } };
}
/** A 2D (orthographic) camera@1 over a page of `size` u, y down. */
export function camera2d(size: [number, number], params: JsonObject = {}, id = 'cam'): JsonObject {
  return { id, kind: 'camera@1', layer: LAYER, name: `Camera ${id}`, order: `a0${id}`, params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0], ...params } };
}
/** A 3D box (Marks in 3D: `mark.box {size: m}`), centred on its position. */
export function box3d(id: string, pos: V3, size: number | V3, role = 'accent'): JsonObject {
  return { id, kind: 'mark.box@1', layer: LAYER, name: `Box ${id}`, order: `b${id}`, params: { size, paint: { fill: { role } } }, at: { pos } };
}
/** A 2D rectangle: `box` [x, y, w, h] in u from its position. */
export function rect(id: string, box: [number, number, number, number], role = 'ink', extra: JsonObject = {}): JsonObject {
  return { id, kind: 'rect@1', layer: LAYER, name: `Rect ${id}`, order: `c${id}`, params: { box, paint: { fill: { role } } }, at: { pos: [0, 0, 0] }, ...extra };
}
/** A shot (Shot): `[start, end)` in seconds on camera `cam`, with the rest of its fields. */
export function shot(start: number, end: number, fields: JsonObject = {}): JsonObject {
  return { start: at(start), end: at(end), camera: 'cam', move: 'hold', ...fields };
}
export type KeyList = [seconds: number, value: JsonValue, interp?: JsonValue][];
/** A channel's keys, IDs in time order; a key with no interp of its own is linear. */
export function channel(target: string, list: KeyList, type = 'f32'): JsonObject {
  return { target, type, keys: Object.fromEntries(list.map(([t, value, interp], i) => [`k${String(i).padStart(2, '0')}`, { t: at(t), value, interp: interp ?? 'linear' }])) };
}
/** A document at another frame rate (Transport: `frame_rate`), as a rational's text. */
export function atRate(doc: JsonObject, fps: number): JsonObject {
  const out = clone(doc); out['transport'] = { ...(isObject(out['transport']) ? out['transport'] : {}), frame_rate: `${fps}/1` }; return out;
}

// ---------------------------------------------------------------------------------------------------
// deep-show run (README: The surface under test: deep-show)

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-493-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** Documents the hub has minted. */
export const DOC = { a: ulid('01JB493D', 1), b: ulid('01JB493D', 2), c: ulid('01JB493D', 3), d: ulid('01JB493D', 4) } as const;
/** `deep show` from your shell writes as you. */
const YOU_PEER: JsonObject = { pid: 3002, start: 3_000 };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
];
/** A scenario: the evidence store, your shell's process tree, one panel, the documents, and a record when given. */
export function scenario(evidence: string, calls: JsonObject[], record?: JsonObject): JsonObject {
  const docs: JsonObject = {};
  for (const id of Object.values(DOC)) docs[id] = { panel: 'main' };
  return { evidence, sessions: {}, processes: PROCESSES, panels: { main: { rect: [0, 0, 1920, 1080] } }, docs, ...(record ? { record } : {}), calls };
}
export interface ShowRun { status: number | null; stdout: string; lines: JsonValue[] }
export function runRaw(bin: string, sc: JsonObject): ShowRun {
  const s = start(bin, ['run'], `${JSON.stringify(sc)}\n`);
  expect(s.timedOut, `${SHOW_NAME} run finished within its timeout`).toBe(false);
  return { status: s.status, stdout: s.stdout, lines: s.lines };
}
/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function runShow(bin: string, sc: JsonObject): JsonObject[] {
  const s = start(bin, ['run'], `${JSON.stringify(sc)}\n`);
  expect(s.timedOut, `${SHOW_NAME} run finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} run exits 0; stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr}`).toBe(0);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${show(out)}`).toBe(true);
  return arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
}
/** `deep show` of a whole document from your shell, with its issues. The hub stamps the writer layer from the
 * connection, so the payload carries no `layers` and no item `layer` (Writer layer: "never in a payload"). */
export function present(doc: string, document: JsonObject): JsonObject {
  const payload = clone(document);
  delete payload['layers'];
  for (const item of Object.values(isObject(payload['items']) ? payload['items'] : {})) if (isObject(item)) delete item['layer'];
  return { call: 'deep show', peer: YOU_PEER, doc, document: payload, include: ['issues'] };
}
export function presented(reply: JsonObject, what: string): void {
  expect(reply['outcome'], `${what} is presented: ${show(reply)}`).toBe('presented');
}
/** #387's `eval` call at a flick: `pixels` draws the canonical snapshot, `film` asks for this suite's film block. */
export function evalCall(doc: string, t: number, opts: { pixels?: boolean; film?: boolean; reducedMotion?: boolean } = {}): JsonObject {
  return {
    call: 'eval', doc, t, ...(opts.pixels ? { pixels: true } : {}), ...(opts.film ? { film: true } : {}),
    ...(opts.reducedMotion !== undefined ? { view: { reduced_motion: opts.reducedMotion } } : {}),
  };
}
export function evaluated(reply: JsonObject, what: string): JsonObject {
  expect(reply['outcome'], `${what} is evaluated: ${show(reply)}`).toBe('evaluated');
  return reply;
}
/** The film block of an `eval` reply (README: `film`). */
export interface Film { cameras: JsonObject; dissolve: JsonValue; parallax: JsonObject; glyphs: JsonObject; raw: JsonObject }
export function filmOf(reply: JsonObject, what: string): Film {
  const f = obj(evaluated(reply, what)['film'], `${what}: film`);
  return { cameras: obj(f['cameras'], `${what}: film.cameras`), dissolve: f['dissolve'] ?? null, parallax: isObject(f['parallax']) ? f['parallax'] : {}, glyphs: isObject(f['glyphs']) ? f['glyphs'] : {}, raw: f };
}
/** A snapshot of an `eval` reply: its SHA-256 in the evidence store and its status marks. */
export interface Snapshot { sha256: string; w: number; h: number; marks: JsonObject[] }
export function snapshotOf(reply: JsonObject, what: string): Snapshot {
  const list = arr(evaluated(reply, what)['snapshots'], `${what}: snapshots`);
  expect(list.length, `${what}: one snapshot`).toBe(1);
  const s = obj(list[0], `${what}: snapshots[0]`);
  return { sha256: str(s['sha256'], `${what}: sha256`), w: num(s['w'], 'w'), h: num(s['h'], 'h'), marks: (Array.isArray(s['marks']) ? s['marks'] : []).filter(isObject) };
}

// ---- the evidence store and PNG

export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
const stored = (evidence: string, sha: string): string => join(evidence, sha.slice(0, 2), sha.slice(2));
/** Puts bytes into the scenario's evidence store at their SHA-256, as the hub keeps them (#1162's way). */
export function putStore(evidence: string, bytes: Buffer): string {
  const sha = sha256(bytes);
  mkdirSync(join(evidence, sha.slice(0, 2)), { recursive: true });
  writeFileSync(stored(evidence, sha), bytes);
  return sha;
}
export interface Image { width: number; height: number; rgba: Uint8Array }
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
/** Reads an 8-bit RGB or RGBA PNG with no interlace (#421's reader). */
export function decodePng(file: Buffer): Image {
  if (!file.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('not a PNG');
  let p = 8; let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
  const data: Buffer[] = [];
  while (p < file.length) {
    const len = file.readUInt32BE(p); const type = file.toString('latin1', p + 4, p + 8); const body = file.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]!; color = body[9]!; interlace = body[12]!; }
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw Error(`PNG is depth ${depth}, color type ${color}, interlace ${interlace}`);
  const channels = color === 6 ? 4 : 3; const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; const b = previous[i]!; const c = i >= channels ? previous[i - channels]! : 0; const x = line[i]!;
      line[i] = (filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 255;
    }
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < 3; k++) rgba[(y * width + x) * 4 + k] = line[x * channels + k]!;
      rgba[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3]! : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}
/** A snapshot's picture, read from the evidence store by its SHA-256. */
export function pictureOf(evidence: string, s: Snapshot, what: string): Image {
  const path = stored(evidence, s.sha256);
  expect(existsSync(path), `${what}: the snapshot ${s.sha256} is in the evidence store`).toBe(true);
  const file = readFileSync(path);
  expect(sha256(file), `${what}: the stored file hashes to its name`).toBe(s.sha256);
  return decodePng(file);
}
export type Rgb = [number, number, number];
export function pixel(img: Image, x: number, y: number): Rgb {
  const o = (y * img.width + x) * 4;
  return [img.rgba[o]!, img.rgba[o + 1]!, img.rgba[o + 2]!];
}
export const sameRgb = (a: Rgb, b: Rgb): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
export function fromHex(h: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(h);
  if (!m) throw Error(`not a color: ${h}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

// ---- looks (README: Looks), from the shipped clean look in the repo

/** The shipped clean look (crates/deep-canvas-marks/looks/clean.json), read at the base the suite runs on. */
export function cleanLook(): JsonObject {
  return JSON.parse(readFileSync(join(REPO, 'crates', 'deep-canvas-marks', 'looks', 'clean.json'), 'utf8')) as JsonObject;
}
/** Two looks that differ only in their tone map: `toned` (AgX at its defaults) and `plain` (none). */
export function looks(): { toned: JsonObject; plain: JsonObject } {
  const base = cleanLook();
  return {
    toned: { ...clone(base), id: 'toned', description: 'The #493 suite\'s clean look tone-mapped with AgX at its defaults.', tone_map: { agx: { white: 16.29, contrast: 1.25 } } },
    plain: { ...clone(base), id: 'plain', description: 'The #493 suite\'s clean look with no tone map.', tone_map: 'none' },
  };
}
const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture.' };
/** Stores each look in the evidence store and returns the document's `assets` naming them by hash. */
export function storeLooks(evidence: string, list: Record<string, JsonObject>): JsonObject {
  const assets: JsonObject = {};
  for (const [name, look] of Object.entries(list)) assets[name] = { sha256: putStore(evidence, Buffer.from(JSON.stringify(look))), license: LICENSE };
  return assets;
}
