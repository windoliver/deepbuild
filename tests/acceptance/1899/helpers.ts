// Test-side tools for the #1899 acceptance tests: `deep-gpu` (#377's binary) built with `test-meter` and driven
// by JSON lines on wgpu's noop backend with this suite's call, `frame_budget` (README: The surface under test);
// the showpiece document a run renders; the environment fingerprints the stub stands in with; the reply's parser;
// the design's five-run rule, which the stub timer's results are judged against; and the rung log's check.
// Nothing here stands in for the meter, the ladder or the frame-budget check under test.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1899 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const BIN = 'deep-gpu';
const BUILD = ['build', '--locked', '--bin', BIN, '--features', 'test-meter'];

// ---------------------------------------------------------------------------------------------------
// The criteria's numbers and the design's.

/** The showpiece class's frame GPU limit, in ms (the budget class table): "the 10 ms p95". */
export const SHOWPIECE_GPU_MS = 10;
/** Five timed runs after warm-up (Frame budget; Every task carries its own budgets). */
export const RUNS = 5;
export const FPS = 60;
/** Every document here is drawn at this size; no criterion names one. */
export const PIXELS: [number, number] = [320, 240];
/** The writer whose revision the run renders. */
export const WRITER = 'agent:alpha';
export const VERDICTS = ['PASS', 'FAIL', 'BLOCKED', 'INCONCLUSIVE'] as const;
export type Verdict = (typeof VERDICTS)[number];
/** Why a frame's GPU reading is invalid (Frame budget: "unresolved, zero, reversed, or from work submitted before a device loss"). */
export const WHYS = ['unresolved', 'zero', 'reversed', 'device_lost'] as const;
/** The inclusive range a .. b. */
export const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ---------------------------------------------------------------------------------------------------
// Environment fingerprints, the shape of scripts/benchmark.mjs's fingerprint(), that `stub_environment` stands in
// with (README: Stubs).

export interface Fingerprint {
  model: string; chip: string; memoryBytes: number; power: 'ac' | 'battery';
  lowPowerMode: boolean; thermalState: 'nominal' | 'fair' | 'serious' | 'critical'; macosBuild: string;
}
/** A reference Mac (benchmark.mjs's first) on mains power, Low Power Mode off, thermal state nominal. */
export const REFERENCE: Fingerprint = {
  model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '25B78',
};
/** Another machine: a Mac that is none of the reference Macs, in the same conditions. */
export const OTHER_MACHINE: Fingerprint = { ...REFERENCE, model: 'Mac14,6', chip: 'Apple M2 Max', memoryBytes: 64 * 2 ** 30 };
/** The reference Mac on battery. */
export const ON_BATTERY: Fingerprint = { ...REFERENCE, power: 'battery' };

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
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
const numOrNull = (v: JsonValue | undefined, what: string): number | null => (v === null ? null : num(v, what));
const strOrNull = (v: JsonValue | undefined, what: string): string | null => (v === null ? null : str(v, what));
function oneOf<T extends string>(v: JsonValue | undefined, values: readonly T[], what: string): T {
  const s = str(v, what);
  expect(values, `${what} is one of ${values.join(', ')}`).toContain(s);
  return s as T;
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-gpu` with `test-meter` (the stubs and the planted programs' stubs), built once per file.

/** Builds the `test-meter` set once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useBuild(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1899-bin-'));
    const run = spawnSync('cargo', BUILD, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${BUILD.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    else copyFileSync(join(REPO, 'target', 'debug', process.platform === 'win32' ? `${BIN}.exe` : BIN), join(dir, BIN));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${BUILD.join(' ')}`).toBe('');
    return join(dir, BIN);
  };
}

/** A fresh output folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1899-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Running: `deep-gpu run --backend noop [--planted <name>]`, one scenario, one reply per call.

/** The wrong programs `--planted` reaches (README: Planted programs). */
export type Planted = 'repeats_last_reading' | 'drops_unresolved_frames' | 'ladder_acts_in_budget_run';

