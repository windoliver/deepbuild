// Test-side tools for the #491 acceptance tests: the `deep-motion` binary (#391's JSON-lines CLI, `eval`, as #489 and
// #490 extended it), built once per file; the documents the tests send (films with a tempo map, markers, drivers,
// a laid-out frame); and the reference math the expected values come from (exact beat times as rationals in
// BigInt, a ramp's closed form in f64, the planted f32 grid's first wrong beat). Nothing here stands in for motion:
// every value a test compares comes from the binary, every expected value from the issue's text computed here.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/491 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
export const MOTION_NAME = 'deep-motion';
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes this timeout: a first build of `deep-motion` can take many minutes. */
export const TIMEOUT = 1_800_000;

// ---------------------------------------------------------------------------------------------------
// Time

/** Flicks in one second (Time and the flick). */
export const FLICKS = 705_600_000;
/** Seconds to whole flicks (exact for the decimal seconds the tests write). */
export const fl = (s: number): number => Math.round(s * FLICKS);
/** A time field as the time grammar's text, `"<s>s"`. */
export const at = (s: number): string => `${s}s`;
/** The time grammar's bar:beat text, `"<bar>:<beat>b"`, bar and beat from 1. */
export const barBeat = (bar: number, beat: number): string => `${bar}:${beat}b`;
/** Beat k (from 0) of a map whose bars all hold `perBar` beats, as bar:beat text. */
export const beatText = (k: number, perBar: number): string => barBeat(Math.floor(k / perBar) + 1, (k % perBar) + 1);

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
/** Every number anywhere in a JSON value, those written inside strings included. */
export function numbersIn(value: JsonValue | undefined): number[] {
  if (typeof value === 'number') return [value];
  if (typeof value === 'string') return [...value.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)].map((m) => Number(m[0]));
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (isObject(value)) return Object.values(value).flatMap(numbersIn);
  return [];
}
/** Every string anywhere in a JSON value. */
export function stringsIn(value: JsonValue | undefined): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (isObject(value)) return Object.values(value).flatMap(stringsIn);
  return [];
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
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
    dir = mkdtempSync(join(tmpdir(), 'deep-491-motion-'));
    error = cargo(['build', '--locked', '--bin', MOTION_NAME]);
    if (error === '') { bin = join(dir, MOTION_NAME); copyFileSync(join(TARGET, 'debug', exe(MOTION_NAME)), bin); }
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return { bin: () => { expect(error, `the binary builds: cargo build --locked --bin ${MOTION_NAME}`).toBe(''); return bin; } };
}

// ---------------------------------------------------------------------------------------------------
// deep-motion eval (README: The surface under test)

export interface EvalLine { doc: JsonObject; times: number[]; planted?: string; input?: JsonObject[] }
const lineOf = (l: EvalLine): JsonObject => {
  const out: JsonObject = { doc: l.doc, times: l.times };
  if (l.planted !== undefined) out['planted'] = l.planted;
  if (l.input !== undefined) out['input'] = l.input;
  return out;
};

