// Test-side tools for the #489 acceptance tests: the `deep-motion` binary (#391's JSON-lines CLI, `eval`) and
// `deep-show run` (#200's `registries`, #185's `schedule`, #221's startup `--planted`), each built once per file;
// the documents the tests send; the f64 reference math the expected values come from (RK4 at 1 µs steps, the
// closed forms the issue writes, out_cubic, sums of sines); and the reference-Mac gate with the design's judge
// for timing results (as #387's suite). Nothing here stands in for motion: every value a test compares comes
// from a binary, every expected value from the issue's text computed here in f64.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/489 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
export const MOTION_NAME = 'deep-motion';
export const SHOW_NAME = 'deep-show';
/** Builds stay light on the shared Mac: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes this timeout: a first build of `deep-show` on the shared Mac can take many minutes. */
export const TIMEOUT = 1_800_000;

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
/** A seeded shuffle of a copy of `xs`. */
export function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const rand = seeded(seed);
  const out = [...xs];
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
export function int(value: JsonValue | undefined, what: string): number {
  const n = num(value, what);
  expect(Number.isSafeInteger(n), `${what} is an integer, got ${n}`).toBe(true);
  return n;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export const show = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
/** Whether a value's JSON text holds `needle` (an ID, a name). */
export const mentions = (value: JsonValue | undefined, needle: string): boolean => (JSON.stringify(value) ?? '').includes(needle);
/** Every number anywhere in a JSON value. */
export function numbersIn(value: JsonValue | undefined): number[] {
  if (typeof value === 'number') return [value];
  if (typeof value === 'string') return [...value.matchAll(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)].map((m) => Number(m[0]));
  if (Array.isArray(value)) return value.flatMap(numbersIn);
  if (isObject(value)) return Object.values(value).flatMap(numbersIn);
  return [];
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A check that must fail on a planted program: at least one failure, and one naming each of `named`. */
export function failsNaming(failures: readonly string[], named: readonly string[], what: string): void {
  expect(failures.length, `${what}: the planted program passes the check it must fail`).toBeGreaterThan(0);
  for (const n of named) expect(failures.some((f) => f.includes(n)), `${what}: a failure names ${n}; the failures: ${failures.slice(0, 8).join(' | ')}`).toBe(true);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each file builds what it drives once, in beforeAll, copied out under its own name; a test that uses a
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
    dir = mkdtempSync(join(tmpdir(), 'deep-489-motion-'));
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
    dir = mkdtempSync(join(tmpdir(), 'deep-489-show-'));
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

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }
export function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = TIMEOUT): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${bin} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}

// ---------------------------------------------------------------------------------------------------
// deep-motion eval (README: The surface under test)

export interface EvalLine {
  doc: JsonObject;
  times: number[];
  planted?: string;
  view?: { reduced_motion?: boolean };
  input?: JsonObject[];
  unwrap?: boolean;
  timing?: boolean;
}
const lineOf = (l: EvalLine): JsonObject => {
  const out: JsonObject = { doc: l.doc, times: l.times };
  if (l.planted !== undefined) out['planted'] = l.planted;
  if (l.view !== undefined) out['view'] = l.view as JsonObject;
  if (l.input !== undefined) out['input'] = l.input;
  if (l.unwrap !== undefined) out['unwrap'] = l.unwrap;
  if (l.timing !== undefined) out['timing'] = l.timing;
  return out;
};

