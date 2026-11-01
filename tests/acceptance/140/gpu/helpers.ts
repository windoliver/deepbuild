// Test-side tools for #140's GPU-seam acceptance tests (criteria 1, 5, 9, 11, 16, 17, 19, 20, 21, 22): #377's
// `deep-gpu` built per Cargo feature set (the shipped build and `test-seam`), driven by JSON lines; the replies of
// the calls this suite adds (README: The surface under test), each read strictly so a missing field fails naming it;
// `deep-app`'s two live report lines; the checks the criteria's planted programs must fail, each returning its
// failures as sentences naming what failed; and the platform gate. Nothing here stands in for the seam, the backend,
// the feature table, the quirk table, the validation lane or the app under test.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/140/gpu is four levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
export const BIN = 'deep-gpu';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
/** A startup the binary refuses as input (an unknown argument, planted name or withheld feature) exits 2 after one line (#377). */
export const BAD_INPUT_EXIT = 2;
/** A startup the seam refuses (an adapter missing a required feature) exits 1 after one line, as #377's `no_device` does. */
export const REFUSED_EXIT = 1;

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
export function strs(value: JsonValue | undefined, what: string): string[] {
  return arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
}
export function bool(value: JsonValue | undefined, what: string): boolean {
  expect(typeof value, `${what} is a boolean, got ${JSON.stringify(value)}`).toBe('boolean');
  return value as boolean;
}
export const shown = (v: JsonValue | undefined): string => (JSON.stringify(v) ?? 'undefined').slice(0, 2000);
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------------------------------
// Builds: one `deep-gpu` per Cargo feature set, built once per file, each copied out under its own name.

/** `default` is the shipped build; `test-seam` adds the test adapters, the test quirk table and the test fixtures (README: Builds). */
export type Build = 'default' | 'test-seam';
const featuresOf = (build: Build): string[] => (build === 'default' ? [] : [build]);
const cargoEnv = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };

function cargo(args: string[]): string {
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', env: cargoEnv, maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

export interface Bins { bin: (build?: Build) => string }

/** Builds every listed set once, before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useBuilds(builds: readonly Build[]): Bins {
  let dir = '';
  const made = new Map<Build, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-140-gpu-bins-'));
    for (const build of builds) {
      if (made.has(build)) continue;
      const features = featuresOf(build);
      const error = cargo(['build', '--locked', '--bin', BIN, ...(features.length ? ['--features', features.join(',')] : [])]);
      const bin = join(dir, `${BIN}-${build}`);
      if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(BIN)), bin);
      made.set(build, { bin, error });
    }
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return {
    bin(build: Build = 'default'): string {
      const entry = made.get(build);
      if (!entry) throw Error(`the file didn't list the build ${build} in useBuilds`);
      const features = featuresOf(build);
      expect(entry.error, `the binary builds: cargo build --locked --bin ${BIN}${features.length ? ` --features ${features.join(',')}` : ''}`).toBe('');
      return entry.bin;
    },
  };
}

/** `deep-app`, built once for a live file and copied out (README: The live runs). */
export function buildApp(): { bin: string; error: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'deep-140-gpu-app-'));
  const error = cargo(['build', '--locked', '-p', 'deep-app']);
  const bin = join(dir, exe('deep-app'));
  if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe('deep-app')), bin);
  return { bin, error, dir };
}

// ---------------------------------------------------------------------------------------------------
// Temporary folders: an output folder per test, deleted after it.

export function useOut(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-140-gpu-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** Writes a JSON file into the test's output folder and returns its path. */
export function writeJson(dir: string, name: string, value: JsonValue): string {
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

// ---------------------------------------------------------------------------------------------------
// Starting the binary: `deep-gpu run [startup] `, one scenario line in, one line out (#377's convention).

export interface Startup {
  planted?: Planted;
  /** `--withhold <feature>`, once per feature: withheld at device creation on the same adapter. */
  withhold?: string[];
  /** `--adapters <file>` (test-seam): the test adapters the seam enumerates instead of the platform's. */
  adapters?: string;
  /** `--quirks <file>` (test-seam): the quirk table the seam reads instead of the shipped one. */
  quirks?: string;
  /** `--validation`: the validation lane's run (README: The validation lane). */
  validation?: boolean;
}

/** The wrong programs this suite adds, each reachable only through `--planted` (README: Planted programs). */
export type Planted = 'withholds_in_code' | 'picks_first_adapter' | 'installs_stale_pipelines' | 'reads_past_buffer' | 'writes_nan' | 'reads_pixels_only';

export const startArgs = (s: Startup = {}): string[] => [
  'run',
  ...(s.adapters ? ['--adapters', s.adapters] : []),
  ...(s.quirks ? ['--quirks', s.quirks] : []),
  ...(s.withhold ?? []).flatMap((f) => ['--withhold', f]),
  ...(s.validation ? ['--validation'] : []),
  ...(s.planted ? ['--planted', s.planted] : []),
];

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }

export function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 1_800_000, env: NodeJS.ProcessEnv = process.env): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const r = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', env, maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${BIN} ${args.join(' ')}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, signal: r.signal, timedOut, lines, stdout, stderr: r.stderr ?? '' };
}

