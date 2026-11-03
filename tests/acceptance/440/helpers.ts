// Test-side tools for the #440 acceptance tests: `deep-show` (the canvas core's scenario binary, with #420's
// `geometry` call), built once per file and driven by one JSON line; the scenario, documents and calls; the
// fields this suite adds to `geometry` (README: The surface under test) parsed into types; and the planted
// names. The CPU references the criteria are held to are in reference.ts. Nothing here stands in for a builder,
// a modifier or the check.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import type { V2, V3 } from './reference.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/440 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #440.f942298e',
  2: 'AC2 #440.d34ffa24',
  3: 'AC3 #440.c0ab6932',
  4: 'AC4 #440.c9e9574e',
  5: 'AC5 #440.a93b61e0',
  6: 'AC6 #440.7c557cc9',
  7: 'AC7 #440.e32f40c2',
  8: 'AC8 #440.f4a52a05',
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
export function v2(value: JsonValue | undefined, what: string): V2 {
  const a = arr(value, what);
  expect(a.length, `${what} has two numbers`).toBe(2);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`)];
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';

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
    dir = mkdtempSync(join(tmpdir(), 'deep-440-bin-'));
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-440-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: the scenario (#393, #306, #420), documents and calls.

/** Scenario `planted` values this suite adds, each a wrong program reachable only there (README: planted values). */
export type ShowPlanted =
  | 'quads_keep_diagonals' | 'cage_reads_subdivided'
  | 'hull_keeps_face_points' | 'hull_fan_input_order'
  | 'subdivide_first_corner'
  | 'bevel_drops_wear' | 'bevel_faces_unparted';

const ALPHA = { id: 'sess-alpha', thread: 'thread-alpha', name: 'Claude Code: modeling steps', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** Document IDs the hub minted. */
export const DOC = { a: '01JB440D000000000000000001', b: '01JB440D000000000000000002' } as const;

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
  const all: Record<string, JsonObject> = { cam: { kind: 'camera@1', params: { projection: 'perspective', position: [3, 3, 4], target: [0, 0.5, 0], fov: 40 } }, ...items };
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(all)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #440 acceptance fixture.`, size: [480, 360], camera: 'cam',
    requires: { modules: { scene3d: '^1' } }, items: withIds,
  };
}

/** The agent's `deep_show`: a whole revision of `document` with its issues (#393). */
export const show = (doc: string, document: JsonObject): JsonObject =>
  ({ call: 'deep_show', session: ALPHA.id, doc, document, include: ['issues'] });

/** #420's `geometry` call options, with this suite's `blocks` and `rotate_corners` (README: The surface under test). */
export interface GeometryOptions { stage?: 'built' | 'final'; estimate_only?: boolean; blocks?: 1; rotate_corners?: number }
export const geometryCall = (doc: string, items: string[], o: GeometryOptions = {}): JsonObject =>
  ({ call: 'geometry', doc, items, t: '0s', ...(o as JsonObject) });

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
// `geometry` replies: builder rows (mesh, faces, parts, attributes, uv0, uv1, declared counts, blocks) and
// mark.line rows (segments). Fields a criterion needs are read where it needs them, so a missing one fails
// there, naming it.

export interface Row { id: string; raw: JsonObject }
export interface Declared { vertices: number; raw: JsonObject }
export interface MeshRow extends Row { declared: Declared; positions: V3[]; normals: V3[]; indices: number[] }

