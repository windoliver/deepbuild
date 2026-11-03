// Test-side tools for the #441 acceptance tests: `deep-show` (the canvas core's scenario binary, with #420's
// `geometry` call), built once per file and driven by one JSON line; the scenario, documents and calls; the
// fields this suite adds to `geometry` (README: The surface under test) parsed into types; and the planted
// names. The CPU references the criteria are held to are in reference.ts. Nothing here stands in for curve@1,
// a builder or the check.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import type { V3 } from './reference.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/441 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #441.c7a9e5a5',
  2: 'AC2 #441.f156aca2',
  3: 'AC3 #441.88f3e1bc',
  4: 'AC4 #441.d9cbd314',
  5: 'AC5 #441.2988fbd4',
  6: 'AC6 #441.501326f2',
} as const;

/** Each test spawns cargo or the binary; none has a time budget. */
export const SLOW = 900_000;

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
export function v3(value: JsonValue | undefined, what: string): V3 {
  const a = arr(value, what);
  expect(a.length, `${what} has three numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names each of `names`: what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names ${name}; the failures were:\n  ${failures.join('\n  ')}`).toBe(true);
  }
}

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
    dir = mkdtempSync(join(tmpdir(), 'deep-441-bin-'));
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-441-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: the scenario (#393, #306, #420), documents and calls.

/** Scenario `planted` values this suite adds, each a wrong program reachable only there (README: Planted programs). */
export type ShowPlanted = 'seam_twist_left' | 'sweep_frenet' | 'corner_square' | 'u_by_span';

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: curves and sweeps', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** Document IDs the hub minted. */
export const DOC = { a: '01JB441D000000000000000001', b: '01JB441D000000000000000002' } as const;

/** A scenario: the agent's session, the process table, one visible panel per document, an optional `planted`, and the calls. */
export function scenario(evidence: string, docs: readonly string[], calls: JsonObject[], planted?: ShowPlanted): JsonObject {
  const docsOut: JsonObject = {};
  const panels: JsonObject = {};
  docs.forEach((id, i) => {
    docsOut[id] = { panel: `p${i + 1}` };
    panels[`p${i + 1}`] = { rect: [0, 0, 800, 600] };
  });
  const out: JsonObject = {
    evidence,
    sessions: { [ALPHA.id]: { thread: ALPHA.thread, name: ALPHA.name, process: ALPHA.process } },
    processes: PROCESSES, panels, docs: docsOut, calls,
  };
  if (planted) out['planted'] = planted;
  return out;
}

/** `deep-show run`: one scenario, accepted, with one reply per call. */
export function runShow(bin: string, sc: JsonObject): JsonObject[] {
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: SLOW - 60_000, killSignal: 'SIGKILL' });
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

/** A scene document around `items` (an agent's payload: no `id`, no `layers`), with a still camera. */
export function sceneDoc(title: string, items: Record<string, JsonObject>): JsonObject {
  const all: Record<string, JsonObject> = { cam: { kind: 'camera@1', params: { projection: 'perspective', position: [2, 3, 4], target: [0.5, 0, 0.5], fov: 40 } }, ...items };
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(all)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #441 acceptance fixture.`, size: [480, 360], camera: 'cam',
    requires: { modules: { scene3d: '^1' } }, items: withIds,
  };
}

/** The agent's `deep_show`: a whole revision of `document` with its issues (#393). */
export const show = (doc: string, document: JsonObject): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc, document, include: ['issues'] });
/** #420's `geometry` call, with this suite's `at`: the u values each named curve@1 item answers. */
export const geometryCall = (doc: string, items: string[], at?: number[]): JsonObject =>
  ({ call: 'geometry', doc, items, t: '0s', ...(at ? { at } : {}) });

