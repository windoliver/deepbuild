// Test-side tools for the blind redraft of #405's criterion 4 (README): `deep-show` built in debug, and in release only
// on a machine that can judge a timing now, driven by one JSON scenario line (#393's `deep-show run`), in which the
// working agent shows the 1,000-part figure through `deep_show` and a claim's `verdict` (#403) runs one requirement on
// it; the figure itself, generated here; reading the requirement's row; and the perf lane's own judgeLimit and
// fingerprint from scripts/benchmark.mjs. Nothing here stands in for the geometry audit, the determinism check, the
// renders or the hash: every value a test compares comes from the binary, every expected value from the issue and the
// design. Parts are copied from #408's and #1897's helpers, since suites don't import each other.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/405-redraft-ac4 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
const SHOW = 'deep-show';
const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 4 * 3_600_000;

/** Criterion 4's ID: `#405.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC4 = '#405.17969a94';

// ---------------------------------------------------------------------------------------------------
// JSON and failure rules

export function isObject(v: JsonValue | undefined): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
export const brief = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(v: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(v), `${what} is an object, got ${brief(v)}`).toBe(true);
  return v as JsonObject;
}
export function arr(v: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(v), `${what} is an array, got ${brief(v)}`).toBe(true);
  return v as JsonValue[];
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** A test that can't be judged here fails with this, never passes (AGENTS.md: nothing unrun passes). */
export function inconclusive(reason: string): never {
  expect.fail(`INCONCLUSIVE: ${reason}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// Builds: `deep-show` with the `full` set, debug or release, copied out of target/.

export const cargoArgs = (release: boolean): string[] =>
  ['build', '--locked', ...(release ? ['--release'] : []), '--bin', SHOW, '--no-default-features', '--features', 'full'];

/** Builds `full` and copies the binary into `dir`: the binary, or cargo's error. */
export function buildInto(release: boolean, dir: string): { bin: string; error: string } {
  const args = cargoArgs(release);
  const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error) return { bin: '', error: `cargo could not run: ${r.error.message}` };
  if (r.status !== 0) {
    const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
    return { bin: '', error: `cargo ${args.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
  }
  const bin = join(dir, `${SHOW}-${release ? 'release' : 'debug'}`);
  copyFileSync(join(TARGET, release ? 'release' : 'debug', SHOW), bin);
  return { bin, error: '' };
}

/**
 * The file's builds: debug before its tests, release on the first call of `release()` (made only once judgeLimit says
 * this machine can judge a timing now). A test that uses a build that failed fails with cargo's error.
 */
export function useBuilds(): { debug: () => string; release: () => string } {
  let dir = '';
  let debug = { bin: '', error: 'not built' };
  let release: { bin: string; error: string } | null = null;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-405-ac4-bins-'));
    debug = buildInto(false, dir);
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  const use = (b: { bin: string; error: string }, release: boolean): string => {
    expect(b.error, `the binary builds: cargo ${cargoArgs(release).join(' ')}`).toBe('');
    return b.bin;
  };
  return {
    debug: () => use(debug, false),
    release: () => { release ??= buildInto(true, dir); return use(release, true); },
  };
}

/** Fresh folders for a test (each run's evidence store), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-405-ac4-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process: its replies, one per call, and its wall time in ms, from spawn to exit. */
export function run(bin: string, scenario: JsonObject): { replies: JsonObject[]; wallMs: number } {
  const calls = arr(scenario['calls'], 'the calls').length;
  const started = performance.now();
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 3_600_000, killSignal: 'SIGKILL' });
  const wallMs = performance.now() - started;
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  expect(out['ok'], `${SHOW} run refused the scenario: ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((v, i) => obj(v, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(calls);
  return { replies, wallMs };
}

// ---------------------------------------------------------------------------------------------------
// The scenario: the working agent's session and process tree, one panel the figure's size, the figure's document on
// it, and one claim of the agent's whose one requirement is the check input under test.

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: figure', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }];
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const DOC = ulid('01JB405D', 1);
const CLAIM = `claim:${ulid('01JB405C', 1)}`;
export const REQ = `req:${ulid('01JB405Q', 1)}`;

/**
 * One process's calls: the agent's `deep_show` of the figure as a whole revision (`include`), then the verdict on its
 * claim, whose one requirement is `check`.
 */
export function scenarioOf(evidence: string, document: JsonObject, check: JsonObject, include: string[]): JsonObject {
  return {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: { ...ALPHA.process } } },
    processes: PROCESSES,
    panels: { main: { rect: [0, 0, SIZE[0], SIZE[1]] } },
    docs: { [DOC]: { panel: 'main' } },
    claims: { [CLAIM]: { session: ALPHA.id, deliverables: [DOC], requirements: [{ id: REQ, check }] } },
    calls: [
      { call: 'deep_show', session: ALPHA.id, doc: DOC, document, include },
      { call: 'verdict', claim: CLAIM },
    ],
  };
}

/** The agent's show was taken: the revision exists for the verdict to judge. */
export function presentedFailures(reply: JsonObject): string[] {
  return reply['outcome'] === 'presented' ? [] : [`the agent's deep_show of the figure is ${brief(reply['outcome'])}, not presented: ${brief(reply, 3000)}`];
}

/** The requirement's row in the verdict (#403's row, `{id, kind, result, machines, blocked?, issues, …}`). */
export function rowOf(verdict: JsonObject): JsonObject | null {
  const rows = Array.isArray(verdict['requirements']) ? verdict['requirements'].filter(isObject) : [];
  return rows.find((r) => r['id'] === REQ) ?? null;
}

