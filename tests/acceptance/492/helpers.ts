// Test-side tools for the #492 acceptance tests: the `deep-motion` binary (#391's JSON-lines CLI, `eval`, as #417, #489,
// #490 and #491 extended it), built once per file; the documents the tests send (films with clips, placements and time
// remaps); and the reference math the expected values come from (the design's closed forms in f64, quaternions, the
// ramp's integral). Nothing here stands in for motion: every value a test compares comes from the binary, every expected
// value from the issue's text computed here.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/492 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
export const MOTION_NAME = 'deep-motion';
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes this timeout: a first build of `deep-motion` can take many minutes. */
export const TIMEOUT = 1_800_000;

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text). */
export const AC = {
  1: 'AC1 #492.7cd93cd7',
  2: 'AC2 #492.f372ab7a',
  3: 'AC3 #492.5d279164',
  4: 'AC4 #492.f704c8e6',
  5: 'AC5 #492.77bbe5c2',
  6: 'AC6 #492.853d06ee',
  7: 'AC7 #492.5ffc89bd',
  8: 'AC8 #492.7d21a76a',
  9: 'AC9 #492.181f2b27',
  10: 'AC10 #492.102b52ef',
  11: 'AC11 #492.2a883e4b',
  12: 'AC12 #492.0458de19',
  13: 'AC13 #492.4cc26973',
  14: 'AC14 #492.9a173ea6',
  15: 'AC15 #492.4f0f9de3',
  16: 'AC16 #492.f894a6dc',
} as const;

// ---------------------------------------------------------------------------------------------------
// Time