export interface Issue { code: string; severity: string; path: string; raw: JsonObject }
export function issues(reply: JsonObject, what: string): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: str(o['code'], `${what}: issues[${i}].code`), severity: str(o['severity'], `${what}: issues[${i}].severity`), path: typeof o['path'] === 'string' ? o['path'] : '', raw: o };
  });
}
export const errors = (list: Issue[]): Issue[] => list.filter((i) => i.severity === 'error');
/** A revision presented with no error issue and no item skipped as an unknown kind (the base's notice). */
export function admitted(reply: JsonObject, what: string): void {
  expect(errors(issues(reply, what)).map((e) => JSON.stringify(e.raw)), `${what}: no error issue`).toEqual([]);
  const skipped = arr(reply['notices'] ?? [], `${what}: notices`).filter((n) => isObject(n) && n['code'] === 'unknown_kind');
  expect(skipped.map((n) => JSON.stringify(n)), `${what}: no item skipped as an unknown kind`).toEqual([]);
  expect(reply['outcome'], `${what}: presented, got ${shown(reply)}`).toBe('presented');
}

// ---------------------------------------------------------------------------------------------------
// `geometry` replies: curve@1 rows (outputs and `at`) and builder rows (mesh and `rings`).

export interface Frame { point: V3; tangent: V3; normal: V3; binormal: V3 }
export interface AtRow extends Frame { u: number; raw: JsonObject }
export interface CurveRow { id: string; outputs: JsonObject; at: AtRow[] }
export interface Ring { index: number; u: number; scale: number; turn: number; frame: Frame; vertices: number[] }
export interface MeshRow { id: string; positions: V3[]; indices: number[]; rings: Ring[] }

function frameOf(o: JsonObject, what: string): Frame {
  return { point: v3(o['point'], `${what}.point`), tangent: v3(o['tangent'], `${what}.tangent`), normal: v3(o['normal'], `${what}.normal`), binormal: v3(o['binormal'], `${what}.binormal`) };
}
function rowOf(reply: JsonObject, id: string, what: string): JsonObject {
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const rows = arr(reply['items'], `${what}: items`).map((r, i) => obj(r, `${what}: items[${i}]`));
  const row = rows.find((r) => r['id'] === id);
  expect(row, `${what}: the reply holds ${id}: ${shown(reply)}`).toBeDefined();
  return row!;
}
/** A curve@1 item's row: its outputs (`length`, `closure`) and one `at` entry per u asked, in order. */
export function curveRow(reply: JsonObject, id: string, what: string): CurveRow {
  const o = rowOf(reply, id, what);
  expect(o['kind'], `${what}: ${id} is a curve@1 row`).toBe('curve@1');
  const at = arr(o['at'] ?? [], `${what}: ${id}.at`).map((e, i): AtRow => {
    const q = obj(e, `${what}: ${id}.at[${i}]`);
    return { u: num(q['u'], `${what}: ${id}.at[${i}].u`), ...frameOf(q, `${what}: ${id}.at[${i}]`), raw: q };
  });
  return { id, outputs: obj(o['outputs'], `${what}: ${id}.outputs`), at };
}
/** A builder item's row: its mesh (item space) and its rings in sweep order. */
export function meshRow(reply: JsonObject, id: string, what: string): MeshRow {
  const o = rowOf(reply, id, what);
  const positions = arr(o['positions'], `${what}: ${id}.positions`).map((p, k) => v3(p, `${what}: ${id}.positions[${k}]`));
  const indices = arr(o['indices'], `${what}: ${id}.indices`).map((x, k) => num(x, `${what}: ${id}.indices[${k}]`));
  const rings = arr(o['rings'], `${what}: ${id}.rings`).map((r, k): Ring => {
    const q = obj(r, `${what}: ${id}.rings[${k}]`);
    const vertices = arr(q['vertices'], `${what}: ${id}.rings[${k}].vertices`).map((x, j) => num(x, `${what}: ${id}.rings[${k}].vertices[${j}]`));
    expect(vertices.every((i) => Number.isInteger(i) && i >= 0 && i < positions.length), `${what}: ${id}.rings[${k}].vertices index its positions`).toBe(true);
    return {
      index: k, u: num(q['u'], `${what}: ${id}.rings[${k}].u`), scale: num(q['scale'], `${what}: ${id}.rings[${k}].scale`),
      turn: num(q['turn'], `${what}: ${id}.rings[${k}].turn`), frame: frameOf(obj(q['frame'], `${what}: ${id}.rings[${k}].frame`), `${what}: ${id}.rings[${k}].frame`), vertices,
    };
  });
  return { id, positions, indices, rings };
}