/** `deep-motion eval`, one answer per line, in order; the run exits 0 with one line out per line in. */
export function evalAll(bin: string, lines: EvalLine[]): JsonObject[] {
  const text = lines.map((l) => JSON.stringify(lineOf(l))).join('\n');
  const run = spawnSync(bin, ['eval'], { cwd: REPO, input: `${text}\n`, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, `${MOTION_NAME} eval finished within its timeout`).toBe(false);
  expect(run.error, `${MOTION_NAME} eval ran: ${run.error?.message ?? ''}`).toBeUndefined();
  expect(run.status, `${MOTION_NAME} eval exits 0 (${run.signal ?? 'no signal'}); stderr: ${(run.stderr ?? '').slice(-1500)}`).toBe(0);
  const out = (run.stdout ?? '').split('\n').filter((l) => l !== '').map((l): JsonValue => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  expect(out.length, `${MOTION_NAME} eval: one output line per input line; stdout: ${(run.stdout ?? '').slice(0, 600)}`).toBe(lines.length);
  return out.map((l, i) => obj(l, `${MOTION_NAME} eval: answer ${i}`));
}
/** `eval` on one line. */
export const evalOne = (bin: string, line: EvalLine): JsonObject => evalAll(bin, [line])[0]!;

export interface Frame { t: number; items: JsonObject; boxes: JsonValue | undefined; raw: JsonObject }
export interface Accepted { frames: Frame[]; markers: JsonObject; notices: JsonValue | undefined; raw: JsonObject }

/** An answer that accepted its document, with one frame per time, in order. */
export function accepted(answer: JsonObject, times: readonly number[], what: string): Accepted {
  expect(answer['ok'], `${what} is accepted: ${show(answer)}`).toBe(true);
  const frames = arr(answer['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    return { t: num(f['t'], `${what}: frames[${i}].t`), items: isObject(f['items']) ? f['items'] : {}, boxes: f['boxes'], raw: f };
  });
  expect(frames.map((f) => f.t), `${what}: one frame per time, in the times' order`).toEqual([...times]);
  return { frames, markers: isObject(answer['markers']) ? answer['markers'] : {}, notices: answer['notices'], raw: answer };
}
export function evalOk(bin: string, line: EvalLine, what: string): Accepted {
  return accepted(evalOne(bin, line), line.times, what);
}
/** A refused document: `{ok: false, …}`, its whole JSON. */
export function refused(answer: JsonObject, what: string): JsonObject {
  expect(answer['ok'], `${what} is refused: ${show(answer)}`).toBe(false);
  return answer;
}

/** A marker's resolved start in flicks: the answer's `markers.<id>.t`. */
export function markerT(a: Accepted, id: string, what: string): number {
  const m = obj(a.markers[id], `${what}: markers.${id}`);
  return num(m['t'], `${what}: markers.${id}.t`);
}
/** A marker's start, or NaN where the answer has none (for checks that collect failures). */
export function markerTOr(a: Accepted, id: string): number {
  const m = a.markers[id];
  return isObject(m) && typeof m['t'] === 'number' ? m['t'] : NaN;
}
/** An item's evaluated `at.pos[k]` in a frame. */
export function posAt(frame: Frame, id: string, k: number): number {
  const item = obj(frame.items[id], `frame ${frame.t}: items.${id}`);
  const pos = arr(obj(item['at'], `frame ${frame.t}: items.${id}.at`)['pos'], `frame ${frame.t}: items.${id}.at.pos`);
  return num(pos[k], `frame ${frame.t}: items.${id}.at.pos[${k}]`);
}
/** A laid-out item's box `[x, y, w, h]` in a frame: the frame's `boxes.<id>`. */
export function boxAt(frame: Frame, id: string): [number, number, number, number] {
  const b = arr(obj(frame.boxes, `frame ${frame.t}: boxes`)[id], `frame ${frame.t}: boxes.${id}`);
  expect(b.length, `frame ${frame.t}: boxes.${id} holds four numbers`).toBe(4);
  return [num(b[0], `${id} x`), num(b[1], `${id} y`), num(b[2], `${id} w`), num(b[3], `${id} h`)];
}

// ---------------------------------------------------------------------------------------------------
// Documents as the tests write them (README: Documents)

export const SIZE = [640, 360];
export function rect(id: string, pos: [number, number], extra: JsonObject = {}): JsonObject {
  return { id, kind: 'rect@1', name: `Rect ${id}`, order: `a${id}`, params: { box: [0, 0, 20, 20], paint: { fill: { role: 'ink' } } }, at: { pos: [pos[0], pos[1], 0] }, ...extra };
}
export function film(id: string, items: JsonObject[], extra: JsonObject = {}, transport: JsonObject = { span: '6s' }): JsonObject {
  return {
    format: 1, id, profile: 'film', title: `#491 ${id}`, description: `The #491 acceptance tests' document ${id}.`, size: SIZE,
    transport, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
/** A tempo map segment as the issue's Fields spell it; `meter` as [beats per bar, beat unit]. */
export function segment(atText: string, bpm: number, meter: [number, number], span: number, ramp?: { to_bpm: number }): JsonObject {
  return { at: atText, bpm, meter, span, ramp: ramp ? { to_bpm: ramp.to_bpm, shape: 'linear_in_beats' } : 'none' };
}
export const tempoMap = (segments: JsonObject[]): JsonObject => ({ segments });

// ---------------------------------------------------------------------------------------------------
// Reference math (the expected values: computed here from the issue's text, never read from motion)

const B60 = 60n * BigInt(FLICKS);
/** n ÷ d rounded to the nearest integer (n, d > 0; a half rounds up, which the fixtures never reach). */
export function roundDiv(n: bigint, d: bigint): bigint {
  const q = n / d; const r = n % d;
  return 2n * r >= d ? q + 1n : q;
}
/** Exact flicks of `beats` beats at a constant `bpm`, as the rational n ÷ d. */
export const beatsFlicks = (beats: bigint, bpm: bigint): [bigint, bigint] => [beats * B60, bpm];
/** |n ÷ d − round(n ÷ d)|'s distance from one half, so a fixture can show it never sits on a rounding tie. */
export function tieDistance(n: bigint, d: bigint): number {
  return Math.abs(Number(((n % d) * 1_000_000n) / d) / 1e6 - 0.5);
}
/** The closed form of a ramp linear in beats: seconds for `beats` beats from b0 to b1 BPM, 60·N ÷ (b1 − b0) · ln(b1 ÷ b0). */
export const rampSeconds = (beats: number, b0: number, b1: number): number => ((60 * beats) / (b1 - b0)) * Math.log(b1 / b0);

/**
 * The planted grid `beat_grid_f32_seconds` (README: Planted programs) at `bpm`: beat k held as f32 seconds,
 * f32(k) × f32(60 ÷ bpm), converted to flicks by an f32 multiply by 705,600,000 and rounded. The first k in [0, last]
 * whose flick differs from the exact grid's, or null.
 */
export function f32GridFirstWrong(bpm: number, last: number): number | null {
  const per = Math.fround(60 / bpm); const f = Math.fround(FLICKS);
  const exactPer = (60 * FLICKS) / bpm;
  for (let k = 0; k <= last; k++) {
    const planted = Math.round(Math.fround(Math.fround(Math.fround(k) * per) * f));
    if (planted !== k * exactPer) return k;
  }
  return null;
}
