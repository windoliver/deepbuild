// Test-side tools for the #854 acceptance tests: the four perf-lane tasks run as the lane runs them (`node
// benchmarks/canvas.mjs <task> [--planted <name>]`, the report its last stdout line), the lane's judge (`node
// benchmarks/canvas.mjs judge`), the reports' shapes checked field by field, readings within every target made
// up for the judge, the reference-Mac gate and the design's judge for timing results (five runs after warm-up).
// Nothing here stands in for a task, the judge, deep_query, the tokenizer, the frame clock or the replica.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/854 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const BENCH = join(REPO, 'benchmarks', 'canvas.mjs');

// ---------------------------------------------------------------------------------------------------
// The issue's numbers and the surface's names (README: The surface under test).

/** The board both the patch task and the scene read run on: "a 10,000-item board". */
export const ITEMS = 10_000;
/** "200 patches" a run; "one paged read of 1,000 rows"; "a still document for 60 s". */
export const PATCHES = 200;
export const PAGE_ROWS = 1_000;
export const IDLE_SECONDS = 60;
/** "A timing result comes from five runs after warm-up." */
export const RUNS = 5;

export const TASKS = {
  patch: { id: 'canvas-patch-settled', mode: 'patch-settled', planted: 'runs_every_node', targets: { settled_p95_ms: 4 } },
  read: { id: 'canvas-scene-read', mode: 'scene-read', planted: 'unpaged', targets: { summary_ms: 20, summary_tokens: 2_000, page_ms: 50, page_rows: PAGE_ROWS } },
  idle: { id: 'canvas-idle', mode: 'idle', planted: 'arms_each_vsync', targets: { frames: 0, wakeups: 1, cpu_fraction: 0.001 } },
  replica: { id: 'replica-cold-start', mode: 'replica-cold-start', planted: 'compiles_on_first_frame', targets: { first_settled_ms: 300 } },
} as const;
export type TaskKey = keyof typeof TASKS;
export const TASK_KEYS = Object.keys(TASKS) as TaskKey[];
/** Targets that are counts, judged on any machine (README: The judge); the rest are timings and readings of the process. */
export const COUNT_TARGETS = ['summary_tokens', 'page_rows', 'frames'] as const;
/** The agent adapters whose facts may name the tokenizer. */
export const AGENT_ADAPTERS = ['claude-code', 'codex', 'pi'] as const;

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
export function int(value: JsonValue | undefined, what: string): number {
  expect(Number.isSafeInteger(value) && (value as number) >= 0, `${what} is a whole number, got ${JSON.stringify(value)?.slice(0, 200)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value === 'string' && value !== '', `${what} is a non-empty string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe(true);
  return value as string;
}
export const readJson = (path: string): JsonValue => JSON.parse(readFileSync(path, 'utf8')) as JsonValue;

/** The nearest-rank percentile the perf lane uses (scripts/benchmark.mjs `summarize`). */
export function percentile(xs: readonly number[], p: number): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]!;
}

/**
 * A pattern for a whole number as a reason may print it: digits, or digits grouped by threes with a comma, a
 * space, a thin space or an underscore; never part of a longer number.
 */
export function numberPattern(n: number): RegExp {
  const s = String(Math.trunc(n));
  const head = s.length % 3 || 3;
  const groups = [s.slice(0, head)];
  for (let i = head; i < s.length; i += 3) groups.push(s.slice(i, i + 3));
  return RegExp(`(?<![\\d.])${groups.join('[,_ \\u2009\\u202f]?')}(?![\\d])`);
}
export const mentions = (text: string, n: number): boolean => numberPattern(n).test(text);

// ---------------------------------------------------------------------------------------------------
// The lane: a task's run and the judge.

export interface Recorded { report: JsonObject; ms: number }

