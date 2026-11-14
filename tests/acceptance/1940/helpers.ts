// Test-side tools for the #1940 acceptance tests: `deep-show` built once per Cargo feature set and copied out under its
// own name (#490's way); its startup, where the seal runs before any scenario is read (#305, #238); one scenario
// through `deep-show run`, one JSON line in and one answer line out (#393); the world a claim's verdict reads (#403's: a
// session, the process table, a panel and a stored board); and reading replies. Nothing here stands in for the seal,
// the check registry or a verdict: every value a test compares comes from the binary.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1940 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW_NAME = 'deep-show';
/** Every `it` passes this timeout: a first build of `deep-show` on the shared Mac can take many minutes. */
export const TIMEOUT = 1_800_000;
/** The exit of a startup the seal refused (#305). */
export const REFUSED_EXIT = 2;

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
export function strs(value: JsonValue | undefined, what: string): string[] {
  return arr(value, what).map((v, i) => {
    expect(typeof v, `${what}[${i}] is a string, got ${JSON.stringify(v)}`).toBe('string');
    return v as string;
  });
}
export const show = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
/** No failures; the message lists them, each naming what failed. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// Builds: each listed feature set once per file, in beforeAll, copied out under its own name; a test that uses a build
// that failed fails with cargo's error.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
/** rustup's cargo on this Mac (Homebrew's rustup keeps it off the default PATH, #2009's suite). */
const RUSTUP_BIN = '/opt/homebrew/opt/rustup/bin';
/** Builds stay light on the shared Mac: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV: NodeJS.ProcessEnv = {
  CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0',
  ...(existsSync(RUSTUP_BIN) ? { PATH: `${RUSTUP_BIN}:${process.env['PATH'] ?? ''}` } : {}),
};
const built = (): string => join(process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target'), 'debug', exe(SHOW_NAME));

/** `cargo build --locked --bin deep-show --no-default-features --features <set>`: '' or cargo's error. */
function cargoBuild(features: string): string {
  const args = ['build', '--locked', '--bin', SHOW_NAME, '--no-default-features', '--features', features];
  const run = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (run.error) return `cargo could not run: ${run.error.message}`;
  return run.status === 0 ? '' : `cargo ${args.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Downloaded|Downloading/.test(l)).join('\n')}`;
}

