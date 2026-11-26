// Test-side tools for the #3356 acceptance tests: `deep-show` built as scripts/canvas-kit.mjs builds it (the debug
// build the kit runs in) and as the issue's release `deep-show live` is built, the kit call the script makes, the
// committed kit ledger, and `deep-show live` started with one line of input. Nothing here stands in for the kit, the
// seal or the ledger.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/3356 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW = 'deep-show';

/** scripts/proof-change.mjs's criterionId over each criterion's text as the issue gives it (without its number). */
export const AC1 = '#3356.8d8c3ce5';
export const AC2 = '#3356.c602cb3f';

/** The module the issue names. */
export const SCENE3D = 'scene3d';

export const isObject = (v: JsonValue | undefined): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
export const shown = (v: unknown, n = 1500): string => (typeof v === 'string' ? v : JSON.stringify(v) ?? String(v)).slice(0, n);
export const same = (a: JsonValue | undefined, b: JsonValue | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------------------------------
// The builds. `kit`: scripts/canvas-kit.mjs's own (`cargo build --locked --bin deep-show`). `release`: the issue's
// release build (`cargo build --locked --release --bin deep-show`, the default feature set, `full`), which embeds the
// ledger build.rs names: DEEP_KIT_LEDGER when given, else the committed crates/deep-show/kit-ledger.json. Each binary is
// copied out of target/ (or CARGO_TARGET_DIR) under a name of its own, so a later build can't change it under a test.

export type BuildName = 'kit' | 'release';
const ARGS: Record<BuildName, string[]> = {
  kit: ['build', '--locked', '--bin', SHOW],
  release: ['build', '--locked', '--release', '--bin', SHOW],
};
const uplifted = (name: BuildName): string => join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), name === 'release' ? 'release' : 'debug', SHOW);
export const buildCommand = (name: BuildName, ledger?: string): string => `${ledger ? `DEEP_KIT_LEDGER=${ledger} ` : ''}cargo ${ARGS[name].join(' ')}`;

/** Builds `name`, embedding `ledger` (DEEP_KIT_LEDGER) or, without one, the committed ledger; '' or cargo's error. */
export function cargoBuild(name: BuildName, ledger?: string): string {
  const env: NodeJS.ProcessEnv = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  delete env['DEEP_KIT_LEDGER'];
  if (ledger) env['DEEP_KIT_LEDGER'] = ledger;
  const run = spawnSync('cargo', ARGS[name], { cwd: REPO, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `${buildCommand(name, ledger)} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download/.test(l)).join('\n').slice(0, 4000)}`;
  return '';
}

/** A fresh folder for the file's binaries, deleted after the file. */
export function useBins(): () => string {
  let dir = '';
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'deep-3356-bins-')); });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** Copies the binary `name` just built to `to`. */
export const copyOut = (name: BuildName, to: string): void => copyFileSync(uplifted(name), to);

/** Builds `name` once before the file's tests (the committed ledger); a test that asks for it fails with cargo's error. */
export function useBuild(name: BuildName): () => string {
  const bins = useBins();
  let error = '';
  let bin = '';
  beforeAll(() => {
    error = cargoBuild(name);
    bin = join(bins(), `${SHOW}-${name}`);
    if (error === '') copyOut(name, bin);
  }, 5_400_000);
  return () => {
    expect(error, `the binary builds: ${buildCommand(name)}`).toBe('');
    return bin;
  };
}

/** A fresh folder per test, deleted after it. */
export function useTemp(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-3356-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Running it

export interface Ran { status: number | null; signal: string | null; timedOut: boolean; stdout: string; stderr: string; lines: JsonValue[] }

export function spawn(bin: string, args: string[], input: string, timeoutMs = 600_000): Ran {
  const r = spawnSync(bin, args, { cwd: REPO, input, encoding: 'utf8', maxBuffer: 1 << 30, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} ${args.join(' ')}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l): JsonValue => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: r.status, signal: r.signal, timedOut, stdout, stderr: r.stderr ?? '', lines };
}

/**
 * `deep-show live [args]` given one line it can't read. The seal runs before the first line is read (main.rs), so a
 * build that seals answers this line with `bad_input` and exits; one that refuses answers no line: it writes the seal's
 * refusal and exits 2. Nothing here opens a window: a line `live` can't read never reaches one.
 */
export const LINE_IT_CANT_READ = 'not a scenario\n';
export const live = (bin: string, args: string[] = []): Ran => spawn(bin, ['live', ...args], LINE_IT_CANT_READ, 300_000);

/** `deep-show run` on one scenario: its one answer's replies. */
export function run(bin: string, scenario: JsonObject, what: string): JsonObject[] {
  const r = spawn(bin, ['run'], `${JSON.stringify(scenario)}\n`, 3_000_000);
  expect(r.timedOut, `${SHOW} run (${what}) finished within its timeout`).toBe(false);
  expect(r.status, `${SHOW} run (${what}) exited 0; stdout: ${r.stdout.slice(0, 1500)}; stderr: ${r.stderr.slice(-1500)}`).toBe(0);
  const answer = r.lines[0];
  expect(isObject(answer) && answer['ok'] === true, `${SHOW} run accepts ${what}: ${shown(answer)}`).toBe(true);
  const replies = (answer as JsonObject)['replies'];
  expect(Array.isArray(replies), `${what}: replies`).toBe(true);
  return (replies as JsonValue[]).filter(isObject);
}

// ---------------------------------------------------------------------------------------------------
// The kit and its ledger

/** The kit call scripts/canvas-kit.mjs makes (every part, default backends, seed and sizes), over `modules`, writing `ledger`. */
export const kitCall = (modules: string[], ledger: string): JsonObject => ({ call: 'kit', modules, ledger });

/** The committed ledger the release build embeds and seals by. */
export const LEDGER = join(REPO, 'crates', 'deep-show', 'kit-ledger.json');
export const readLedger = (path: string): JsonObject => {
  const v = JSON.parse(readFileSync(path, 'utf8')) as JsonValue;
  expect(isObject(v), `${path} is a JSON object`).toBe(true);
  return v as JsonObject;
};

/** The kit reply's report of one module. */
export function kitModule(reply: JsonObject, module: string): JsonObject {
  const modules = Array.isArray(reply['modules']) ? reply['modules'].filter(isObject) : [];
  const m = modules.find((x) => x['module'] === module);
  expect(m, `the kit reports ${module}: ${shown(reply)}`).toBeDefined();
  return m!;
}

/** A module's first failures, its own and its parts', as JSON text. */
export function failuresOf(m: JsonObject, n = 6): string {
  const own = Array.isArray(m['failures']) ? m['failures'] : [];
  const parts = Array.isArray(m['parts']) ? m['parts'].filter(isObject).flatMap((p) => (Array.isArray(p['failures']) ? p['failures'] : [])) : [];
  return [...own, ...parts].slice(0, n).map((f) => JSON.stringify(f)).join(' ');
}