/** `deep-motion eval`, one answer per line, in order; the run exits 0 with one line out per line in. */
export function evalAll(bin: string, lines: EvalLine[]): JsonObject[] {
  const s = start(bin, ['eval'], lines.map(lineOf));
  expect(s.timedOut, `${MOTION_NAME} eval finished within its timeout`).toBe(false);
  expect(s.status, `${MOTION_NAME} eval exits 0 (${s.signal ?? 'no signal'}); stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  expect(s.lines.length, `${MOTION_NAME} eval: one output line per input line; stdout: ${s.stdout.slice(0, 600)}`).toBe(lines.length);
  return s.lines.map((l, i) => obj(l, `${MOTION_NAME} eval: answer ${i}`));
}

export interface Frame { t: number; doc_t: number; items: JsonObject; channels: JsonObject; constraints: JsonObject; input: JsonValue | undefined; raw: JsonObject }
export interface Accepted { frames: Frame[]; order: JsonValue | undefined; raw: JsonObject }

/** An answer that accepted its document, with one frame per time, in order. */
export function accepted(answer: JsonObject, times: readonly number[], what: string): Accepted {
  expect(answer['ok'], `${what} is accepted: ${show(answer)}`).toBe(true);
  const frames = arr(answer['frames'], `${what}: frames`).map((v, i): Frame => {
    const f = obj(v, `${what}: frames[${i}]`);
    return {
      t: num(f['t'], `${what}: frames[${i}].t`),
      doc_t: typeof f['doc_t'] === 'number' ? f['doc_t'] : NaN,
      items: isObject(f['items']) ? f['items'] : {},
      channels: isObject(f['channels']) ? f['channels'] : {},
      constraints: isObject(f['constraints']) ? f['constraints'] : {},
      input: f['input'],
      raw: f,
    };
  });
  expect(frames.map((f) => f.t), `${what}: one frame per time, in the times' order`).toEqual([...times]);
  return { frames, order: answer['order'], raw: answer };
}
/** `eval` on one line, accepted. */
export function evalOk(bin: string, line: EvalLine, what: string): Accepted {
  return accepted(evalAll(bin, [line])[0]!, line.times, what);
}
/** The same for a planted program, which may refuse, crash or answer with the wrong frames: null then. */
export function evalPlanted(bin: string, line: EvalLine): Accepted | null {
  const s = start(bin, ['eval'], [lineOf(line)]);
  if (s.timedOut || s.status !== 0 || s.lines.length !== 1 || !isObject(s.lines[0])) return null;
  const a = s.lines[0];
  if (a['ok'] !== true || !Array.isArray(a['frames']) || a['frames'].length !== line.times.length) return null;
  return accepted(a, line.times, 'the planted program\'s answer');
}
/** A refused document: `{ok: false, code}`. */
export function refusal(answer: JsonObject, what: string): { code: string; raw: JsonObject } {
  expect(answer['ok'], `${what} is refused: ${show(answer)}`).toBe(false);
  return { code: str(answer['code'], `${what}: code`), raw: answer };
}

/** A channel's output `field` (`value`, `rate`, `integral`) as one number in a frame. */
export function chan(frame: Frame, id: string, field = 'value'): number {
  const c = obj(frame.channels[id], `frame ${frame.t}: channels.${id}`);
  const v = c[field];
  if (Array.isArray(v) && v.length === 1) return num(v[0], `frame ${frame.t}: channels.${id}.${field}[0]`);
  return num(v, `frame ${frame.t}: channels.${id}.${field}`);
}
/** A channel's output as a number, or NaN where it isn't one (for the planted checks, which collect failures). */
export function chanOr(frame: Frame, id: string, field = 'value'): number {
  const c = frame.channels[id];
  if (!isObject(c)) return NaN;
  const v = c[field];
  if (Array.isArray(v) && v.length === 1 && typeof v[0] === 'number') return v[0];
  return typeof v === 'number' ? v : NaN;
}
/** An item's evaluated world `at.<group>` (pos, rot or scale) in a frame. */
export function itemAt(frame: Frame, id: string, group: 'pos' | 'rot' | 'scale'): [number, number, number] {
  const item = obj(frame.items[id], `frame ${frame.t}: items.${id}`);
  const a = arr(obj(item['at'], `frame ${frame.t}: items.${id}.at`)[group], `frame ${frame.t}: items.${id}.at.${group}`);
  expect(a.length, `frame ${frame.t}: items.${id}.at.${group} holds three numbers`).toBe(3);
  return [num(a[0], `${id}.${group}[0]`), num(a[1], `${id}.${group}[1]`), num(a[2], `${id}.${group}[2]`)];
}
/** One constraint's frame report, `constraints.<id>`: `{ops, scale?}`. */
export function constraintAt(frame: Frame, id: string): JsonObject {
  return obj(frame.constraints[id], `frame ${frame.t}: constraints.${id}`);
}
/** A frame's evaluated values as text, for bit-for-bit comparison: its items, channels and constraints. */
export const poseText = (f: Frame): string => JSON.stringify({ items: f.items, channels: f.channels, constraints: f.constraints });

/** Seek against play: every time alone on its own line (a cold seek), against one line playing them ascending. */
export function seekPlayFailures(bin: string, doc: JsonObject, times: readonly number[], what: string, extra: Partial<EvalLine> = {}): string[] {
  const sorted = [...times].sort((a, b) => a - b);
  const answers = evalAll(bin, [{ doc, times: sorted, ...extra }, ...sorted.map((t) => ({ doc, times: [t], ...extra }))]);
  const play = accepted(answers[0]!, sorted, `${what}: the play`);
  const failures: string[] = [];
  sorted.forEach((t, i) => {
    const seek = accepted(answers[i + 1]!, [t], `${what}: the seek to ${t}`);
    if (poseText(seek.frames[0]!) !== poseText(play.frames[i]!)) failures.push(`${what}: at ${t} flicks the seek reads ${poseText(seek.frames[0]!).slice(0, 300)} but the play reads ${poseText(play.frames[i]!).slice(0, 300)}`);
  });
  return failures;
}

// ---------------------------------------------------------------------------------------------------
// Documents as the tests write them (README: Documents)

export const SIZE = [640, 360];
export function rect(id: string, pos: [number, number], extra: JsonObject = {}): JsonObject {
  return { id, kind: 'rect@1', name: `Rect ${id}`, order: `a${id}`, params: { box: [0, 0, 20, 20], paint: { fill: { role: 'ink' } } }, at: { pos: [pos[0], pos[1], 0] }, ...extra };
}
export function film(id: string, items: JsonObject[], extra: JsonObject = {}, transport: JsonObject = { span: '6s' }): JsonObject {
  return {
    format: 1, id, profile: 'film', title: `#489 ${id}`, description: `The #489 acceptance tests' document ${id}.`, size: SIZE,
    transport, items: Object.fromEntries(items.map((i) => [String(i['id']), i])), ...extra,
  };
}
export type Interp = JsonValue;
export const key = (t: number, value: number, interp: Interp = 'linear', extra: JsonObject = {}): JsonObject => ({ t: at(t), value, interp, ...extra });
/** A keyed f32 channel. */
export const keyed = (target: string, keys: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject => ({ target, type: 'f32', keys, ...extra });
/** A follow channel on a keyed source (each source key holds until the next). */
export function follow(target: string, source: [number, number][], model: JsonObject, extra: JsonObject = {}, outputs?: string[]): JsonObject {
  const keys = Object.fromEntries(source.map(([t, v], i) => [`s${i}`, { t: at(t), value: v, interp: 'hold' }]));
  const f: JsonObject = { source: { keys }, model };
  if (outputs) f['outputs'] = outputs;
  return { target, type: 'f32', mode: 'follow', follow: f, ...extra };
}

// ---------------------------------------------------------------------------------------------------
// Reference math in f64 (the expected values: computed here from the issue's text, never read from motion)

/** A damped spring toward `target`: x'' = −2ζω0·x' − ω0²·(x − target). */
export interface Spring { omega0: number; zeta: number }
export const springOfHz = (freqHz: number, zeta: number): Spring => ({ omega0: 2 * Math.PI * freqHz, zeta });
/** The issue's alias {decay, omega}: ζ·ω0 = decay, damped frequency omega, so ω0² = decay² + omega². */
export const springOfDecay = (decay: number, omega: number): Spring => { const omega0 = Math.hypot(decay, omega); return { omega0, zeta: decay / omega0 }; };

const RK4_STEP = 1e-6;
/**
 * RK4 on the spring's ODE at 1 µs steps from (x0, v0) at time 0, against a piecewise-constant target
 * (`targets`: [start s, target] ascending, the first at 0), sampled at `at` (seconds, any order). The last step
 * before a sample or a target change is shortened to land on it exactly.
 */
export function rk4Spring(s: Spring, x0: number, v0: number, targets: [number, number][], at: readonly number[]): number[] {
  const order = at.map((t, i) => [t, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(at.length);
  let x = x0; let v = v0; let t = 0;
  const w2 = s.omega0 * s.omega0; const c = 2 * s.zeta * s.omega0;
  let seg = 0;
  const step = (h: number, b: number): void => {
    const ax = (xx: number, vv: number): number => -c * vv - w2 * (xx - b);
    const k1x = v; const k1v = ax(x, v);
    const k2x = v + 0.5 * h * k1v; const k2v = ax(x + 0.5 * h * k1x, v + 0.5 * h * k1v);
    const k3x = v + 0.5 * h * k2v; const k3v = ax(x + 0.5 * h * k2x, v + 0.5 * h * k2v);
    const k4x = v + h * k3v; const k4v = ax(x + h * k3x, v + h * k3v);
    x += (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
    v += (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
  };
  for (const [target, i] of order) {
    while (t < target - 1e-15) {
      while (seg + 1 < targets.length && targets[seg + 1]![0] <= t + 1e-15) seg++;
      const nextChange = seg + 1 < targets.length ? targets[seg + 1]![0] : Infinity;
      const end = Math.min(target, nextChange);
      const n = Math.max(1, Math.ceil((end - t) / RK4_STEP - 1e-9));
      const h = (end - t) / n;
      for (let k = 0; k < n; k++) step(h, targets[seg]![1]);
      t = end;
    }
    out[i] = x;
  }
  return out;
}
/** |got − ref| within `rel` × |ref|. */
export const withinRel = (got: number, ref: number, rel: number): boolean => Math.abs(got - ref) <= rel * Math.abs(ref);
/** Penner's out_cubic: 1 − (1 − u)³. */
export const outCubic = (u: number): number => 1 - (1 - u) ** 3;

// ---------------------------------------------------------------------------------------------------
// deep-show run: #200's registries listing, #185's schedule, the seal's startup refusal (#305, #221's --planted)

export function scenario(calls: JsonObject[], evidence: string): JsonObject {
  return { evidence, sessions: {}, processes: [], panels: {}, docs: {}, calls };
}
/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-489-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}
/** `deep-show run [--planted <name>]`: one scenario, accepted, with one reply per call. */
export function runShow(bin: string, sc: JsonObject, planted?: string): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [sc]);
  expect(s.timedOut, `${SHOW_NAME} ${args.join(' ')} finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} ${args.join(' ')} exits 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-1500)}`).toBe(0);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${show(out)}`).toBe(true);
  return arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
}
/** One startup and a `registry` call: whether the seal took the set (exit 0) or refused it (exit 2, one line). */
export function startup(bin: string, planted?: string): Started {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const s = start(bin, args, [{ evidence: tmpdir(), calls: [{ call: 'registry' }] }]);
  expect(s.timedOut, `${SHOW_NAME} ${args.join(' ')} finished within its timeout`).toBe(false);
  return s;
}
export interface SealRefusal { reason: string; registry: string | undefined; raw: JsonObject }
/** The seal's refusal line (exit 2, `{ok: false, code: "seal_refused", reason, registry?, entries?, modules?}`), or why it isn't one. */
export function sealRefusal(s: Started): SealRefusal | string {
  if (s.status !== 2) return `the startup exited ${s.status} (${s.signal ?? 'no signal'}), not 2 with the seal's refusal; stdout: ${s.stdout.slice(0, 600)}`;
  if (s.lines.length !== 1 || !isObject(s.lines[0])) return `the refusal is not one JSON line: ${s.stdout.slice(0, 600)}`;
  const raw = s.lines[0];
  if (raw['ok'] !== false || raw['code'] !== 'seal_refused') return `the line is not the seal's refusal: ${show(raw)}`;
  return { reason: String(raw['reason'] ?? ''), registry: typeof raw['registry'] === 'string' ? raw['registry'] : undefined, raw };
}

export interface KitResult { verdict: string; rules: { rule: string; verdict: string; message: string }[]; raw: JsonObject }
function kitResult(v: JsonValue | undefined, what: string): KitResult {
  const o = obj(v, what);
  const rules = arr(o['rules'] ?? [], `${what}.rules`).map((r, i) => {
    const ro = obj(r, `${what}.rules[${i}]`);
    return { rule: str(ro['rule'], `${what}.rules[${i}].rule`), verdict: str(ro['verdict'], `${what}.rules[${i}].verdict`), message: typeof ro['message'] === 'string' ? ro['message'] : '' };
  });
  return { verdict: str(o['verdict'], `${what}.verdict`), rules, raw: o };
}
export interface Entry { name: string; origin: string; module: string | undefined; since: string; digest: string; kit: KitResult; raw: JsonObject }
export interface Listed { name: string; owner: string; fill: string[]; kit: { rule: string; message: string }[]; entries: Entry[]; raw: JsonObject }
/** The registry `name` in a `registries` reply (#200: `{"uri": "deep://registries/<core version>", "registries": [...]}`). */
export function theRegistry(reply: JsonObject, name: string): Listed {
  const all = arr(reply['registries'], 'registries: registries').map((v, i) => obj(v, `registries[${i}]`));
  const o = all.find((x) => x['kind'] === 'registry' && x['name'] === name);
  expect(o, `deep://registries lists the registry ${name}`).toBeDefined();
  const at0 = `deep://registries ${name}`;
  return {
    name,
    owner: str(o!['owner'], `${at0}.owner`),
    fill: arr(o!['fill'], `${at0}.fill`).map((f, i) => str(f, `${at0}.fill[${i}]`)),
    kit: arr(o!['kit'], `${at0}.kit`).map((r, i) => { const ro = obj(r, `${at0}.kit[${i}]`); return { rule: str(ro['rule'], `${at0}.kit[${i}].rule`), message: str(ro['message'], `${at0}.kit[${i}].message`) }; }),
    entries: arr(o!['entries'] ?? [], `${at0}.entries`).map((e, i) => {
      const eo = obj(e, `${at0}.entries[${i}]`);
      return {
        name: str(eo['name'], `${at0}.entries[${i}].name`), origin: str(eo['origin'], `${at0}.entries[${i}].origin`),
        module: typeof eo['module'] === 'string' ? eo['module'] : undefined, since: String(eo['since'] ?? ''),
        digest: String(eo['digest'] ?? ''), kit: kitResult(eo['kit'], `${at0}.entries[${i}].kit`), raw: eo,
      };
    }),
    raw: o!,
  };
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results (as tests/acceptance/387). Mains power is not
// part of the gate: the owner's rule is never to wait for it; the judge's margin absorbs the noise.

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine can't give a timing verdict, or null on a reference Mac in a fit state. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin; else INCONCLUSIVE. */
export function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
export const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };
