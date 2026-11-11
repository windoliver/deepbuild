// Test-side tools for the #2015 acceptance tests: `deep-show` in the `full` build set (scene3d is needed),
// built once per file and driven by one JSON line; the scenario (#393, #306, #440): your agent's session, the
// process table, a panel, the test pack of `fixtures/packs/` installed before the first call, and an optional
// `planted`; scene documents naming that pack; the `deep_show` and `geometry` calls; the reply's `expansions`
// (#306) and a builder row's `positions` (#420); and the parity fixture. Nothing here stands in for the pack
// check, the expansion or the plate builder.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type V3 = [number, number, number];

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2015 is three levels down). */
const REPO = join(HERE, '..', '..', '..');

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
function v3(value: JsonValue | undefined, what: string): V3 {
  const a = arr(value, what);
  expect(a.length, `${what} has three numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';
export const fmt = (p: readonly number[]): string => `[${p.map((x) => String(Math.round(x * 1e9) / 1e9)).join(', ')}]`;

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(true);
  }
}

/** A fixture file of this suite, parsed. */
export function fixture(...parts: string[]): JsonObject {
  const value = JSON.parse(readFileSync(join(HERE, 'fixtures', ...parts), 'utf8')) as JsonValue;
  if (!isObject(value)) throw Error(`fixture ${parts.join('/')} is not a JSON object`);
  return value;
}

// ---------------------------------------------------------------------------------------------------
// The binary: `deep-show` in the `full` build set, built once per file and copied out under its own name.

const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
const CARGO = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];

/** Builds deep-show before the file's tests; a test that uses a build that failed fails with cargo's error. */
export function useShow(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2015-bin-'));
    const env = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
    const run = spawnSync('cargo', CARGO, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env });
    if (run.error) error = `cargo could not run: ${run.error.message}`;
    else if (run.status !== 0) error = `cargo ${CARGO.join(' ')} failed:\n${run.stderr.split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l)).join('\n').slice(0, 4000)}`;
    else copyFileSync(join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', exe('deep-show')), join(dir, exe('deep-show')));
  }, 3_600_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => {
    expect(error, `the binary builds: cargo ${CARGO.join(' ')}`).toBe('');
    return join(dir, exe('deep-show'));
  };
}

/** A fresh temporary folder per test (the scenario's evidence store), deleted after it. */
export function useDir(): () => string {
  let dir = '';
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-2015-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: the scenario, documents and calls.

/** Scenario `planted` values this suite adds, each a wrong program reachable only there (README: planted values). */
export type Planted = 'each_seeds_by_element_count' | 'each_face_per_triangle';

/** The test pack test/lots@1.0.0 (README: Fixtures), `{id: owner/name, dir}` as the scenario's `packs` takes it (#306). */
const LOTS = { id: 'test/lots', dir: join(HERE, 'fixtures', 'packs', 'test-lots-1.0.0') } as const;

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: repeats over elements', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** A document ID the hub minted. */
export const DOC = '01JB2015D00000000000000001';

/** A scenario: the agent's session, the process table, one visible panel for `doc`, the test pack installed, an optional `planted`, and the calls. */
export function scenario(evidence: string, doc: string, calls: JsonObject[], planted?: Planted): JsonObject {
  const out: JsonObject = {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES,
    panels: { p1: { rect: [0, 0, 800, 600] } },
    docs: { [doc]: { panel: 'p1' } },
    packs: [{ id: LOTS.id, dir: LOTS.dir }],
    calls,
  };
  if (planted) out['planted'] = planted;
  return out;
}

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function runShow(bin: string, sc: JsonObject): JsonObject[] {
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 540_000, killSignal: 'SIGKILL' });
  if (run.error) throw Error(`deep-show run: ${run.error.message}`);
  const stdout = run.stdout ?? '';
  expect(run.status, `deep-show run exited 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-show run: one output line per input line').toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-show run: the answer');
  expect(answer['ok'], `deep-show run refused the scenario: ${shown(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'deep-show run: replies').map((r, i) => obj(r, `deep-show run: replies[${i}]`));
  expect(replies.length, 'deep-show run: one reply per call').toBe(arr(sc['calls'], 'the calls').length);
  return replies;
}

/** A scene document naming `packs` around `items` (an agent's payload: no `id`, no `layers`), with a still camera. */
export function sceneDoc(title: string, packs: readonly string[], items: JsonObject): JsonObject {
  const all: JsonObject = { cam: { kind: 'camera@1', params: { projection: 'perspective', position: [4, 5, 6], target: [0, 0, 0], fov: 40 } }, ...items };
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(all)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...obj(item, `item ${id}`) };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #2015 acceptance fixture.`, size: [480, 360], camera: 'cam',
    requires: { modules: { scene3d: '^1' } }, packs: [...packs], items: withIds,
  };
}

