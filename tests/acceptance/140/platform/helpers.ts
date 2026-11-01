// Test-side tools for #140's platform-group acceptance tests (criteria 12, 13, 14 and 18): `deep-show` built once
// per Cargo feature set and driven by one JSON scenario on stdin (`deep-show run`, #393's convention); the local
// preflight's lanes read from scripts/lanes.mjs; cargo metadata; the reference-Mac gate and the design's judge for
// timing results. Nothing here stands in for a seam, a backend, a suite, the question card or the wasm32 build.

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect, type TestContext } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type Rect = [number, number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/140/platform is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

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
  expect(typeof value, `${what} is a string, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('string');
  return value as string;
}
export function bool(value: JsonValue | undefined, what: string): boolean {
  expect(typeof value, `${what} is a boolean, got ${JSON.stringify(value)?.slice(0, 600)}`).toBe('boolean');
  return value as boolean;
}
export function rect(value: JsonValue | undefined, what: string): Rect {
  const r = arr(value, what).map((v, i) => num(v, `${what}[${i}]`));
  expect(r.length, `${what} is [x, y, w, h]`).toBe(4);
  return r as Rect;
}
/** A backend as every result names it: `{name, version}`, both non-empty. */
export function backendOf(value: JsonValue | undefined, what: string): { name: string; version: string } {
  const b = obj(value, what);
  const name = str(b['name'], `${what}.name`);
  const version = str(b['version'], `${what}.version`);
  expect(name.length > 0 && version.length > 0, `${what} names the backend and its version: ${JSON.stringify(b)}`).toBe(true);
  return { name, version };
}

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` once per Cargo feature set, copied out of target/debug under its own name (#377's and #305's
// suites build theirs the same way); a test that uses a build that failed fails with cargo's error.

/** `default` is the shipped build; `test-window` adds the test window backend (README: The surface under test). */
export type ShowBuild = 'default' | 'test-window';
const featuresOf = (build: ShowBuild): string[] => (build === 'default' ? [] : [build]);

function cargo(args: string[], cwd = REPO, env: NodeJS.ProcessEnv = process.env): { status: number | null; stderr: string; stdout: string } {
  const run = spawnSync('cargo', args, { cwd, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error) return { status: null, stderr: `cargo could not run: ${run.error.message}`, stdout: '' };
  return { status: run.status, stderr: run.stderr ?? '', stdout: run.stdout ?? '' };
}
/** cargo's stderr without its progress lines, for a failure message. */
export const cargoErrors = (stderr: string, max = 4000): string =>
  stderr.split('\n').filter((l) => !/Blocking waiting|^\s*Compiling|^\s*Finished|^\s*Downloaded|^\s*Downloading|^\s*Checking|^\s*Locking|^\s*Updating/.test(l)).join('\n').slice(-max);

/** Builds a binary of this checkout; '' when it built, else cargo's error. */
export function buildBins(bins: string[], features: string[] = [], cwd = REPO): string {
  const args = ['build', '--locked', ...bins.flatMap((b) => ['--bin', b]), ...(features.length ? ['--features', features.join(',')] : [])];
  // Each checkout builds into its own target folder, where its scripts look for the binaries.
  const env = { ...process.env };
  delete env['CARGO_TARGET_DIR'];
  const r = cargo(args, cwd, env);
  return r.status === 0 ? '' : `cargo ${args.join(' ')} failed:\n${cargoErrors(r.stderr)}`;
}

export interface Shows { bin: (build?: ShowBuild) => string }
/** `deep-show` in every listed build, each built once before the file's tests and kept under its own name. */
export function useShow(builds: readonly ShowBuild[] = ['default']): Shows {
  let dir = '';
  const made = new Map<ShowBuild, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-140-platform-bins-'));
    for (const build of builds) {
      if (made.has(build)) continue;
      const error = buildBins(['deep-show'], featuresOf(build));
      const bin = join(dir, exe(`deep-show-${build}`));
      if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe('deep-show')), bin);
      made.set(build, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(build: ShowBuild = 'default'): string {
      const entry = made.get(build);
      if (!entry) throw Error(`the file didn't list the build ${build} in useShow`);
      expect(entry.error, `the binary builds: cargo build --locked --bin deep-show${featuresOf(build).length ? ` --features ${featuresOf(build).join(',')}` : ''}`).toBe('');
      return entry.bin;
    },
  };
}

/** A fresh evidence folder per test, deleted after it. */
export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-140-platform-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** One `deep-show run [--planted <name>]`: exit 0 and an `ok` answer with one reply per call, or the test fails. */
export function runShow(bin: string, scenario: JsonObject, what: string, planted?: string, timeoutMs = 1_200_000): JsonObject[] {
  const args = ['run', ...(planted ? ['--planted', planted] : [])];
  const label = `deep-show ${args.join(' ')}`;
  const r = spawnSync(bin, args, {
    cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL',
  });
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') expect.fail(`${what}: ${label} did not finish within ${timeoutMs} ms`);
  expect(r.status, `${what}: ${label} exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 800)}; stderr: ${(r.stderr ?? '').slice(-2000)}`).toBe(0);
  const out = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: ${label} writes one line for the one scenario`).toBe(1);
  const answer = obj(JSON.parse(out[0]!) as JsonValue, `${what}: the answer`);
  expect(answer['ok'], `${what}: ${label} answers the scenario ok (README: The surface under test); got ${JSON.stringify(answer).slice(0, 800)}`).toBe(true);
  const replies = arr(answer['replies'], `${what}: replies`).map((x, i) => obj(x, `${what}: replies[${i}]`));
  expect(replies.length, `${what}: one reply per call`).toBe(arr(scenario['calls'], 'calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The local preflight's lanes (scripts/lanes.mjs `checks`) and plain commands

export interface Lane { name: string; commands: string[][]; paths?: unknown }
export async function lanes(): Promise<Lane[]> {
  const { checks } = (await import('../../../../scripts/lanes.mjs')) as unknown as { checks: Lane[] };
  return checks;
}

export interface Ran { status: number | null; signal: string | null; stdout: string; stderr: string; ms: number; timedOut: boolean }
/** Runs one command in the checkout (or `cwd`), timing it by the wall clock. */
export function runCommand(argv: string[], cwd = REPO, timeoutMs = 1_800_000, env: NodeJS.ProcessEnv = process.env): Ran {
  const began = performance.now();
  const r = spawnSync(argv[0]!, argv.slice(1), { cwd, env, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const ms = performance.now() - began;
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) return { status: null, signal: null, stdout: '', stderr: `${argv.join(' ')} could not run: ${r.error.message}`, ms, timedOut };
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ms, timedOut };
}
/** The last non-empty stdout line as JSON, or null. */
export function lastJson(stdout: string): JsonValue | null {
  const ls = stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  try { return ls.length ? (JSON.parse(ls.at(-1)!) as JsonValue) : null; } catch { return null; }
}

// ---------------------------------------------------------------------------------------------------
// cargo metadata

interface Package { id: string; name: string; source: string | null; manifest_path: string }
export interface Metadata { packages: Package[]; workspace_members: string[] }
export function metadata(): Metadata {
  const r = cargo(['metadata', '--locked', '--no-deps', '--format-version', '1']);
  expect(r.status, `cargo metadata --locked runs: ${cargoErrors(r.stderr, 2000)}`).toBe(0);
  return JSON.parse(r.stdout) as Metadata;
}

// ---------------------------------------------------------------------------------------------------
// Timing: the reference-Mac gate and the design's judge (technical design: Every task carries its own budgets; The
// reference Macs), with #105's load gate.

const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why a timing here would be a reading, not a budget result; null on a reference Mac fit to judge. */
export function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = sh('pmset', '-g', 'batt');
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  const [one] = loadavg();
  if (one! > availableParallelism()) return `loaded past its core count: 1-minute load ${one!.toFixed(1)} on ${availableParallelism()} cores`;
  return null;
}

export type Judged = { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; shown: string };
const marginOf = (runs: number[]): number => Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
/** The design's rule on five runs after warm-up: PASS all within the limit, FAIL all over it by more than the margin (the larger of 5% and their spread), else INCONCLUSIVE. */
export function judgeRuns(name: string, runs: number[], limit: number): Judged {
  const margin = marginOf(runs);
  const shown = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit.toFixed(3)} (margin ${(margin * 100).toFixed(0)}%)`;
  if (runs.length !== 5) return { status: 'INCONCLUSIVE', shown: `${shown}: not five runs` };
  if (runs.every((r) => r <= limit)) return { status: 'PASS', shown };
  if (runs.every((r) => r > limit * (1 + margin))) return { status: 'FAIL', shown };
  return { status: 'INCONCLUSIVE', shown };
}
/** Applies several judgements to one test: any FAIL fails it, else any INCONCLUSIVE skips it as INCONCLUSIVE, else it passes. */
export function settle(ctx: TestContext, judged: Judged[]): void {
  for (const j of judged) console.log(`${j.status} ${j.shown}`);
  const failed = judged.filter((j) => j.status === 'FAIL');
  expect(failed.map((j) => j.shown), 'no budget is judged FAIL').toEqual([]);
  const open = judged.filter((j) => j.status === 'INCONCLUSIVE');
  if (open.length) ctx.skip(`INCONCLUSIVE ${open.map((j) => j.shown).join('; ')}`);
}
export const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