function rowOf(reply: JsonObject, id: string, what: string): JsonObject {
  expect(reply['code'], `${what} was answered, not refused: ${shown(reply)}`).toBeUndefined();
  const rows = arr(reply['items'], `${what}: items`).map((r, i) => obj(r, `${what}: items[${i}]`));
  const row = rows.find((r) => r['id'] === id);
  expect(row, `${what}: the reply holds ${id}: ${shown(reply)}`).toBeDefined();
  return row!;
}
/** `builds` of a geometry reply. */
export const buildsOf = (reply: JsonObject, what: string): number => num(reply['builds'], `${what}: builds`);
/** An `estimate_only` row: its declared counts. */
export function declaredRow(reply: JsonObject, id: string, what: string): Declared {
  const o = rowOf(reply, id, what);
  const d = obj(o['declared'], `${what}: ${id}.declared`);
  return { vertices: num(d['vertices'], `${what}: ${id}.declared.vertices`), raw: d };
}
/** A builder item's row: its declared counts and its mesh in item space. */
export function meshRow(reply: JsonObject, id: string, what: string): MeshRow {
  const o = rowOf(reply, id, what);
  const d = obj(o['declared'], `${what}: ${id}.declared`);
  const positions = arr(o['positions'], `${what}: ${id}.positions`).map((p, k) => v3(p, `${what}: ${id}.positions[${k}]`));
  const normals = arr(o['normals'], `${what}: ${id}.normals`).map((p, k) => v3(p, `${what}: ${id}.normals[${k}]`));
  const indices = arr(o['indices'], `${what}: ${id}.indices`).map((x, k) => num(x, `${what}: ${id}.indices[${k}]`));
  expect(normals.length, `${what}: ${id} has one normal per position`).toBe(positions.length);
  expect(indices.length % 3, `${what}: ${id}.indices hold whole triangles`).toBe(0);
  expect(indices.every((i) => Number.isInteger(i) && i >= 0 && i < positions.length), `${what}: ${id}.indices index its positions`).toBe(true);
  return { id, raw: o, declared: { vertices: num(d['vertices'], `${what}: ${id}.declared.vertices`), raw: d }, positions, normals, indices };
}
/** `faces`: one face ID per triangle (two triangles of one quad or polygon share one). */
export function facesOf(row: MeshRow, what: string): number[] {
  const f = arr(row.raw['faces'], `${what}: ${row.id}.faces`).map((x, k) => num(x, `${what}: ${row.id}.faces[${k}]`));
  expect(f.length, `${what}: ${row.id} has one face per triangle`).toBe(row.indices.length / 3);
  return f;
}
/** `parts`: each named part's triangles. */
export function partsOf(row: MeshRow, what: string): Map<string, number[]> {
  const p = obj(row.raw['parts'], `${what}: ${row.id}.parts`);
  return new Map(Object.entries(p).map(([name, tris]) => [name, arr(tris, `${what}: ${row.id}.parts.${name}`).map((x, k) => num(x, `${what}: ${row.id}.parts.${name}[${k}]`))]));
}
/** A UV set, `uv0` or `uv1`: one [u, v] per position. */
export function uvOf(row: MeshRow, name: 'uv0' | 'uv1', what: string): V2[] {
  const uv = arr(row.raw[name], `${what}: ${row.id}.${name}`).map((x, k) => v2(x, `${what}: ${row.id}.${name}[${k}]`));
  expect(uv.length, `${what}: ${row.id} has one ${name} per position`).toBe(row.positions.length);
  return uv;
}
/** `blocks`: the block count the item's build ran at. */
export const blocksOf = (row: MeshRow, what: string): number => num(row.raw['blocks'], `${what}: ${row.id}.blocks`);
/** A mark.line@1 row with `edges`: each segment it draws, by its two ends in world metres. */
export function segmentsOf(reply: JsonObject, id: string, what: string): [V3, V3][] {
  const o = rowOf(reply, id, what);
  return arr(o['segments'], `${what}: ${id}.segments`).map((s, k) => {
    const ends = arr(s, `${what}: ${id}.segments[${k}]`);
    expect(ends.length, `${what}: ${id}.segments[${k}] has two ends`).toBe(2);
    return [v3(ends[0], `${what}: ${id}.segments[${k}][0]`), v3(ends[1], `${what}: ${id}.segments[${k}][1]`)];
  });
}