/** The agent's `deep_show`: a whole revision of `document` with its issues (#393). */
export const show = (doc: string, document: JsonObject): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc, document, include: ['issues'] });

/** #420's `geometry` call: the built mesh of each of `items` at t = 0. */
export const geometryCall = (doc: string, items: string[]): JsonObject => ({ call: 'geometry', doc, items, t: '0s' });

// ---------------------------------------------------------------------------------------------------
// Replies

interface Issue { code: string; severity: string; raw: JsonObject }
function issues(reply: JsonObject, what: string): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: str(o['code'], `${what}: issues[${i}].code`), severity: str(o['severity'], `${what}: issues[${i}].severity`), raw: o };
  });
}
/** A revision presented with no error issue and no item skipped as an unknown kind (the base's notice). */
export function admitted(reply: JsonObject, what: string): void {
  const errors = issues(reply, what).filter((i) => i.severity === 'error');
  expect(errors.map((e) => JSON.stringify(e.raw)), `${what}: no error issue`).toEqual([]);
  const skipped = arr(reply['notices'] ?? [], `${what}: notices`).filter((n) => isObject(n) && n['code'] === 'unknown_kind');
  expect(skipped.map((n) => JSON.stringify(n)), `${what}: no item skipped as an unknown kind`).toEqual([]);
  expect(reply['outcome'], `${what}: presented, got ${shown(reply)}`).toBe('presented');
}

/** One recipe instance's expansion, as the reply's `expansions` row gives it (#306's README: Reply fields added). */
export interface Expansion { instance: string; derived: Record<string, JsonObject>; seeds: Record<string, string> }
export function expansionOf(reply: JsonObject, instance: string, what: string): Expansion {
  const rows = arr(reply['expansions'], `${what}: expansions`).map((v, i) => obj(v, `${what}: expansions[${i}]`)).filter((e) => e['instance'] === instance);
  expect(rows.length, `${what} has exactly one expansion of ${instance}: ${shown(reply['expansions'])}`).toBe(1);
  const row = rows[0]!;
  const derived = obj(row['derived'], `${what}: ${instance}'s derived`);
  const seeds = obj(row['seeds'], `${what}: ${instance}'s seeds`);
  return {
    instance,
    derived: Object.fromEntries(Object.entries(derived).map(([id, item]) => [id, obj(item, `${what}: derived ${id}`)])),
    seeds: Object.fromEntries(Object.entries(seeds).map(([id, seed]) => [id, str(seed, `${what}: seed of ${id}`)])),
  };
}

/** A builder item's built positions from a `geometry` reply, in item space (#420). */
export function positionsOf(reply: JsonObject, id: string, what: string): V3[] {
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const rows = arr(reply['items'], `${what}: items`).map((r, i) => obj(r, `${what}: items[${i}]`));
  const row = rows.find((r) => r['id'] === id);
  expect(row, `${what}: the reply holds ${id}: ${shown(reply)}`).toBeDefined();
  return arr(row!['positions'], `${what}: ${id}.positions`).map((p, k) => v3(p, `${what}: ${id}.positions[${k}]`));
}