export interface ShowBuilds { bin: (features: string) => string }
/** deep-show for each listed feature set, built once per file. */
export function useShow(featureSets: readonly string[]): ShowBuilds {
  let dir = '';
  const made = new Map<string, { bin: string; error: string }>();
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1940-show-'));
    for (const features of featureSets) {
      const error = cargoBuild(features);
      const bin = join(dir, `${SHOW_NAME}-${features.replace(/[^a-z0-9+.-]/g, '_')}`);
      if (error === '') copyFileSync(built(), bin);
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

/** A fresh evidence store root per test, deleted after it. */
export function useEvidence(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1940-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// Running deep-show

export interface Started { status: number | null; signal: NodeJS.Signals | null; lines: JsonValue[]; stdout: string; stderr: string }

/** `deep-show run` with one scenario line, waited for; nothing asserted. */
export function start(bin: string, scenario: JsonObject): Started {
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`${SHOW_NAME} run: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  const lines = stdout.split('\n').filter((l) => l !== '').map((l): JsonValue => { try { return JSON.parse(l) as JsonValue; } catch { return l; } });
  return { status: run.status, signal: run.signal, lines, stdout, stderr: run.stderr ?? '' };
}

/** The build's startup: the seal runs first, then one scenario asking for the build's `registry`. */
export const startup = (bin: string, evidence: string): Started => start(bin, { evidence, calls: [{ call: 'registry' }] });

/**
 * The seal's check on a startup: it started (exit 0) and answered its scenario. Each failure names `build`, and the
 * seal's refusal (`{ok: false, code: "seal_refused", reason, modules, what}`) when that is what it answered.
 */
export function sealFailures(s: Started, build: string): string[] {
  const line = s.lines[0];
  if (s.status === 0 && s.lines.length === 1 && isObject(line) && line['ok'] === true) return [];
  return [`${build} did not seal: exit ${s.status} (${s.signal ?? 'no signal'}); ${s.stdout.slice(0, 1200)} ${s.stderr.slice(-600)}`];
}

/** The seal's refusal line (#305, #238): exit 2 and one line `{ok: false, code: "seal_refused", reason, modules, …}`. */
export function refusalLine(s: Started, what: string): JsonObject {
  expect(s.status, `${what} refuses to start (exit ${REFUSED_EXIT}); stdout: ${s.stdout.slice(0, 1000)}; stderr: ${s.stderr.slice(-1000)}`).toBe(REFUSED_EXIT);
  expect(s.lines.length, `${what}: the refusal is one line, and no scenario is answered`).toBe(1);
  const line = obj(s.lines[0], `${what}: the refusal line`);
  expect([line['ok'], line['code']], `${what}: the line is the seal's refusal: ${show(line)}`).toEqual([false, 'seal_refused']);
  return line;
}

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const s = start(bin, scenario);
  expect(s.status, `${SHOW_NAME} run exits 0 (${s.signal ?? 'no signal'}); stderr: ${s.stderr.slice(0, 2000)}`).toBe(0);
  expect(s.lines.length, `${SHOW_NAME} run: one output line per input line`).toBe(1);
  const out = obj(s.lines[0], `${SHOW_NAME} run: the answer`);
  expect(out['ok'], `${SHOW_NAME} run refused the scenario: ${show(out, 2000)}`).toBe(true);
  const replies = arr(out['replies'], 'run: replies').map((r, i) => obj(r, `run: replies[${i}]`));
  expect(replies.length, 'run: one reply per call').toBe(arr(scenario['calls'], 'the scenario\'s calls').length);
  return replies;
}

// ---------------------------------------------------------------------------------------------------
// The world a claim's verdict reads (#403's README: Claims with requirements; the `verdict` call).

const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** A document the hub has minted. */
export const DOC = ulid('01JB94D', 1);
export const CLAIM = `claim:${ulid('01JB94C', 1)}`;
export const reqId = (n: number): string => `req:${ulid('01JB94Q', n)}`;

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: effects board', process: { pid: 4100, start: 1_000 } };
const SESSIONS: JsonObject = { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 4100, ppid: 3000, start: 1_000 },
];
const PANELS: JsonObject = { main: { rect: [0, 0, 800, 600] } };

/** A board as the last release stored it (`docs[…].document`): one layer of yours, opened as revision 0, current. */
export function storedBoard(title: string, items: JsonObject[]): JsonObject {
  return {
    format: 1, profile: 'board', title, description: `${title}, as the last release stored the board.`, size: [640, 360],
    layers: { 'you-main': { writer: 'you:you', title: 'You', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [String(i['id']), { ...i, layer: 'you-main' }])),
  };
}
export const rect = (id: string, name: string, box: number[], order: string): JsonObject =>
  ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role: 'muted' } } } });

/** A requirement of a claim's definition: its ID and its check input. */
export const requirement = (id: string, check: JsonObject): JsonObject => ({ id, check });
/** Alpha's claim whose definition names `deliverables` and holds `requirements`. */
export const claim = (deliverables: string[], requirements: JsonObject[]): JsonObject => ({ session: ALPHA.id, deliverables, requirements });

/** A scenario with this suite's session, process table and panel; each document stored on the panel `main`. */
export function scenario(evidence: string, docs: Record<string, JsonObject>, calls: JsonObject[], extra: JsonObject = {}): JsonObject {
  const stored: JsonObject = Object.fromEntries(Object.entries(docs).map(([id, document]) => [id, { panel: 'main', document }]));
  return { evidence, sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs: stored, ...extra, calls };
}

// ---------------------------------------------------------------------------------------------------
// Verdicts (#403's README: the `verdict` call and `blocked`)

/** Why a check is BLOCKED for a kind. */
export interface Blocked { code: string; kind: string; module: string | null }
export interface Row { id: string; result: string; blocked: Blocked[]; raw: JsonObject }
export interface Verdict { result: string; requirements: Row[]; raw: JsonObject }

export function verdictOf(value: JsonValue | undefined, what: string): Verdict {
  const o = obj(value, what);
  const requirements = (Array.isArray(o['requirements']) ? o['requirements'] : []).filter(isObject).map((r) => ({
    id: String(r['id']), result: String(r['result']), raw: r,
    blocked: (Array.isArray(r['blocked']) ? r['blocked'] : []).filter(isObject).map((b) => ({
      code: String(b['code']), kind: String(b['kind']), module: typeof b['module'] === 'string' ? b['module'] : null,
    })),
  }));
  return { result: String(o['result']), requirements, raw: o };
}