/** One scenario, accepted, with one reply per call, every call in one process on the app's one device. */
export function run(bin: string, out: string, calls: JsonObject[], startup: Startup = {}, timeoutMs?: number): JsonObject[] {
  const args = startArgs(startup);
  const s = start(bin, args, [{ out, calls }], timeoutMs);
  const named = `${BIN} ${args.join(' ')}`;
  expect(s.timedOut, `${named} finished within its timeout`).toBe(false);
  expect(s.status, `${named} exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(-3000)}`).toBe(0);
  expect(s.lines.length, `${named}: one output line per input line`).toBe(1);
  const answer = obj(s.lines[0], `${named}: the answer`);
  expect(answer['ok'], `${named} refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], `${named}: replies`).map((r, i) => obj(r, `${named}: replies[${i}]`));
  expect(replies.length, `${named}: one reply per call`).toBe(calls.length);
  replies.forEach((r, i) => {
    expect(r['code'] === 'bad_input' || r['code'] === 'unsupported_platform', `${named}: call ${shown(calls[i])} was answered ${shown(r)}`).toBe(false);
  });
  return replies;
}
/** One call in its own process. */
export const run1 = (bin: string, out: string, call: JsonObject, startup: Startup = {}): JsonObject => run(bin, out, [call], startup)[0]!;

/** This suite needs Metal: off macOS it fails INCONCLUSIVE, never passing by skipping. */
export function requireMac(): void {
  if (process.platform !== 'darwin') expect.fail(`INCONCLUSIVE: the GPU seam's macOS backend needs macOS with Metal; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// The `adapter` call (#379's, extended: README, The feature table and the adapter)

export interface Row { feature: string; wgpu: string[]; required: boolean; fallback: string | null; fixtures: string[] }
export interface AdapterReply {
  raw: JsonObject;
  seam: { name: string; version: string };
  adapter: { name: string; vendor: number; device: number; driver: string; type: string; memory: number; test: boolean };
  tier: string; table: Row[]; reported: string[]; granted: string[]; withheld: string[]; quirks: string;
}

export function adapterReply(r: JsonObject, what = 'the adapter call'): AdapterReply {
  const seam = obj(r['seam'], `${what}: seam`);
  const a = obj(r['adapter'], `${what}: adapter`);
  const table = arr(r['table'], `${what}: table`).map((v, i) => {
    const row = obj(v, `${what}: table[${i}]`);
    const fallback = row['fallback'];
    expect(fallback === null || typeof fallback === 'string', `${what}: table[${i}].fallback is a name or null, got ${shown(fallback)}`).toBe(true);
    return {
      feature: str(row['feature'], `${what}: table[${i}].feature`),
      wgpu: strs(row['wgpu'], `${what}: table[${i}].wgpu`),
      required: bool(row['required'], `${what}: table[${i}].required`),
      fallback: fallback as string | null,
      fixtures: strs(row['fixtures'], `${what}: table[${i}].fixtures`),
    };
  });
  return {
    raw: r,
    seam: { name: str(seam['name'], `${what}: seam.name`), version: str(seam['version'], `${what}: seam.version`) },
    adapter: {
      name: str(a['name'], `${what}: adapter.name`), vendor: num(a['vendor'], `${what}: adapter.vendor`), device: num(a['device'], `${what}: adapter.device`),
      driver: str(a['driver'], `${what}: adapter.driver`), type: str(a['type'], `${what}: adapter.type`), memory: num(a['memory'], `${what}: adapter.memory`),
      test: bool(a['test'], `${what}: adapter.test`),
    },
    tier: str(r['tier'], `${what}: tier`),
    table,
    reported: strs(r['reported'], `${what}: reported`),
    granted: strs(r['granted'], `${what}: granted`),
    withheld: strs(r['withheld'], `${what}: withheld`),
    quirks: str(obj(r['quirks'], `${what}: quirks`)['digest'], `${what}: quirks.digest`),
  };
}
export const ADAPTER: JsonObject = { call: 'adapter' };

// ---------------------------------------------------------------------------------------------------
// The `gated` call: one table feature's fixtures on this device (README: Gated fixtures)

export interface Receipt { gpu: { name: string; version: string }; adapter: string; quirks: string }
export interface GatedFixture { fixture: string; result: string; took: string; content_key: string; receipt: Receipt; reason: string | null }
export interface GatedReply { raw: JsonObject; feature: string; granted: boolean; took: string; fixtures: GatedFixture[] }

export function receiptOf(v: JsonValue | undefined, what: string): Receipt {
  const r = obj(v, what);
  const gpu = obj(r['gpu'], `${what}.gpu`);
  return {
    gpu: { name: str(gpu['name'], `${what}.gpu.name`), version: str(gpu['version'], `${what}.gpu.version`) },
    adapter: str(obj(r['adapter'], `${what}.adapter`)['name'], `${what}.adapter.name`),
    quirks: str(r['quirks'], `${what}.quirks`),
  };
}

export function gatedReply(r: JsonObject, what = 'the gated call'): GatedReply {
  const fixtures = arr(r['fixtures'], `${what}: fixtures`).map((v, i) => {
    const f = obj(v, `${what}: fixtures[${i}]`);
    const reason = f['reason'];
    return {
      fixture: str(f['fixture'], `${what}: fixtures[${i}].fixture`),
      result: str(f['result'], `${what}: fixtures[${i}].result`),
      took: str(f['took'], `${what}: fixtures[${i}].took`),
      content_key: str(f['content_key'], `${what}: fixtures[${i}].content_key`),
      receipt: receiptOf(f['receipt'], `${what}: fixtures[${i}].receipt`),
      reason: typeof reason === 'string' ? reason : null,
    };
  });
  return { raw: r, feature: str(r['feature'], `${what}: feature`), granted: bool(r['granted'], `${what}: granted`), took: str(r['took'], `${what}: took`), fixtures };
}
export const gatedCall = (feature: string): JsonObject => ({ call: 'gated', feature });

// ---------------------------------------------------------------------------------------------------
// Test adapters and quirk tables (test-seam: README, Test adapters and the quirk table)

export interface TestAdapter { name: string; type: 'integrated_gpu' | 'discrete_gpu'; vendor: number; device: number; driver: string; memory: number; features: string[] }
export const adaptersFile = (dir: string, name: string, adapters: TestAdapter[]): string => writeJson(dir, name, { adapters: adapters as unknown as JsonValue });

export interface QuirkRow { backend: string; match: { vendor?: number; device?: number; driver?: string }; withholds?: string; workaround?: string; reason: string }
export const quirksFile = (dir: string, name: string, rows: QuirkRow[]): string => writeJson(dir, name, { rows: rows as unknown as JsonValue });

/** The rows of a quirk table that match an adapter, by its vendor, device and driver version. */
export function matching(rows: QuirkRow[], a: { vendor: number; device: number; driver: string }): QuirkRow[] {
  return rows.filter((r) => (r.match.vendor === undefined || r.match.vendor === a.vendor)
    && (r.match.device === undefined || r.match.device === a.device)
    && (r.match.driver === undefined || r.match.driver === a.driver));
}

/**
 * Criterion 16's check: every feature of the tier the adapter reports but the device was created without must be
 * withheld by data, a `--withhold` argument or a quirk-table row matching the adapter, never by a code branch. It
 * reads the device's granted features, the adapter's reported ones and the table the test wrote, not the binary's
 * own account of its rows.
 */
export function unexplainedWithholds(a: AdapterReply, rows: QuirkRow[], args: string[]): string[] {
  const byRow = new Set(matching(rows, a.adapter).flatMap((r) => (r.withholds ? [r.withholds] : [])));
  return a.reported.filter((f) => !a.granted.includes(f) && !args.includes(f) && !byRow.has(f))
    .map((f) => `${f}: the adapter ${a.adapter.name} reports it and the device was created without it, but no quirk-table row and no --withhold names it`);
}

// ---------------------------------------------------------------------------------------------------
// The live runs (README: The live runs): DEEP_140_LIVE=1 on macOS, or INCONCLUSIVE.

export function requireLive(what: string): void {
  if (process.env['DEEP_140_LIVE'] !== '1') expect.fail(`INCONCLUSIVE: ${what} opens the app's window on this Mac's screen; run with DEEP_140_LIVE=1 (README: The live runs)`);
  requireMac();
}

/** The last stdout line that parses as a JSON object with `key` equal to 140. */
export function reportLine(stdout: string, key: string): JsonObject | undefined {
  return stdout.split('\n').reverse().map((l) => { try { return JSON.parse(l) as JsonValue; } catch { return null; } })
    .find((v): v is JsonObject => isObject(v ?? undefined) && (v as JsonObject)[key] === 140);
}
