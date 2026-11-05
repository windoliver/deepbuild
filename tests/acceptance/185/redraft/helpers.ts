// Test-side tools for the #185 kit redraft: `deep-show` built per Cargo feature set (a build set plus test
// features, as #305's and #138's suites build it), in debug or in release with the kit ledger named by
// DEEP_KIT_LEDGER at build time; driven by JSON lines; and the replies read strictly. Nothing here stands in
// for the kit, the seal, an interface or a ledger: every verdict comes from the binary.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/185 is three levels down). */
export const REPO = join(HERE, '..', '..', '..', '..');
export const SHOW_NAME = 'deep-show';
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const show = (value: unknown, n = 1500): string => JSON.stringify(value)?.slice(0, n) ?? String(value);
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${show(value, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${show(value, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${show(value)}`).toBe(true);
  return value as number;
}
export function str(value: JsonValue | undefined, what: string): string {
  expect(typeof value, `${what} is a string, got ${show(value, 600)}`).toBe('string');
  return value as string;
}
export function strs(value: JsonValue | undefined, what: string): string[] {
  return arr(value, what).map((v, i) => str(v, `${what}[${i}]`));
}

// ---------------------------------------------------------------------------------------------------
// Builds

export type BuildSet = 'core' | 'r1' | 'r2' | 'full';
/** The suite's test features: B alone, and the behavior part of test.sim@1. */
export type TestFeature = 'test-sim-b' | 'test-sim-behavior';
export interface Build { set: BuildSet; with?: TestFeature[] }

export const featuresOf = (build: Build): string[] => [build.set, ...(build.with ?? [])];
export const buildName = (build: Build): string => featuresOf(build).join('+');

function cargoBuild(features: string[], release: boolean, env: NodeJS.ProcessEnv = {}): string {
  const args = ['build', '--locked', ...(release ? ['--release'] : []), '--bin', SHOW_NAME, '--no-default-features', '--features', features.join(',')];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  if (run.status !== 0) return `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished/.test(l)).join('\n')}`;
  return '';
}

/** A directory for the file's binaries and ledgers, made before its tests and removed after them. */
export function useDir(prefix: string): () => string {
  let dir = '';
  beforeAll(() => { dir = mkdtempSync(join(tmpdir(), prefix)); });
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** A debug build of one feature set, copied out of target/debug under its own name; the copy's path, or cargo's error. */
export function debugBuild(build: Build, dir: string): { bin: string; error: string } {
  const error = cargoBuild(featuresOf(build), false);
  const bin = join(dir, `${SHOW_NAME}-debug-${buildName(build).replace(/[^a-z0-9+.-]/g, '_')}`);
  if (error === '') copyFileSync(join(REPO, 'target', 'debug', exe(SHOW_NAME)), bin);
  return { bin, error };
}

/**
 * A release build (`cargo build --release`) of one feature set embedding the kit ledger named by
 * DEEP_KIT_LEDGER at build time (crates/deep-show/build.rs); the copy's path, or cargo's error.
 */
export function releaseBuild(build: Build, ledger: string, dir: string): { bin: string; error: string } {
  const error = cargoBuild(featuresOf(build), true, { DEEP_KIT_LEDGER: ledger });
  const bin = join(dir, `${SHOW_NAME}-release-${buildName(build).replace(/[^a-z0-9+.-]/g, '_')}`);
  if (error === '') copyFileSync(join(REPO, 'target', 'release', exe(SHOW_NAME)), bin);
  return { bin, error };
}

// ---------------------------------------------------------------------------------------------------
// Starting the binary: one scenario line in, one answer line out; or one refusal line and exit 2.

export interface Started { status: number | null; signal: string | null; timedOut: boolean; lines: JsonValue[]; stdout: string; stderr: string }

export function start(bin: string, args: string[], inputs: JsonValue[], timeoutMs = 1_800_000): Started {
  const text = inputs.map((v) => JSON.stringify(v)).join('\n');
  const run = spawnSync(bin, args, { cwd: REPO, input: inputs.length ? `${text}\n` : '', encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: timeoutMs, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (run.error && !timedOut) throw Error(`${SHOW_NAME} ${args.join(' ')}: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((line) => line !== '').map((line) => {
    try { return JSON.parse(line) as JsonValue; } catch { return line; }
  });
  return { status: run.status, signal: run.signal, timedOut, lines, stdout, stderr: run.stderr ?? '' };
}

/** `deep-show run`: one scenario, accepted, with one reply per call; the process exits 0. */
export function run(bin: string, sc: JsonObject, timeoutMs = 1_800_000): JsonObject[] {
  const s = start(bin, ['run'], [sc], timeoutMs);
  expect(s.timedOut, `${SHOW_NAME} run finished within its timeout`).toBe(false);
  expect(s.status, `${SHOW_NAME} run started and exited 0 (${s.signal ?? 'no signal'}); stdout: ${s.stdout.slice(0, 1500)}; stderr: ${s.stderr.slice(0, 1500)}`).toBe(0);
  expect(s.lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${show(out, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-185-ev-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

/** A scenario with one agent session, the process table and one panel (as #305's suite writes it). */
export function scenario(evidence: string, calls: JsonObject[]): JsonObject {
  return {
    evidence,
    sessions: { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: interfaces', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }, { pid: 4100, ppid: 3001, start: 1_000 }],
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { '01JB185D000000000000000001': { panel: 'main' } },
    calls,
  };
}

export const SCHEDULE: JsonObject = { call: 'schedule' };
export const REGISTRY: JsonObject = { call: 'registry' };
export const kitCall = (ledger: string): JsonObject => ({ call: 'kit', ledger });

// ---------------------------------------------------------------------------------------------------
// Replies read strictly

export interface Implementation { name: string; version: string; equivalence: string; state: string; raw: JsonObject }
export interface Interface { digest: string; reference: string; kit: string[]; behavior: string; module: string; implementation: Implementation; raw: JsonObject }

/** `interfaces["name@major"]` of a `schedule` reply (the published plan). */
export function interfaceIn(schedule: JsonObject, name: string): Interface {
  const all = obj(schedule['interfaces'], 'schedule: interfaces');
  const o = obj(all[name], `schedule: interfaces["${name}"] (it holds ${Object.keys(all).join(', ')})`);
  const impl = obj(o['implementation'], `${name}.implementation`);
  return {
    digest: str(o['digest'], `${name}.digest`), reference: str(o['reference'], `${name}.reference`),
    kit: strs(o['kit'], `${name}.kit`), behavior: str(o['behavior'], `${name}.behavior`), module: str(o['module'], `${name}.module`),
    implementation: {
      name: str(impl['name'], `${name}.implementation.name`), version: str(impl['version'], `${name}.implementation.version`),
      equivalence: str(impl['equivalence'], `${name}.implementation.equivalence`), state: str(impl['state'], `${name}.implementation.state`),
      raw: impl,
    },
    raw: o,
  };
}

/** One module's result in a `kit` reply. */
export function moduleIn(kitReply: JsonObject, name: string): JsonObject {
  const modules = arr(kitReply['modules'], 'kit: modules').map((m, i) => obj(m, `kit: modules[${i}]`));
  const m = modules.find((x) => x['module'] === name);
  expect(m, `the kit's report holds module ${name}; it holds ${modules.map((x) => String(x['module'])).join(', ')}`).toBeDefined();
  return m!;
}

/** One part a module ran, by name. */
export function partIn(module: JsonObject, part: string): JsonObject {
  const parts = arr(module['parts'], `${String(module['module'])}.parts`).map((p, i) => obj(p, `${String(module['module'])}.parts[${i}]`));
  const p = parts.find((x) => x['part'] === part);
  expect(p, `${String(module['module'])} ran the part ${part}; it ran ${parts.map((x) => String(x['part'])).join(', ')}`).toBeDefined();
  return p!;
}
