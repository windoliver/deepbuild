// Test-side tools for the #1929 acceptance tests (README: The surface under test). They drive the one binary the
// base has for built geometry read as data, `deep-show run` (#393), with `deep_show` and #420's `geometry` call
// (#224's `play`), as the sibling suites do, and hold what it answers to the issue's numbers and to the closed forms
// in reference.ts. Copied here, since suites never import each other: the runner and the build (#420's, #224's), the
// issue reading (#224's `fieldOf` and `names`). Each judge returns its failures as sentences that name what failed:
// a vertex as `<item> vertex <index>`, an item by its ID. Nothing here stands in for a deform, its bind, its check
// or the frame.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import {
  add, edgeKey, fmt, fmtV, lowestAtPlace, signedVolume, sub,
  type Box, type Cage, type V3,
} from './reference.ts';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/1929 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');

/** Each criterion's tag: `AC<n> #1929.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #1929.eabb0101',
  2: 'AC2 #1929.c629697d',
  3: 'AC3 #1929.9ba17166',
  4: 'AC4 #1929.2bce5ff8',
  5: 'AC5 #1929.f933a85f',
  6: 'AC6 #1929.ef5c1f92',
  7: 'AC7 #1929.303648a3',
} as const;
export const TIMEOUT = 900_000;

// ---------------------------------------------------------------------------------------------------
// JSON

export function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export const shown = (v: JsonValue | undefined, n = 1500): string => (JSON.stringify(v) ?? 'undefined').slice(0, n);
export function obj(value: JsonValue | undefined, what: string): JsonObject {
  expect(isObject(value), `${what} is an object, got ${shown(value, 600)}`).toBe(true);
  return value as JsonObject;
}
export function arr(value: JsonValue | undefined, what: string): JsonValue[] {
  expect(Array.isArray(value), `${what} is an array, got ${shown(value, 600)}`).toBe(true);
  return value as JsonValue[];
}
export function num(value: JsonValue | undefined, what: string): number {
  expect(typeof value === 'number' && Number.isFinite(value), `${what} is a finite number, got ${shown(value, 200)}`).toBe(true);
  return value as number;
}
export const clone = <T extends JsonValue>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
}
/** At least one failure, and one naming each of `names`: what a wrong program must give. */
export function failsNaming(failures: readonly string[], names: readonly string[], what: string): void {
  expect(failures.length, `${what} fails the judge, but the judge found nothing wrong`).toBeGreaterThan(0);
  for (const name of names) {
    expect(failures.some((f) => f.includes(name)), `${what}: a failure names "${name}"; the failures were:\n  ${failures.slice(0, 40).join('\n  ')}`).toBe(true);
  }
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` in the `full` set, built once per file and copied out of the target folder.

const CARGO = ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', 'full'];
const exe = (name: string): string => (process.platform === 'win32' ? `${name}.exe` : name);
function cargoBuild(): string {
  const env: NodeJS.ProcessEnv = { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
  // Homebrew's rustup, where a Mac has it, reads rust-toolchain.toml's pin; elsewhere cargo is the PATH's.
  const rustup = '/opt/homebrew/opt/rustup/bin';
  if (existsSync(rustup)) env['PATH'] = `${rustup}${delimiter}${env['PATH'] ?? ''}`;
  const run = spawnSync('cargo', CARGO, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env });
  if (run.error) return `BLOCKED: cargo could not run (${run.error.message}); install the toolchain rust-toolchain.toml pins. This is not a pass`;
  if (run.status !== 0) return `cargo ${CARGO.join(' ')} failed:\n${(run.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Download|Updating|Locking/.test(l)).join('\n').slice(-4000)}`;
  return '';
}
/** Builds `deep-show` before the file's tests; a test whose build failed fails with cargo's error. */
export function useBin(): () => string {
  let dir = '';
  let error = 'the build did not run';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-1929-bin-'));
    error = cargoBuild();
    if (error === '') copyFileSync(join(process.env['CARGO_TARGET_DIR'] ?? join(REPO, 'target'), 'debug', exe('deep-show')), join(dir, exe('deep-show')));
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
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'deep-1929-')); });
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return () => dir;
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, one reply per call (#393).

/** The wrong programs this suite plants, each reachable only through the scenario's `planted` (README: The planted programs). */
export type Planted =
  | 'box_deform_own_bounds' | 'box_deform_trilinear_cells' | 'box_deform_drops_last_weight' | 'box_deform_clamps_outside'
  | 'mesh_deform_inverse_distance' | 'mesh_deform_binds_every_frame' | 'mesh_deform_key_without_mesh' | 'mesh_deform_extrapolates_outside';

export const SESSION = 'sess-alpha';
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
/** Document IDs the hub minted. */
export const DOC = { a: ulid('01JB1929D', 1), b: ulid('01JB1929D', 2), c: ulid('01JB1929D', 3), d: ulid('01JB1929D', 4) } as const;

/** A scenario: the agent's session, its process tree, one visible panel per document, an optional `planted`, and the calls. */
export function scenario(evidence: string, docs: readonly string[], calls: JsonObject[], planted?: Planted): JsonObject {
  const docsOut: JsonObject = {};
  const panels: JsonObject = {};
  docs.forEach((id, i) => {
    docsOut[id] = { panel: `p${i + 1}` };
    panels[`p${i + 1}`] = { rect: [0, 0, 800, 600] };
  });
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: box and mesh deforms', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }],
    panels, docs: docsOut, calls,
    ...(planted === undefined ? {} : { planted }),
  };
}

/** One `deep-show run` process: exit 0, one line, `ok`, one reply per call. An unknown `planted` name is refused here. */
export function runShow(bin: string, sc: JsonObject): JsonObject[] {
  // A run that hangs is stopped by spawnSync's own timeout, which signals only this child.
  const run = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: TIMEOUT, killSignal: 'SIGKILL' });
  const timedOut = run.error !== undefined && (run.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  expect(run.error === undefined || timedOut, `deep-show run started: ${run.error?.message ?? ''}`).toBe(true);
  expect(timedOut, 'deep-show run finished within its timeout').toBe(false);
  const stdout = run.stdout ?? '';
  expect(run.status, `deep-show run exits 0 (${run.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(run.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((line) => line !== '');
  expect(lines.length, 'deep-show run: one output line per input line').toBe(1);
  let answer: JsonValue = null;
  try { answer = JSON.parse(lines[0]!) as JsonValue; } catch { expect.fail(`deep-show run: its line is JSON: ${lines[0]!.slice(0, 1500)}`); }
  const out = obj(answer, 'deep-show run: the answer');
  const planted = typeof sc['planted'] === 'string' ? ` (its planted program is ${sc['planted']})` : '';
  expect(out['ok'], `deep-show run accepted the scenario${planted}: ${shown(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], 'deep-show run: replies').map((r, i) => obj(r, `deep-show run: replies[${i}]`));
  expect(replies.length, 'deep-show run: one reply per call').toBe(arr(sc['calls'], 'the scenario\'s calls').length);
  return replies;
}

/** The agent's `deep_show`: a whole revision of `document`, with its issues (#393). */
export const show = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });

/** A second is 705,600,000 flicks; the criteria's frames are 30 a second. */
export const FLICKS_PER_SECOND = 705_600_000;
export const FPS = 30;
/** Frame k's time in flicks. */
export const frameTime = (k: number): number => k * (FLICKS_PER_SECOND / FPS);
/**
 * #420's `geometry` call for `items` at stage final, in the items' own space. With no `frame`, a clean evaluation at
 * 0 s. `sought` is a clean evaluation at `frame`'s time; `played` plays every frame from 0 to `frame` in order at
 * 30 fps through the session's frame path and reads the rows the played frame holds (#224's `play`).
 */
export function geometry(doc: string, items: readonly string[], at: { sought: number } | { played: number } | undefined = undefined): JsonObject {
  const call: JsonObject = { call: 'geometry', doc, items: [...items] };
  if (at === undefined) return call;
  return 'played' in at ? { ...call, t: frameTime(at.played), play: { fps: FPS } } : { ...call, t: frameTime(at.sought) };
}

// ---------------------------------------------------------------------------------------------------
// The check's issues, as `deep_show` answers them (#393), and a revision's outcome.

export const outcome = (reply: JsonObject): string => String(reply['outcome']);
export interface Issue { code: string; severity: string; ids: string[]; path: string; raw: JsonObject }
export function issuesOf(reply: JsonObject, what: string): Issue[] {
  return arr(reply['issues'] ?? [], `${what}: issues`).map((v, i) => {
    const o = obj(v, `${what}: issues[${i}]`);
    return {
      code: String(o['code']), severity: String(o['severity']), path: typeof o['path'] === 'string' ? o['path'] : '',
      ids: Array.isArray(o['ids']) ? o['ids'].filter((x): x is string => typeof x === 'string') : [], raw: o,
    };
  });
}
/** An issue's field, on the issue itself or in its `actual` (as #224's and #537's issues carry theirs). */
export const fieldOf = (i: Issue, key: string): JsonValue | undefined => i.raw[key] ?? (isObject(i.raw['actual']) ? i.raw['actual'][key] : undefined);
/** Whether an issue names item `id`: as its `item`, in its `ids`, or by its path (the base's three ways). */
export const namesItem = (i: Issue, id: string): boolean => fieldOf(i, 'item') === id || i.ids.includes(id) || i.path === `items/${id}` || i.path.startsWith(`items/${id}/`);
/** A revision presented with no error issue and no item skipped as a kind the build doesn't know (the base's notice). */
export function admitted(reply: JsonObject, what: string): void {
  const errors = issuesOf(reply, what).filter((i) => i.severity === 'error');
  expect(errors.map((e) => shown(e.raw, 700)), `${what}: no error issue`).toEqual([]);
  const skipped = arr(reply['notices'] ?? [], `${what}: notices`).filter((n) => isObject(n) && n['code'] === 'unknown_kind');
  expect(skipped.map((n) => shown(n, 700)), `${what}: no item skipped as an unknown kind`).toEqual([]);
  expect(outcome(reply), `${what}: presented, got ${shown(reply)}`).toBe('presented');
}

// ---------------------------------------------------------------------------------------------------
// `geometry` rows: an item's mesh after its stack, in its own space, and its stack's rows.

export interface StackRow { kind: string; raw: JsonObject }
export interface Row { id: string; positions: V3[]; normals: V3[]; indices: number[]; stack: StackRow[]; raw: JsonObject }
function vec3s(value: JsonValue | undefined, what: string): V3[] {
  return arr(value, what).map((v, i) => {
    const p = arr(v, `${what}[${i}]`);
    expect(p.length === 3 && p.every((x) => typeof x === 'number' && Number.isFinite(x)), `${what}[${i}] is three finite numbers, got ${shown(v, 200)}`).toBe(true);
    return p as V3;
  });
}
/** A `geometry` reply's row for `id`: answered, built, with its positions, normals, indices and stack. */
export function rowOf(reply: JsonObject, id: string, what: string): Row {
  expect(reply['code'], `${what}: geometry answered, not refused: ${shown(reply)}`).toBeUndefined();
  const raw = arr(reply['items'], `${what}: items`).filter(isObject).find((r) => r['id'] === id);
  expect(raw, `${what}: the reply has a row for ${id}`).toBeDefined();
  const row = raw!;
  const positions = vec3s(row['positions'], `${what}: ${id}.positions`);
  expect(positions.length, `${what}: ${id} builds vertices`).toBeGreaterThan(0);
  const indices = arr(row['indices'], `${what}: ${id}.indices`).map((v, i) => num(v, `${what}: ${id}.indices[${i}]`));
  expect(indices.length % 3 === 0 && indices.every((i) => Number.isInteger(i) && i >= 0 && i < positions.length), `${what}: ${id}.indices are triangles over its positions`).toBe(true);
  const stack = arr(row['stack'], `${what}: ${id}.stack`).map((v, k) => {
    const o = obj(v, `${what}: ${id}.stack[${k}]`);
    return { kind: String(o['kind']), raw: o };
  });
  return { id, positions, normals: vec3s(row['normals'], `${what}: ${id}.normals`), indices, stack, raw: row };
}
/** How many vertices a `geometry` reply's row for `id` holds, 0 with no such row: what shows that a planted program built the item. */
export function builtVertices(reply: JsonObject, id: string): number {
  const row = (Array.isArray(reply['items']) ? reply['items'] : []).filter(isObject).find((r) => r['id'] === id);
  return row && Array.isArray(row['positions']) ? row['positions'].length : 0;
}
/** Where two rows first differ in a bit of a position, a normal or an index, or '' (−0 is not 0 here). */
export function firstDifference(a: Row, b: Row): string {
  for (const [name, x, y] of [['positions', a.positions, b.positions], ['normals', a.normals, b.normals]] as const) {
    if (x.length !== y.length) return `${name}: ${x.length} against ${y.length}`;
    for (let i = 0; i < x.length; i++) for (let k = 0; k < 3; k++) {
      if (!Object.is(x[i]![k], y[i]![k])) return `${name}[${i}][${k}]: ${fmt(x[i]![k]!)} against ${fmt(y[i]![k]!)}`;
    }
  }
  if (a.indices.length !== b.indices.length) return `indices: ${a.indices.length} against ${b.indices.length}`;
  const at = a.indices.findIndex((v, i) => v !== b.indices[i]);
  return at < 0 ? '' : `indices[${at}]: ${a.indices[at]} against ${b.indices[at]}`;
}

// ---------------------------------------------------------------------------------------------------
// The documents (README: Fixtures). Metres, +Y up; an agent's payload for deep_show (no `id`, no `layers`).

/** A scene document's envelope around `items`, with a still camera. */
export function sceneDoc(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}): JsonObject {
  const all: Record<string, JsonObject> = { cam: { kind: 'camera@1', params: { projection: 'perspective', position: [6, 5, 8], target: [0, 0.5, 0], fov: 40 } }, ...items };
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(all)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #1929 acceptance fixture.`, size: [480, 360], camera: 'cam',
    requires: { modules: { scene3d: '^1' } }, ...extra, items: withIds,
  };
}
/** `subdivide {scheme: simple}` at level 1: each face split at its edge midpoints and its centre. */
export const SUBDIVIDE: JsonObject = { kind: 'mod.subdivide@1', params: { levels: 1, scheme: 'simple' } };
/** The 1 m slab cube under `subdivide {scheme: simple}` at level 1, then `modifiers`. */
export const cube = (modifiers: JsonObject[] = []): JsonObject => ({ kind: 'slab@1', params: { size: [1, 1, 1] }, modifiers: [clone(SUBDIVIDE), ...modifiers] });
/** Where the cube's centre is in its item's own space: the base's slab stands on its origin (`cubeOf` holds it to that). */
export const CENTRE: V3 = [0, 0.5, 0];
/** The 2 m box centred on the cube. */
export const BOX_2M: { from: V3; to: V3 } = { from: sub(CENTRE, [1, 1, 1]), to: add(CENTRE, [1, 1, 1]) };
/** `mod.box_deform@1` with the issue's fields. */
export const boxDeform = (b: Box): JsonObject => ({ kind: 'mod.box_deform@1', params: { from: [...b.from], to: [...b.to], points: [...b.points], moves: b.moves.map((m) => [...m]) } });
/** `mod.mesh_deform@1` with the issue's fields. */
export const meshDeform = (cage: Cage, moves: readonly V3[]): JsonObject =>
  ({ kind: 'mod.mesh_deform@1', params: { mesh: { points: cage.points.map((p) => [...p]), triangles: cage.triangles.map((t) => [...t]) }, moves: moves.map((m) => [...m]) } });
export const zeros = (n: number): V3[] => Array.from({ length: n }, (): V3 => [0, 0, 0]);

// ---------------------------------------------------------------------------------------------------
// The fixture cube, read from the build and checked: 26 points, 8 corners, 12 edge midpoints, 6 face centres.

/** A point's place on the cube: −1, 0 or 1 along each axis, its offset from the centre over 0.5 m. */
export type Place = [number, number, number];
export interface Cube {
  /** The stack's mesh before a deform: the subdivided cube's vertices, in the order every deform keeps. */
  input: V3[];
  indices: number[];
  /** For each vertex, the lowest index among the vertices at its place: its name. */
  low: number[];
  /** Each of the 26 points: its place and its name. */
  points: { place: Place; vertex: number; at: V3 }[];
}
const placeKey = (p: readonly number[]): string => p.join(',');
/** The cube `plain`'s row builds, held to the criteria's fixture so a wrong one cannot pass silently. */
export function cubeOf(plain: Row): Cube {
  const low = lowestAtPlace(plain.positions);
  const points: Cube['points'] = [];
  plain.positions.forEach((p, i) => {
    const offset = sub(p, CENTRE);
    expect(offset.every((o) => o === 0 || Math.abs(o) === 0.5), `the fixture cube's vertex ${i} is 0 or 0.5 m from the centre ${fmtV(CENTRE)} along each axis, got ${fmtV(p)}`).toBe(true);
    if (low[i] === i) points.push({ place: placeOf(p), vertex: i, at: p });
  });
  const zeros = (p: Place): number => p.filter((s) => s === 0).length;
  expect(new Set(points.map((p) => placeKey(p.place))).size, 'the fixture cube\'s welded points are distinct places').toBe(points.length);
  expect([points.length, ...[0, 1, 2, 3].map((z) => points.filter((p) => zeros(p.place) === z).length)],
    'the subdivided 1 m slab cube has 26 points: 8 corners, 12 edge midpoints, 6 face centres and none inside').toEqual([26, 8, 12, 6, 0]);
  const volume = signedVolume(plain.positions, plain.indices);
  expect(Math.abs(volume - 1) <= 1e-12, `the fixture cube is closed, wound outward and holds 1 m³, got ${fmt(volume)}`).toBe(true);
  return { input: plain.positions, indices: plain.indices, low, points };
}
/** The fixture cube's 26 points as the criteria give them, read from no program: where a judge is proven on this suite's own twins. */
export function modelCube(): Cube {
  const points: Cube['points'] = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    if (x !== 0 || y !== 0 || z !== 0) points.push({ place: [x, y, z], vertex: points.length, at: add(CENTRE, [0.5 * x, 0.5 * y, 0.5 * z]) });
  }
  return { input: points.map((p) => p.at), indices: [], low: points.map((p) => p.vertex), points };
}
/** A row whose vertices are `cube`'s, each moved by `move`: what a deform computed here would answer. */
export const movedBy = (cube: Cube, id: string, move: (p: V3) => V3): Row =>
  ({ id, positions: cube.input.map((p) => add(p, move(p))), normals: [], indices: cube.indices, stack: [], raw: {} });
/** Where a vertex of the cube is: −1, 0 or 1 along each axis. */
export const placeOf = (p: V3): Place => sub(p, CENTRE).map((o) => o / 0.5 + 0) as Place;
/** The name of the cube's point at `place`. */
export function vertexAt(cube: Cube, place: Place): number {
  const hit = cube.points.find((p) => placeKey(p.place) === placeKey(place));
  expect(hit, `the fixture cube has a point at place ${fmtV(place)}`).toBeDefined();
  return hit!.vertex;
}
/** The names of the cube's points that `pick` takes, rising. */
export const verticesWhere = (cube: Cube, pick: (place: Place) => boolean): number[] => cube.points.filter((p) => pick(p.place)).map((p) => p.vertex).sort((a, b) => a - b);
/** What a point is: a corner, an edge midpoint or a face centre. */
export const kindOf = (place: Place): 'corner' | 'edge midpoint' | 'face centre' => (['corner', 'edge midpoint', 'face centre'] as const)[place.filter((s) => s === 0).length]!;

// ---------------------------------------------------------------------------------------------------
// The judges.

/** How close a number must be to its expected value. */
export interface Within { ok: (got: number, want: number) => boolean; text: string }
/** Within `rel` relative; a value expected at 0 within `rel` m. */
export const withinRel = (rel: number): Within => ({ ok: (got, want) => (want === 0 ? Math.abs(got) <= rel : Math.abs(got - want) <= rel * Math.abs(want)), text: `within ${rel} relative` });
/** Within `abs` m. */
export const withinAbs = (abs: number): Within => ({ ok: (got, want) => Math.abs(got - want) <= abs, text: `within ${abs} m` });

/** How far `row` moved each of the cube's vertices from its input. */
export const movesOf = (cube: Cube, row: Row): V3[] => row.positions.map((p, i) => sub(p, cube.input[i] ?? [Number.NaN, Number.NaN, Number.NaN]));

/**
 * The judge of a deform: every vertex of `row` moved from its input by `want(its input place)`, on each axis. A
 * failure names its vertex, `<item> vertex <index>`, once per welded point.
 */
export function moveProblems(cube: Cube, row: Row, want: (p: V3) => V3, within: Within): string[] {
  if (row.positions.length !== cube.input.length) return [`${row.id}: ${row.positions.length} vertices, its input ${cube.input.length}; a deform keeps their count and order`];
  const out = new Map<number, string>();
  movesOf(cube, row).forEach((moved, i) => {
    const w = want(cube.input[i]!);
    const name = cube.low[i]!;
    if (out.has(name) || [0, 1, 2].every((k) => within.ok(moved[k]!, w[k]!))) return;
    out.set(name, `${row.id} vertex ${name} at ${fmtV(cube.input[i]!)}: moved ${fmtV(moved)} m, want ${fmtV(w)} m ${within.text}`);
  });
  return [...out.values()];
}

/** What a refusal at check must show: the item, the issue's code, and the vertices or control-mesh edges it names. */
export interface Refusal { id: string; code: string; vertices?: readonly number[]; edges?: readonly string[] }
const integers = (v: JsonValue | undefined): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0);
/**
 * The judge of a refusal at check with 0 builds. `shown` is the revision's `deep_show` reply, `built` the reply of a
 * `geometry` call for the item made after it. The revision is refused; an error issue of `code` names the item; its
 * `vertices` name exactly the expected points, each once, by a vertex index of the stack's mesh before the modifier
 * (README: Naming a vertex); its `edges` name exactly the expected control-mesh edges, each by its two point indices;
 * and nothing was built: `geometry` answers the base's `no_revision`, or `builds: 0` with no mesh.
 */
export function refusalProblems(shownReply: JsonObject, built: JsonObject, want: Refusal, cube?: Cube): string[] {
  const out: string[] = [];
  const all = issuesOf(shownReply, want.id);
  if (outcome(shownReply) !== 'refused') out.push(`${want.id}: the revision is ${outcome(shownReply)}, want refused at check with ${want.code}`);
  const hits = all.filter((i) => i.code === want.code && i.severity === 'error');
  if (hits.length === 0) out.push(`${want.id}: no error issue ${want.code}; the check raised [${all.map((i) => `${i.code} at ${i.path}`).join('; ')}]`);
  const issue = hits.find((i) => namesItem(i, want.id));
  if (hits.length > 0 && !issue) out.push(`${want.id}: the ${want.code} issue does not name the item: ${shown(hits[0]!.raw, 600)}`);
  if (issue && want.vertices && cube) {
    const listed = fieldOf(issue, 'vertices');
    if (!integers(listed) || listed.some((v) => v >= cube.input.length)) out.push(`${want.id}: ${want.code}'s vertices are not vertex indices of the mesh before the modifier: ${shown(listed, 400)}`);
    else {
      const named = listed.map((v) => cube.low[v]!);
      const place = (v: number): string => fmtV(cube.input[v]!);
      for (const v of want.vertices) if (!named.includes(v)) out.push(`${want.id}: ${want.code} does not name vertex ${v} at ${place(v)}`);
      for (const v of new Set(named)) {
        if (!want.vertices.includes(v)) out.push(`${want.id}: ${want.code} names vertex ${v} at ${place(v)}, which the criterion does not`);
        if (named.filter((n) => n === v).length > 1) out.push(`${want.id}: ${want.code} names the point of vertex ${v} at ${place(v)} more than once`);
      }
    }
  }
  if (issue && want.edges) {
    const listed = fieldOf(issue, 'edges');
    if (!Array.isArray(listed) || !listed.every((e) => integers(e) && e.length === 2)) out.push(`${want.id}: ${want.code}'s edges are not pairs of control point indices: ${shown(listed, 400)}`);
    else {
      const named = (listed as number[][]).map(([a, b]) => edgeKey(a!, b!));
      for (const e of want.edges) if (!named.includes(e)) out.push(`${want.id}: ${want.code} does not name the open edge ${e}`);
      for (const e of new Set(named)) {
        if (!want.edges.includes(e)) out.push(`${want.id}: ${want.code} names edge ${e}, which is not open`);
        if (named.filter((n) => n === e).length > 1) out.push(`${want.id}: ${want.code} names edge ${e} more than once`);
      }
    }
  }
  out.push(...buildProblems(built, want.id));
  return out;
}
/** What shows a build after a refusal: `geometry` answers neither the base's `no_revision` nor `builds: 0` with no mesh. */
export function buildProblems(built: JsonObject, id: string): string[] {
  if (built['code'] === 'no_revision') return [];
  if (built['code'] !== undefined) return [`${id}: geometry answers ${shown(built['code'])} after the refusal, want no_revision or 0 builds`];
  const out: string[] = [];
  if (built['builds'] !== 0) out.push(`${id}: geometry counts ${shown(built['builds'])} build(s) after the refusal, want 0 builds`);
  const meshes = (Array.isArray(built['items']) ? built['items'] : []).filter((r) => isObject(r) && Array.isArray(r['positions']) && r['positions'].length > 0);
  if (meshes.length > 0) out.push(`${id}: geometry answers a built mesh after the refusal, want 0 builds`);
  return out;
}

/**
 * How many computations of the bind of `row`'s step of `kind` the frames a played `geometry` call played made or
 * were the first to read: the stack row's `work.binds` (README: The stack's work counters). NaN where the row
 * doesn't say.
 */
export function bindsOf(row: Row, kind: string): number {
  const work = row.stack.find((s) => s.kind === kind)?.raw['work'];
  const binds = isObject(work) ? work['binds'] : undefined;
  return typeof binds === 'number' && Number.isInteger(binds) && binds >= 0 ? binds : Number.NaN;
}
/** The judge of a bind count: a failure names the item. */
export function bindProblems(row: Row, kind: string, want: number, over: string): string[] {
  const binds = bindsOf(row, kind);
  if (binds === want) return [];
  const got = Number.isNaN(binds) ? `no count (no whole number at its stack row's work.binds: ${shown(row.stack.find((s) => s.kind === kind)?.raw, 300)})` : `the bind computed ${binds} time(s)`;
  return [`${row.id}: ${over}, its ${kind} step's work counters show ${got}, want ${want}`];
}