/** A row's `timing.<name>`: a finite number of ms not below zero, or null. */
export function timingOf(row: JsonObject, name: string): number | null {
  const timing = row['timing'];
  const v = isObject(timing) ? timing[name] : undefined;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Whether an issue names part `id`: in `ids`, or in a field on it or in its `actual` (its `what` and `fix` text aside). */
export function names(issue: JsonObject, id: string): boolean {
  const strings = (v: JsonValue | undefined): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : isObject(v) ? Object.values(v).flatMap(strings) : [];
  const { what: _what, fix: _fix, ...rest } = issue;
  return strings(rest).includes(id);
}

// ---------------------------------------------------------------------------------------------------
// The figure (README: The figure): 1,000 parts, every one a scene3d solid in the `part` role.

export const SIZE: [number, number] = [1920, 1080];
type V3 = [number, number, number];
const COLS = 37;
const ROWS = 27;
const PITCH = 0.6;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const id4 = (i: number): string => `part-${String(i).padStart(4, '0')}`;
const order = (k: number): string => `a${String(k).padStart(4, '0')}`;

/** The plate: a 23.4 × 0.1 × 17.4 m box whose top is y = 0, under the whole grid. */
export const PLATE = 'plate';
/** The two pairs planted to pass 0.1 m into each other: the first and last parts in order, and two in the middle. */
export const PLANTED: readonly [string, string][] = [[id4(0), id4(998)], [id4(499), id4(500)]];
const SHAPES = [
  { kind: 'mark.box@1', size: [0.3, 0.3, 0.3] as V3, role: 'accent' },
  { kind: 'mark.cylinder@1', size: [0.3, 0.4, 0.3] as V3, role: 'ink' },
  { kind: 'mark.sphere@1', size: [0.3, 0.3, 0.3] as V3, role: 'muted' },
] as const;
const BOX = SHAPES[0];

function solid(id: string, name: string, k: number, kind: string, size: V3, pos: V3, role: string): JsonObject {
  return { id, kind, name, role: 'part', order: order(k), params: { size: [...size], paint: { fill: { role } } }, at: { pos: pos.map(r3) } };
}

/**
 * A still `figure` of 1,000 parts: the plate, and 999 solids standing on it, `part-0000` to `part-0998`, a box, a
 * cylinder and a sphere in turn, 0.3 m across, on a 37 × 27 grid 0.6 m apart (slot i at x = 0.6 (i mod 37), z = 0.6
 * ⌊i ÷ 37⌋), each resting on the plate's top. Planted: `part-0998`, a box, stands 0.2 m from `part-0000` along x
 * instead of in its slot, and `part-0500`, a box, 0.2 m from `part-0499`, a box, so each pair passes 0.1 m into each
 * other; every other pair of parts is at least 0.1 m apart. A perspective camera over the plate and one sun; no
 * channel, control, loop, take-apart or exception, so rest is the only state it reaches. Every solid names a fill role
 * of the shipped clean look (accent, ink, muted, raised), as a lit scene3d solid must (README: The dispute).
 */
export function figure(): JsonObject {
  const items: JsonObject = {
    cam: { id: 'cam', kind: 'camera@1', name: 'Camera', order: order(0), params: { projection: 'perspective', position: [10.8, 22, 36], target: [10.8, 0, 7.2], fov: 50 } },
    sun: { id: 'sun', kind: 'light.sun@1', name: 'Sun', order: order(1), params: { illuminance: 10_000 }, at: { rot: [-60, 30, 0] } },
    [PLATE]: solid(PLATE, 'Plate', 2, 'mark.box@1', [23.4, 0.1, 17.4], [10.8, -0.05, 7.8], 'raised'),
  };
  for (let i = 0; i < COLS * ROWS; i++) {
    const id = id4(i);
    const planted = PLANTED.some((p) => p.includes(id));
    const shape = planted ? BOX : SHAPES[i % 3]!;
    let x = PITCH * (i % COLS);
    let z = PITCH * Math.floor(i / COLS);
    if (i === 998) { x = 0.2; z = 0; }
    if (i === 500) x -= 0.4;
    items[id] = solid(id, `Part ${i}`, 3 + i, shape.kind, shape.size, [x, shape.size[1] / 2, z], shape.role);
  }
  return {
    format: 1, profile: 'figure', title: 'A thousand parts on a plate',
    description: 'A still figure of 1,000 parts: a plate and 999 boxes, cylinders and spheres standing on it, two pairs of them passing into each other.',
    size: [...SIZE], camera: 'cam', transport: { span: '4s' }, requires: { modules: { scene3d: '^1' } }, items,
  };
}
/** The number of parts the figure holds: items in the `part` role. */
export const partsIn = (doc: JsonObject): number => Object.values(obj(doc['items'], 'the figure: items')).filter((i) => isObject(i) && i['role'] === 'part').length;

// ---------------------------------------------------------------------------------------------------
// The perf lane's rule: scripts/benchmark.mjs's judgeLimit and fingerprint, imported, never copied (the reference
// Macs, mains power, Low Power Mode off, thermal state nominal, the load at each run's start and end).

export const load = (): number => loadavg()[0]!;
export interface Load { start: number; end: number }
export async function judgeLimit(limit: number, runs: number[], loads: Load[]): Promise<JsonObject> {
  const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint: () => JsonObject; judgeLimit: (o: unknown) => JsonObject };
  return bench.judgeLimit({ limit, runs, fingerprint: bench.fingerprint(), loads });
}
/** judgeLimit on five stand-in runs at this moment: PASS only when this machine can judge a timing now. */
export async function canJudge(limit: number): Promise<JsonObject> {
  const now = Array.from({ length: 5 }, () => ({ start: load(), end: load() }));
  return judgeLimit(limit, [0, 0, 0, 0, 0], now);
}
