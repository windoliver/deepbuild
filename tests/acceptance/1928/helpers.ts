// Test-side tools for the #1928 acceptance tests: `deep-show` (the canvas core's scenario binary) in the `full`
// build set, built once per file and driven by one JSON line; the scenario, the scene documents and the
// `deep_show` and `geometry` calls as #420 and #440 left them; the issues a revision raises with their fields;
// a builder row's mesh, face IDs, parts, uv0, face attributes, declared counts and block count; and the planted
// names (README: The surface under test). The CPU references the criteria are held to are in reference.ts.
// Nothing here stands in for a builder, a modifier or the check.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { polygons, type Face, type V2, type V3, type View } from './reference.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1928 is three levels down). */
const REPO = join(HERE, '..', '..', '..');

/** The criteria's IDs: the first 8 hex digits of SHA-256 of each criterion's text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #1928.ceaee399',
  2: 'AC2 #1928.52811717',
  3: 'AC3 #1928.a6a07f62',
  4: 'AC4 #1928.7f908e67',
  5: 'AC5 #1928.b81c59f3',
  6: 'AC6 #1928.d0733dd4',
  7: 'AC7 #1928.b7a3ee7e',
  8: 'AC8 #1928.415a3836',
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
function v3(value: JsonValue | undefined, what: string): V3 {
  const a = arr(value, what);
  expect(a.length, `${what} has three numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
}
function v2(value: JsonValue | undefined, what: string): V2 {
  const a = arr(value, what);
  expect(a.length, `${what} has two numbers`).toBe(2);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`)];
}
export const shown = (v: JsonValue | undefined): string => JSON.stringify(v)?.slice(0, 1500) ?? 'undefined';

/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one that names each of `names` (a text it holds, or a pattern it matches): what a planted program must give. */
export function failsNaming(failures: readonly string[], names: readonly (string | RegExp)[], what: string): void {
  expect(failures.length, `${what} fails this check, but the check found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => (typeof name === 'string' ? f.includes(name) : name.test(f))), `${what}: a failure names ${String(name)}; the failures were:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(true);
  }
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
    dir = mkdtempSync(join(tmpdir(), 'deep-1928-bin-'));
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1928-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: the scenario (#393, #420), documents and calls.

/** Scenario `planted` values this suite adds, each a wrong program reachable only there (README: planted values). */
export type Planted =
  | 'offset_along_bisector'
  | 'offset_depth_along_y'
  | 'offset_corner_along_edges'
  | 'offset_too_wide_unchecked'
  | 'dissolve_keeps_straight_points'
  | 'dissolve_merges_pairs'
  | 'offset_first_corner'
  | 'offset_drops_wear'
  | 'offset_inner_unparted';

const AGENT = { id: 'sess-alpha', thread: 'thread-alpha', name: 'An agent: face offsets and dissolve', process: { pid: 4100, start: 1_000 } };
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 },
  { pid: 3000, ppid: 1, start: 100 },
  { pid: 3001, ppid: 3000, start: 110 },
  { pid: 4100, ppid: 3001, start: 1_000 },
];
/** Document IDs the hub minted. */
export const DOC = { a: '01JB1928D00000000000000001', b: '01JB1928D00000000000000002' } as const;

/**
 * A scenario: the agent's session, the process table, one panel per document (visible, but for the documents in
 * `hidden`, whose panels the base's `visible: false` hides), an optional `planted`, and the calls.
 */
export function scenario(evidence: string, docs: readonly string[], calls: JsonObject[], planted?: Planted, hidden: readonly string[] = []): JsonObject {
  const docsOut: JsonObject = {};
  const panels: JsonObject = {};
  docs.forEach((id, i) => {
    docsOut[id] = { panel: `p${i + 1}` };
    panels[`p${i + 1}`] = hidden.includes(id) ? { rect: [0, 0, 800, 600], visible: false } : { rect: [0, 0, 800, 600] };
  });
  const out: JsonObject = {
    evidence,
    sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: AGENT.process } },
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
  expect(answer['ok'], `deep-show run refused the scenario${sc['planted'] === undefined ? '' : ` (planted: ${String(sc['planted'])})`}: ${shown(answer)}`).toBe(true);
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
    format: 1, profile: 'scene', title, description: `${title}: a #1928 acceptance fixture.`, size: [480, 360], camera: 'cam',
    requires: { modules: { scene3d: '^1' } }, items: withIds,
  };
}

/** The issue's 1 m slab cube: x and z from −0.5 to 0.5 m, y from 0 to 1 m, its parts `top`, `side` and `bottom`. */
export const CUBE: JsonObject = { size: [1, 1, 1] };
/** The issue's L-shaped slab, 1 m thick: its outline in plan (x, z), y from 0 to 1 m. */
export const ELL: JsonObject = { outline: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], thickness: 1 };
/** A `mod.offset_faces@1` entry of a modifier stack. */
export const offsetFaces = (params: JsonObject): JsonObject => ({ kind: 'mod.offset_faces@1', params });
/** A `mod.dissolve@1` entry at its default angle of 1°. */
export const dissolve = (): JsonObject => ({ kind: 'mod.dissolve@1', params: {} });

/** The agent's `deep_show`: a whole revision of `document` with its issues (#393). */
export const show = (doc: string, document: JsonObject): JsonObject =>
  ({ call: 'deep_show', session: AGENT.id, doc, document, include: ['issues'] });

/** The `geometry` call's options, as #420 and #440 left them. */
export interface GeometryOptions { stage?: 'built' | 'final'; estimate_only?: boolean; blocks?: 1; rotate_corners?: number }
export const geometryCall = (doc: string, items: string[], o: GeometryOptions = {}): JsonObject =>
  ({ call: 'geometry', doc, items, t: '0s', ...(o as JsonObject) });