/** Flicks in one second (Time and the flick). */
export const FLICKS = 705_600_000;
/** Seconds to whole flicks (exact for the decimal seconds the tests write). */
export const fl = (s: number): number => Math.round(s * FLICKS);
/** Flicks to seconds in f64. */
export const secs = (flicks: number): number => flicks / FLICKS;
/** A time field as the time grammar's text, `"<s>s"`. */
export const at = (s: number): string => `${s}s`;
/** A seeded generator (mulberry32), so a failing run replays: the same seed gives the same times. */
function seeded(seed: number): () => number {
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
/** A document fixture from fixtures/, as JSON. */
export function fixture(path: string): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', path), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${path} is not a JSON object`);
  return value;
}
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** The criterion stays open, whatever the reason: never a pass (AGENTS.md: the four invariants). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// The build: each file builds deep-motion once, in beforeAll, copied out under its own name; a test that uses a
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
    dir = mkdtempSync(join(tmpdir(), 'deep-492-motion-'));
    error = cargo(['build', '--locked', '--bin', MOTION_NAME]);
    if (error === '') { bin = join(dir, MOTION_NAME); copyFileSync(join(TARGET, 'debug', exe(MOTION_NAME)), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return { bin: () => { expect(error, `the binary builds: cargo build --locked --bin ${MOTION_NAME}`).toBe(''); return bin; } };
}

// ---------------------------------------------------------------------------------------------------
// deep-motion eval (README: The surface under test)

export interface EvalLine { doc: JsonObject; times: number[]; planted?: string; input?: JsonObject[]; look?: JsonObject }
const lineOf = (l: EvalLine): JsonObject => {
  const out: JsonObject = { doc: l.doc, times: l.times };
  if (l.planted !== undefined) out['planted'] = l.planted;
  if (l.input !== undefined) out['input'] = l.input;
  if (l.look !== undefined) out['look'] = l.look;
  return out;
};

interface Run { timedOut: boolean; error: string; status: number | null; stderr: string; lines: JsonValue[] }
function start(bin: string, lines: EvalLine[]): Run {
  const text = lines.map((l) => JSON.stringify(lineOf(l))).join('\n');
  const run = spawnSync(bin, ['eval'], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  const out = (run.stdout ?? '').split('\n').filter((l) => l !== '').map((l): JsonValue => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { timedOut, error: run.error?.message ?? '', status: run.status, stderr: (run.stderr ?? '').slice(-1500), lines: out };
}

/** `deep-motion eval`, one answer per line, in order; the run exits 0 with one line out per line in. */
export function evalAll(bin: string, lines: EvalLine[]): JsonObject[] {
  const r = start(bin, lines);
  expect(r.timedOut, `${MOTION_NAME} eval finished within its timeout`).toBe(false);
  expect(r.error, `${MOTION_NAME} eval ran`).toBe('');
  expect(r.status, `${MOTION_NAME} eval exits 0; stderr: ${r.stderr}`).toBe(0);
  expect(r.lines.length, `${MOTION_NAME} eval: one output line per input line`).toBe(lines.length);
  return r.lines.map((l, i) => obj(l, `${MOTION_NAME} eval: answer ${i}`));
}
/** `eval` on one line. */
export const evalOne = (bin: string, line: EvalLine): JsonObject => evalAll(bin, [line])[0]!;

export interface Frame { t: number; items: JsonObject; placements: JsonObject; raw: JsonObject }
export interface Accepted { frames: Frame[]; markers: JsonObject; notices: JsonValue | undefined; hash: JsonValue | undefined; raw: JsonObject }

/** An answer that accepted its document, with one frame per time, in order. */
export function accepted(answer: JsonObject, times: readonly number[], what: string): Accepted {
  expect(answer['ok'], `${what} is accepted: ${show(answer)}`).toBe(true);
  const frames = arr(answer['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    return { t: num(f['t'], `${what}: frames[${i}].t`), items: isObject(f['items']) ? f['items'] : {}, placements: isObject(f['placements']) ? f['placements'] : {}, raw: f };
  });
  expect(frames.map((f) => f.t), `${what}: one frame per time, in the times' order`).toEqual([...times]);
  return { frames, markers: isObject(answer['markers']) ? answer['markers'] : {}, notices: answer['notices'], hash: answer['hash'], raw: answer };
}
export function evalOk(bin: string, line: EvalLine, what: string): Accepted {
  return accepted(evalOne(bin, line), line.times, what);
}
/** A refused document: `{ok: false, …}`, its whole JSON. */
export function refused(answer: JsonObject, what: string): JsonObject {
  expect(answer['ok'], `${what} is refused: ${show(answer)}`).toBe(false);
  return answer;
}
/** The same for a planted program: its frames, which the test sends through the check the real program passes. A name the binary doesn't know answers `bad_input`, and the test stops on it. */
export function evalPlanted(bin: string, line: EvalLine & { planted: string }, what: string): Accepted {
  const answer = evalOne(bin, line);
  expect(answer['ok'], `${what}: the planted program ${line.planted} answers with frames: ${show(answer)}`).toBe(true);
  return accepted(answer, line.times, what);
}

/** A number of a frame's item, or NaN where it isn't one (for checks that collect failures). */
const pick = (v: JsonValue | undefined): number => (typeof v === 'number' ? v : NaN);
/** An item's evaluated `at.pos[k]`, or NaN. */
export function posOr(frame: Frame, id: string, k: number): number {
  const item = frame.items[id];
  const place = isObject(item) ? item['at'] : undefined;
  const pos = isObject(place) ? place['pos'] : undefined;
  return Array.isArray(pos) ? pick(pos[k]) : NaN;
}
/** An item's evaluated `at.rot[k]` in degrees, or NaN. */
export function rotOr(frame: Frame, id: string, k: number): number {
  const item = frame.items[id];
  const place = isObject(item) ? item['at'] : undefined;
  const rot = isObject(place) ? place['rot'] : undefined;
  return Array.isArray(rot) ? pick(rot[k]) : NaN;
}
/** An item's evaluated quaternion param, `params.quat` as [x, y, z, w], or four NaNs. */
export function quatOr(frame: Frame, id: string): Quat {
  const item = frame.items[id];
  const params = isObject(item) ? item['params'] : undefined;
  const q = isObject(params) ? params['quat'] : undefined;
  return Array.isArray(q) && q.length === 4 ? [pick(q[0]), pick(q[1]), pick(q[2]), pick(q[3])] : [NaN, NaN, NaN, NaN];
}
/** A clip channel's `.rate` per second under a placement: the frame's `placements.<id>.rates.<channel>`, or NaN. */
export function rateOr(frame: Frame, placement: string, channel: string): number {
  const p = frame.placements[placement];
  const rates = isObject(p) ? p['rates'] : undefined;
  return isObject(rates) ? pick(rates[channel]) : NaN;
}
/** Seeks to each time alone, in one line each, and compares its items with the play's, bit for bit. */
export function seekPlayFailures(bin: string, line: EvalLine, what: string): string[] {
  const sorted = [...line.times].sort((a, b) => a - b);
  const answers = evalAll(bin, [{ ...line, times: sorted }, ...sorted.map((t) => ({ ...line, times: [t] }))]);
  const play = accepted(answers[0]!, sorted, `${what}: the play`);
  const failures: string[] = [];
  sorted.forEach((t, i) => {
    const seek = accepted(answers[i + 1]!, [t], `${what}: the seek to ${t}`);
    const a = JSON.stringify(seek.frames[0]!.items); const b = JSON.stringify(play.frames[i]!.items);
    if (a !== b) failures.push(`${what}: at ${t} flicks the seek reads ${a.slice(0, 300)} but the play reads ${b.slice(0, 300)}`);
  });
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Documents as the tests write them (README: Documents)

export const SIZE = [640, 360];
export const LAYER = 'main';
export const LAYERS: JsonObject = { [LAYER]: { writer: 'agent-a', title: 'Main', order: 'a0' } };
export function rect(id: string, pos: [number, number], extra: JsonObject = {}): JsonObject {
  return { id, kind: 'rect@1', layer: LAYER, name: `Rect ${id}`, order: `a${id}`, params: { box: [0, 0, 20, 20], paint: { fill: { role: 'ink' } } }, at: { pos: [pos[0], pos[1], 0] }, ...extra };
}
/** A rect standing for a bone: its `params.quat` is the rotation under test (README: Choices, the bone). */
export function bone(id: string, quat: Quat): JsonObject {
  return { id, kind: 'rect@1', layer: LAYER, name: `Bone ${id}`, order: `a${id}`, params: { box: [0, 0, 20, 20], paint: { fill: { role: 'ink' } }, quat }, at: { pos: [0, 0, 0] } };
}
export function film(id: string, items: JsonObject[], extra: JsonObject = {}, transport: JsonObject = { span: '10s' }): JsonObject {
  return {
    format: 1, id, profile: 'film', title: `#492 ${id}`, description: `The #492 acceptance tests' document ${id}.`, size: SIZE, layers: LAYERS,
    transport, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
export type KeyList = [seconds: number, value: JsonValue, interp?: JsonValue][];
/** A channel's keys, IDs in time order; a key with no interp of its own is linear. */
export function keys(list: KeyList): JsonObject {
  return Object.fromEntries(list.map(([t, value, interp], i) => [`k${String(i).padStart(2, '0')}`, { t: at(t), value, interp: interp ?? 'linear' }]));
}
export const channel = (target: string, list: KeyList, type = 'f32', extra: JsonObject = {}): JsonObject => ({ target, type, keys: keys(list), ...extra });
/** A clip with one channel on slot `s`'s `field`. */
export const clipOf = (id: string, field: string, list: KeyList, type = 'f32'): JsonObject => ({ channels: { [id]: channel(`slot:s/${field}`, list, type) } });
/** A placement of `clip` on `item` through slot `s`. */
export const place = (clip: string, item: string | string[], extra: JsonObject = {}): JsonObject => ({ clip, slots: { s: item }, ...extra });
/** A 20 s clip whose x reads its own time: x(c) = c, so an item's x is the child time in seconds and its `.rate` the child's rate. */
export const RULER: JsonObject = clipOf('x', 'at/pos/0', [[0, 0], [20, 20]]);

// ---------------------------------------------------------------------------------------------------
// Reference math (the expected values: computed here from the issue's text, never read from motion)

/** in_out_quad, Time remap's default ease. */
export const inOutQuad = (u: number): number => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u));
/** Its derivative. */
export const inOutQuadRate = (u: number): number => (u < 0.5 ? 4 * u : 4 * (1 - u));

/** The issue's ramp {from, to, at, over} with in_out_quad: the rate at parent time t. */
export function rampRate(t: number, r: { from: number; to: number; at: number; over: number }): number {
  if (t <= r.at) return r.from;
  if (t >= r.at + r.over) return r.to;
  return r.from + (r.to - r.from) * inOutQuad((t - r.at) / r.over);
}
/** The closed-form integral of that rate from 0 to t: the child time. */
export function rampChild(t: number, r: { from: number; to: number; at: number; over: number }): number {
  if (t <= r.at) return r.from * t;
  const u = Math.min((t - r.at) / r.over, 1);
  const inside = r.at * r.from + r.over * (r.from * u + (r.to - r.from) * easeArea(u));
  return t <= r.at + r.over ? inside : inside + r.to * (t - r.at - r.over);
}
/** ∫₀ᵘ in_out_quad(x) dx, in pieces: 2u³/3 to the middle, then 1/12 plus ∫ (1 − 2(1 − x)²) from ½. */
function easeArea(u: number): number {
  if (u <= 0.5) return (2 * u * u * u) / 3;
  const rest = 1 - u;
  return 0.5 - (rest - (2 * rest * rest * rest) / 3);
}

export type Quat = [number, number, number, number];
export const quatOf = (axis: [number, number, number], deg: number): Quat => {
  const half = (deg * Math.PI) / 360; const n = Math.hypot(...axis); const s = Math.sin(half) / n;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(half)];
};
export const IDENTITY: Quat = [0, 0, 0, 1];
export const neg = (q: Quat): Quat => [-q[0], -q[1], -q[2], -q[3]];
export const conj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
export const dot4 = (a: Quat, b: Quat): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
export function mulQ(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export function normalizeQ(q: Quat): Quat {
  const n = Math.hypot(...q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}
/** `q` with the sign that takes the shorter arc from `to`. */
export const aligned = (q: Quat, to: Quat): Quat => (dot4(q, to) < 0 ? neg(q) : q);
/** The shorter-arc slerp from a to b at u. */
export function slerp(a: Quat, b: Quat, u: number): Quat {
  const end = aligned(b, a); const c = Math.min(1, dot4(a, end));
  const theta = Math.acos(c);
  if (theta < 1e-12) return a;
  const s = Math.sin(theta); const p = Math.sin((1 - u) * theta) / s; const r = Math.sin(u * theta) / s;
  return [a[0] * p + end[0] * r, a[1] * p + end[1] * r, a[2] * p + end[2] * r, a[3] * p + end[3] * r];
}
/** The angle between two rotations in degrees, q and −q being one rotation; NaN for a quaternion that isn't one. */
export function angleDeg(a: Quat, b: Quat): number {
  const n = Math.hypot(...a) * Math.hypot(...b);
  return (2 * Math.acos(Math.min(1, Math.abs(dot4(a, b)) / n)) * 180) / Math.PI;
}
/** Each component's largest difference between two rotations, the sign aligned. */
export const quatDistance = (got: Quat, want: Quat): number => {
  const q = aligned(got, want);
  return Math.max(Math.abs(q[0] - want[0]), Math.abs(q[1] - want[1]), Math.abs(q[2] - want[2]), Math.abs(q[3] - want[3]));
};
/** A key list's rotation at `s` seconds: slerp between the keys around it, held past either end. */
export function quatKeysAt(list: [number, Quat][], s: number): Quat {
  if (s <= list[0]![0]) return list[0]![1];
  for (let i = 0; i + 1 < list.length; i++) {
    const [t0, q0] = list[i]!; const [t1, q1] = list[i + 1]!;
    if (s < t1) return slerp(q0, q1, (s - t0) / (t1 - t0));
  }
  return list[list.length - 1]![1];
}