export function run(bin: string, out: string, calls: JsonObject[], planted?: Planted): JsonObject[] {
  const args = ['run', '--backend', 'noop', ...(planted ? ['--planted', planted] : [])];
  const shown = `${BIN} ${args.join(' ')}`;
  const s = spawnSync(bin, args, {
    cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL',
  });
  const timedOut = s.error !== undefined && (s.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(timedOut, `${shown} finished within its timeout`).toBe(false);
  if (s.error) throw Error(`${shown}: ${s.error.message}`);
  expect(s.status, `${shown} exited 0 (${s.signal ?? 'no signal'}); stdout: ${(s.stdout ?? '').slice(0, 1500)}; stderr: ${(s.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (s.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${shown}: one output line per input line`).toBe(1);
  let answer: JsonValue;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { answer = lines[0]!; }
  const a = obj(answer, `${shown}: the answer`);
  expect(a['ok'], `${shown} accepted the scenario: ${JSON.stringify(a).slice(0, 2000)}`).toBe(true);
  const replies = arr(a['replies'], `${shown}: replies`).map((r, i) => obj(r, `${shown}: replies[${i}]`));
  expect(replies.length, `${shown}: one reply per call`).toBe(calls.length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The document: a showpiece scene, the writer's payload as #393's deep_show takes it (the envelope and ID maps, no
// `id`, no `layers`), with a channel that slides a box over the whole span so every frame draws.

export const LOOK: JsonObject = JSON.parse(readFileSync(join(HERE, 'fixtures', 'look.json'), 'utf8')) as JsonObject;

/** Writes the showpiece under `dir` and returns its absolute path. */
export function showpiece(dir: string): string {
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'perspective', target: [0, 0, 0], orbit: { azimuth: 30, elevation: 35, distance: 14 }, fov: 40 } },
  };
  for (let i = 0; i < 4; i++) {
    items[`box-${i}`] = {
      id: `box-${i}`, kind: 'mark.box@1', name: `Box ${i}`, order: `b${String(i).padStart(3, '0')}`,
      params: { size: [1, 1, 1], paint: { fill: { role: 'accent' } } }, at: { pos: [i * 2.5 - 3.75, 0.5, 0] },
    };
  }
  const doc: JsonObject = {
    format: 1, profile: 'scene', title: 'A showpiece', description: 'A showpiece: a #1899 acceptance fixture.',
    size: PIXELS, camera: 'cam', requires: { modules: { scene3d: '^1' } }, budget: { class: 'showpiece' },
    transport: { span: '60s' }, items,
    channels: { slide: { target: 'items/box-0/at/pos/0', type: 'f32', keys: { k0: { t: '0s', value: -3.75, interp: 'linear' }, k1: { t: '60s', value: 3.75, interp: 'linear' } } } },
  };
  const path = join(dir, 'showpiece.json');
  writeFileSync(path, JSON.stringify(doc));
  return path;
}

// ---------------------------------------------------------------------------------------------------
// The `frame_budget` call (README: The frame_budget call).

/** A stub meter's readings for frames `from` … `to` (to the run's end when `to` is absent) of every run. */
export interface Entry { from: number; to?: number; gpu_ms: number; by_rung?: Record<string, number>; cpu_ms?: number; cpu_encode_ms?: number }
export interface StubMeter {
  timestamps?: boolean;
  frames: Entry[];
  unresolved?: number[];
  reversed?: number[];
  lose_device?: { frame: number; in_flight: number };
}
export interface StubTimer { p95_ms: number; spread_ms: number; seeds: number[] }
export interface BudgetSpec {
  doc: string;
  seconds: number;
  warmup?: number;
  report?: 'frames'[];
  stub_meter?: StubMeter;
  stub_timer?: StubTimer;
  stub_environment: Fingerprint;
}
export const budgetCall = (spec: BudgetSpec): JsonObject => {
  const { doc, seconds, ...rest } = spec;
  return { call: 'frame_budget', look: LOOK, writer: WRITER, doc, render: { seconds, pixels: PIXELS }, ...(rest as unknown as JsonObject) };
};

export interface Invalid { frame: number; why: string }
export interface Run { p95_ms: number | null; invalid: Invalid[] }
export interface Limit { limit_ms: number; verdict: Verdict; runs: Run[]; margin: number | null; missing: string | null }
export interface FrameRow { run: number; frame: number; rung: string; gpu_ms: number | null; invalid: string | null }
export interface Budget {
  verdict: Verdict;
  gpu: Limit;
  cpu: Limit;
  fallback: { source: string; runs: number[] } | null;
  frames: FrameRow[] | null;
}

/** A reply that is no refusal: `{code, …}` fails here, naming it. */
export function answered(reply: JsonObject, what: string): JsonObject {
  expect(reply['code'], `${what} is answered, not refused: ${JSON.stringify(reply).slice(0, 1500)}`).toBeUndefined();
  return reply;
}

function limitOf(v: JsonValue | undefined, at: string): Limit {
  const o = obj(v, at);
  return {
    limit_ms: num(o['limit_ms'], `${at}.limit_ms`),
    verdict: oneOf(o['verdict'], VERDICTS, `${at}.verdict`),
    runs: arr(o['runs'], `${at}.runs`).map((r, i) => {
      const x = obj(r, `${at}.runs[${i}]`);
      return {
        p95_ms: numOrNull(x['p95_ms'], `${at}.runs[${i}].p95_ms`),
        invalid: arr(x['invalid'], `${at}.runs[${i}].invalid`).map((f, j) => {
          const y = obj(f, `${at}.runs[${i}].invalid[${j}]`);
          return { frame: num(y['frame'], `${at}.runs[${i}].invalid[${j}].frame`), why: oneOf(y['why'], WHYS, `${at}.runs[${i}].invalid[${j}].why`) };
        }),
      };
    }),
    margin: numOrNull(o['margin'], `${at}.margin`),
    missing: o['missing'] === undefined ? null : strOrNull(o['missing'], `${at}.missing`),
  };
}

/** Parses one frame-budget result, failing at the first missing or mistyped field. */
export function budgetOf(reply: JsonObject, what: string): Budget {
  answered(reply, what);
  const limits = obj(reply['limits'], `${what}: limits`);
  const fb = reply['fallback'];
  const fallback = fb === null || fb === undefined ? null : (() => {
    const o = obj(fb, `${what}: fallback`);
    return {
      source: str(o['source'], `${what}: fallback.source`),
      runs: arr(o['runs'], `${what}: fallback.runs`).map((r, i) => num(obj(r, `${what}: fallback.runs[${i}]`)['p95_ms'], `${what}: fallback.runs[${i}].p95_ms`)),
    };
  })();
  const frames = reply['frames'] === undefined ? null : arr(reply['frames'], `${what}: frames`).map((f, i): FrameRow => {
    const o = obj(f, `${what}: frames[${i}]`);
    const at = `${what}: frames[${i}] (run ${o['run']} frame ${o['frame']})`;
    return {
      run: num(o['run'], `${at}.run`), frame: num(o['frame'], `${at}.frame`), rung: str(o['rung'], `${at}.rung`),
      gpu_ms: numOrNull(o['gpu_ms'], `${at}.gpu_ms`),
      invalid: o['invalid'] === null || o['invalid'] === undefined ? null : oneOf(o['invalid'], WHYS, `${at}.invalid`),
    };
  });
  return {
    verdict: oneOf(reply['verdict'], VERDICTS, `${what}: verdict`),
    gpu: limitOf(limits['gpu'], `${what}: limits.gpu`),
    cpu: limitOf(limits['cpu'], `${what}: limits.cpu`),
    fallback,
    frames,
  };
}

/** A stub-timer reply: one result per seed, in the order the call listed them. */
export function seedsOf(reply: JsonObject, seeds: number[], what: string): Budget[] {
  answered(reply, what);
  const rows = arr(reply['seeds'], `${what}: seeds`).map((r, i) => obj(r, `${what}: seeds[${i}]`));
  expect(rows.map((r) => r['seed']), `${what}: one result per seed, in order`).toEqual(seeds);
  return rows.map((r) => budgetOf(r, `${what}: seed ${r['seed']}`));
}

/** Each timed run's GPU p95, which every run of a complete result carries. */
export function p95s(limit: Limit, what: string): number[] {
  expect(limit.runs.length, `${what}: the five runs are attached`).toBe(RUNS);
  return limit.runs.map((r, i) => {
    expect(r.p95_ms, `${what}: run ${i + 1} carries its p95`).not.toBeNull();
    return r.p95_ms!;
  });
}

// ---------------------------------------------------------------------------------------------------
// The design's five-run rule (Every task carries its own budgets; scripts/benchmark.mjs's judgeLimit on a reference
// Mac): PASS when all five are within the limit, FAIL when all five are over it by more than the margin, the larger
// of 5% and the five runs' spread as a fraction of the limit, else INCONCLUSIVE.

export function fiveRunRule(runs: number[], limit: number): { verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; margin: number } {
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
  if (runs.every((r) => r <= limit)) return { verdict: 'PASS', margin };
  if (runs.every((r) => r > limit * (1 + margin))) return { verdict: 'FAIL', margin };
  return { verdict: 'INCONCLUSIVE', margin };
}

// ---------------------------------------------------------------------------------------------------
// The rung log: every frame the run drew, warm-up (run 0) and the five timed runs (1–5), at the class's base rung.

/** One sentence per rung below or above base the log shows, naming it and where it first appears; and any frame with no row. */
export function rungProblems(frames: FrameRow[], warmup: number, perRun: number): string[] {
  const out: string[] = [];
  const first = new Map<string, FrameRow>();
  const seen = new Set<string>();
  for (const f of frames) {
    seen.add(`${f.run}:${f.frame}`);
    if (f.rung !== 'base' && !first.has(f.rung)) first.set(f.rung, f);
  }
  for (const [rung, f] of first) out.push(`the rung log shows ${rung} from run ${f.run} frame ${f.frame}, not the class's base rung`);
  for (let r = 0; r <= RUNS; r++) {
    const n = r === 0 ? warmup : perRun;
    const missing = range(0, n - 1).find((k) => !seen.has(`${r}:${k}`));
    if (missing !== undefined) out.push(`the rung log has no row for run ${r} frame ${missing}`);
  }
  return out;
}