/** `node benchmarks/canvas.mjs <mode> [--planted <name>]`: exits 0 and prints its report, for its task, as the last stdout line. */
export function record(key: TaskKey, planted = false): Recorded {
  const task = TASKS[key];
  const args = [BENCH, task.mode, ...(planted ? ['--planted', task.planted] : [])];
  const shown = `node benchmarks/canvas.mjs ${args.slice(1).join(' ')}`;
  const began = performance.now();
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', timeout: 3_600_000, killSignal: 'SIGKILL', maxBuffer: 512 * 1024 * 1024 });
  const ms = performance.now() - began;
  expect(r.error, `${shown} ran: ${r.error?.message}`).toBeUndefined();
  expect(r.status, `${shown} exits 0; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l.trim() !== '');
  let last: JsonValue = null;
  try { last = lines.length ? (JSON.parse(lines.at(-1)!) as JsonValue) : null; } catch { last = null; }
  const report = obj(last ?? undefined, `${shown}: its report (the last stdout line)`);
  expect(report['task'], `${shown}: the report names its budgets.json task`).toBe(task.id);
  return { report, ms };
}

/** `node benchmarks/canvas.mjs judge` with `{"current": report, "base": null}` on stdin: exits 0 and prints its verdict as the last stdout line. */
export function judged(report: JsonObject): JsonObject {
  const r = spawnSync(process.execPath, [BENCH, 'judge'], { cwd: REPO, encoding: 'utf8', timeout: 600_000, maxBuffer: 512 * 1024 * 1024, input: `${JSON.stringify({ current: report, base: null })}\n` });
  expect(r.error, `canvas.mjs judge ran: ${r.error?.message}`).toBeUndefined();
  expect(r.status, `canvas.mjs judge exits 0 on a ${String(report['task'])} report; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l.trim() !== '');
  let last: JsonValue = null;
  try { last = lines.length ? (JSON.parse(lines.at(-1)!) as JsonValue) : null; } catch { last = null; }
  const verdict = obj(last ?? undefined, 'the judge\'s verdict (its last stdout line)');
  expect(verdict['task'], 'the verdict names the task it judged').toBe(report['task']);
  return verdict;
}

/** The verdict's judgment of one target: its status and the five numbers it judged. */
export function targetOf(verdict: JsonObject, name: string): { status: string; limit: number; runs: number[] } {
  const t = obj(obj(verdict['targets'], 'verdict.targets')[name], `verdict.targets.${name}`);
  return { status: str(t['status'], `${name}.status`), limit: num(t['limit'], `${name}.limit`), runs: arr(t['runs'], `${name}.runs`).map((v, i) => num(v, `${name}.runs[${i}]`)) };
}

/** The checks every report must pass: the fingerprint with a release build, and five runs. */
export function commonRuns(report: JsonObject, what: string): JsonObject[] {
  const fp = obj(report['fingerprint'], `${what}: fingerprint`);
  for (const key of ['model', 'chip', 'macosBuild']) str(fp[key], `${what}: fingerprint.${key}`);
  const build = obj(fp['build'], `${what}: fingerprint.build (the build profile in its fingerprint)`);
  expect(build['profile'], `${what}: its timings come from a release build`).toBe('release');
  expect(str(build['toolchain'], `${what}: fingerprint.build.toolchain`), `${what}: the toolchain as rustc -V prints it`).toMatch(/^rustc \d+\.\d+\.\d+/);
  const runs = arr(report['runs'], `${what}: runs`);
  expect(runs.length, `${what}: five runs after warm-up`).toBe(RUNS);
  return runs.map((r, i) => obj(r, `${what}: runs[${i}]`));
}

// ---------------------------------------------------------------------------------------------------
// Readings made up for the judge, on a reference Mac's fingerprint, within every target unless changed.

export const TOOLCHAIN = 'rustc 1.99.1 (58cf8f9c3 2026-10-13)';
export function referenceFingerprint(profile: string | null): JsonObject {
  return {
    model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '25G241',
    ...(profile === null ? {} : { build: { profile, toolchain: TOOLCHAIN } }),
  };
}

export interface PatchSample { patch: number; item: string; frame: number; cpu_ms: number; gpu_ms: number; ms: number; ran: Record<string, number> }

/** A patch-settled run: 200 samples of `ms` (split 3:1 CPU:GPU), each its own frame, running `ran`. */
export function patchRun(run: number, msOf: (patch: number) => number, ranOf: (patch: number) => Record<string, number>): JsonObject {
  const samples: PatchSample[] = Array.from({ length: PATCHES }, (_, k) => {
    const ms = msOf(k + 1);
    return { patch: k + 1, item: `r${String(k).padStart(5, '0')}`, frame: 100 * run + 2 * (k + 1), cpu_ms: ms * 0.75, gpu_ms: ms * 0.25, ms, ran: ranOf(k + 1) };
  });
  return { p95_ms: percentile(samples.map((s) => s.ms), 0.95), samples: samples as unknown as JsonValue[] };
}

/** The tokenizer the first agent adapter's facts pin, as a report names it; a made-up one where none is pinned. */
function pinnedTokenizer(): JsonObject {
  for (const adapter of AGENT_ADAPTERS) {
    try {
      const t = (readJson(join(REPO, 'adapters', `${adapter}.facts.json`)) as JsonObject)['tokenizer'];
      if (isObject(t) && typeof t['name'] === 'string' && typeof t['version'] === 'string') return { adapter, name: t['name'], version: t['version'] };
    } catch { /* no facts file */ }
  }
  return { adapter: 'claude-code', name: 'made-up', version: '1.0.0' };
}