export interface Issue { code: string; severity: string; raw: JsonObject }
/** A `deep_show` reply's issues. */
export function issuesOf(reply: JsonObject, what: string): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return { code: str(o['code'], `${what}: issues[${i}].code`), severity: str(o['severity'], `${what}: issues[${i}].severity`), raw: o };
  });
}
/** A field an issue names (`item`, `face`, `by`, `max`, `faces`): on the issue itself or in its `actual`. */
export const fieldOf = (i: Issue, key: string): JsonValue | undefined => i.raw[key] ?? (isObject(i.raw['actual']) ? i.raw['actual'][key] : undefined);
/** A revision presented with no error issue and no item skipped as an unknown kind (the base's notice); its issues. */
export function admitted(reply: JsonObject | undefined, what: string): Issue[] {
  const r = obj(reply, `${what}: the deep_show reply`);
  const list = issuesOf(r, what);
  expect(list.filter((i) => i.severity === 'error').map((e) => shown(e.raw)), `${what}: no error issue`).toEqual([]);
  const skipped = arr(r['notices'] ?? [], `${what}: notices`).filter((n) => isObject(n) && n['code'] === 'unknown_kind');
  expect(skipped.map((n) => shown(n)), `${what}: no item skipped as an unknown kind`).toEqual([]);
  expect(r['outcome'], `${what}: presented, got ${shown(r)}`).toBe('presented');
  return list;
}

// ---------------------------------------------------------------------------------------------------
// `geometry` replies: a builder row's mesh with its face IDs, parts, uv0, face attributes, declared counts and
// block count. A field a criterion needs is read where it needs it, so a missing one fails there, naming it.

export interface MeshRow { id: string; raw: JsonObject; positions: V3[]; indices: number[]; faces: number[]; view: View }

function rowOf(reply: JsonObject | undefined, id: string, what: string): JsonObject {
  const r = obj(reply, `${what}: the geometry reply`);
  expect(r['code'], `${what} was answered, not refused: ${shown(r)}`).toBeUndefined();
  const rows = arr(r['items'], `${what}: items`).map((row, i) => obj(row, `${what}: items[${i}]`));
  const row = rows.find((x) => x['id'] === id);
  expect(row, `${what}: the reply holds ${id}: ${shown(r)}`).toBeDefined();
  return row!;
}
/** `builds` of a geometry reply. */
export const buildsOf = (reply: JsonObject | undefined, what: string): number => num(obj(reply, `${what}: the geometry reply`)['builds'], `${what}: builds`);
export interface Declared { vertices: number; points: number; edges: number; faces: number }
/** A row's declared counts: its vertices, and its welded points, edges and faces. */
export function declaredOf(reply: JsonObject | undefined, id: string, what: string): Declared {
  const d = obj(rowOf(reply, id, what)['declared'], `${what}: ${id}.declared`);
  return {
    vertices: num(d['vertices'], `${what}: ${id}.declared.vertices`), points: num(d['points'], `${what}: ${id}.declared.points`),
    edges: num(d['edges'], `${what}: ${id}.declared.edges`), faces: num(d['faces'], `${what}: ${id}.declared.faces`),
  };
}
/** A builder item's row: its mesh in item space, one face ID per triangle, and the polygon view the references read. */
export function meshRow(reply: JsonObject | undefined, id: string, what: string): MeshRow {
  const o = rowOf(reply, id, what);
  const positions = arr(o['positions'], `${what}: ${id}.positions`).map((p, k) => v3(p, `${what}: ${id}.positions[${k}]`));
  const indices = arr(o['indices'], `${what}: ${id}.indices`).map((x, k) => num(x, `${what}: ${id}.indices[${k}]`));
  expect(indices.length % 3, `${what}: ${id}.indices hold whole triangles`).toBe(0);
  expect(indices.every((i) => Number.isInteger(i) && i >= 0 && i < positions.length), `${what}: ${id}.indices index its positions`).toBe(true);
  const faces = arr(o['faces'], `${what}: ${id}.faces`).map((x, k) => num(x, `${what}: ${id}.faces[${k}]`));
  expect(faces.length, `${what}: ${id} has one face ID per triangle`).toBe(indices.length / 3);
  return { id, raw: o, positions, indices, faces, view: polygons(positions, indices, faces) };
}
/** The parts each face lies in: every part that holds one of its triangles, by the row's `parts` (part → triangles). */
export function partsOfFaces(row: MeshRow, what: string): Map<number, string[]> {
  const parts = obj(row.raw['parts'], `${what}: ${row.id}.parts`);
  const ofTriangle = new Map<number, string[]>();
  for (const [name, tris] of Object.entries(parts)) {
    for (const t of arr(tris, `${what}: ${row.id}.parts.${name}`)) ofTriangle.set(num(t, `${what}: ${row.id}.parts.${name}[]`), [...(ofTriangle.get(t as number) ?? []), name]);
  }
  return new Map(row.view.faces.map((f: Face) => [f.id, [...new Set(f.tris.flatMap((t) => ofTriangle.get(t) ?? []))].sort()]));
}
/** `uv0`: one [u, v] per position. */
export function uv0Of(row: MeshRow, what: string): V2[] {
  const uv = arr(row.raw['uv0'], `${what}: ${row.id}.uv0`).map((x, k) => v2(x, `${what}: ${row.id}.uv0[${k}]`));
  expect(uv.length, `${what}: ${row.id} has one uv0 per position`).toBe(row.positions.length);
  return uv;
}
/** `blocks`: the block count the item's build ran at. */
export const blocksOf = (row: MeshRow, what: string): number => num(row.raw['blocks'], `${what}: ${row.id}.blocks`);