/** A reading of `key`'s task within every target, on a reference Mac's fingerprint whose build is `profile` (none when null). */
export function synthetic(key: TaskKey, profile: string | null = 'release'): JsonObject {
  const base = { task: TASKS[key].id, fingerprint: referenceFingerprint(profile) };
  const five = <T>(make: (run: number) => T): T[] => Array.from({ length: RUNS }, (_, i) => make(i + 1));
  switch (key) {
    case 'patch':
      return { ...base, items: ITEMS, patches: PATCHES, runs: five((r) => patchRun(r, () => 1, () => ({ 'core.transform': 1, 'marks2d.frame': 1 }))) };
    case 'read':
      return { ...base, items: ITEMS, tokenizer: pinnedTokenizer(),
        runs: five(() => ({ summary: { ms: 5, tokens: 800, bytes: 3_200, rows: 0 }, page: { ms: 20, tokens: 30_000, bytes: 120_000, rows: PAGE_ROWS, next: 'c1000' } })) };
    case 'idle':
      return { ...base, fixture: 'benchmarks/canvas/figure.json', seconds: IDLE_SECONDS,
        runs: five(() => ({ opened_frames: 1, seconds: 60.01, frames: 0, drawn: [], wakeups: 0, cpu_ms: 6, cpu_fraction: 6 / 60_010 })) };
    case 'replica':
      return { ...base, fixture: 'benchmarks/canvas/figure.json',
        runs: five(() => ({ ms: 150, pipelines: [{ name: 'marks2d.fill', on_first_frame: false }, { name: 'text.glyphs', on_first_frame: false }] })) };
  }
}

// ---------------------------------------------------------------------------------------------------
// The reference-Mac gate and the design's judge for timing results.

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/** The tasks draw on macOS's Metal device: elsewhere a test can't run them and skips as INCONCLUSIVE. */
export function requireMac(ctx: TestContext): void {
  if (process.platform !== 'darwin') ctx.skip(`INCONCLUSIVE: the tasks draw on macOS's Metal device; this is ${process.platform}`);
}

/**
 * Why this machine can't judge a timing, or null on a reference Mac. As #379's and #857's gates, power, Low
 * Power Mode, heat and load aren't gated here (the owner's rule); they're printed beside each result.
 */
export function referenceMacProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  return null;
}
export function machineReading(): string {
  const read = (cmd: string, ...args: string[]): string => { try { return sh(cmd, ...args).replace(/\s+/g, ' '); } catch { return 'unknown'; } };
  return `power: ${read('pmset', '-g', 'batt').split(';')[0]}; ${/lowpowermode\s+\d/.exec(read('pmset', '-g'))?.[0] ?? 'lowpowermode unknown'}; load: ${read('sysctl', '-n', 'vm.loadavg')}`;
}

/** The margin: the larger of 5% and the five runs' spread, as a fraction of the limit (scripts/benchmark.mjs `judgeLimit`). */
const marginOf = (runs: readonly number[], limit: number): number => Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
const shownOf = (name: string, runs: readonly number[], limit: number, margin: number): string =>
  `${name}: ${runs.map((r) => r.toFixed(4)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%); ${machineReading()}`;

/** The design's rule: PASS when all five runs are within the limit; FAIL when all five are over it by more than the margin; else INCONCLUSIVE (a skip that says so, never a pass). */
export function judgeWithin(ctx: TestContext, name: string, runs: readonly number[], limit: number): void {
  expect(runs.length, `${name}: five runs`).toBe(RUNS);
  const margin = marginOf(runs, limit);
  const shown = shownOf(name, runs, limit, margin);
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}

/** The same rule for a planted program that must push a timing past its limit: caught when all five are over it by more than the margin; FAIL when all five are within; else INCONCLUSIVE. */
export function judgeOver(ctx: TestContext, name: string, runs: readonly number[], limit: number): void {
  expect(runs.length, `${name}: five runs`).toBe(RUNS);
  const margin = marginOf(runs, limit);
  const shown = shownOf(name, runs, limit, margin);
  console.log(shown);
  if (runs.every((r) => r > limit * (1 + margin))) return;
  expect(runs.every((r) => r <= limit), `FAIL (the planted program stayed within the limit) ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}

/**
 * The lane's verdict on a real run, on a reference Mac: `want` it must reach. A verdict that is INCONCLUSIVE
 * because the run's conditions (mains power, Low Power Mode, heat) kept it a reading skips as INCONCLUSIVE.
 */
export function laneVerdict(ctx: TestContext, verdict: JsonObject, want: 'PASS' | 'FAIL'): void {
  const status = str(verdict['status'], 'verdict.status');
  const shown = JSON.stringify(verdict).slice(0, 3000);
  if (status === 'INCONCLUSIVE' && /power|Low Power Mode|thermal/.test(String(verdict['reason'] ?? shown))) ctx.skip(`INCONCLUSIVE (the lane kept it a reading): ${shown}`);
  expect(status, `the lane's verdict is ${want}: ${shown}`).toBe(want);
}
