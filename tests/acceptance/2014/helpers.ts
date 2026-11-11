// Test-side tools for the #2014 acceptance tests: `deep-show` built with cargo and driven by JSON lines (#393's
// `deep-show run`, #420's `geometry` call, #411's `deep_query` and this suite's `terrain_rays` call, README: The
// surface under test); the documents the criteria describe, generated here so every file judges the same ones; and the
// judges the tests compute themselves (the height of drawn triangles over a point, a ball's gap to them, the spread of
// the readings at a cell's centre, the cap's refusal). Nothing here stands in for the plate, its physics shape, the
// pick or rest_on: every value a test compares comes from the binary, every expected value from the issue's text and
// the design. The build, `run` and the scenario are copied from #2013's helpers, since suites don't import each other.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

const HERE = dirname(fileURLToPath(import.meta.url));
/** The checkout root (tests/acceptance/2014 is three levels down). */
export const REPO = join(HERE, '..', '..', '..');
export const SHOW = 'deep-show';
const TARGET_DIR = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
/** Builds stay light: no incremental cache, no debug info (the caller's settings win). */
const CARGO_ENV = { CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' };
/** Every `it` passes a timeout: a first build of `deep-show` takes many minutes on a loaded machine. */
export const TIMEOUT = 3_600_000;

/** The criteria's IDs: `#2014.` and the first 8 hex digits of SHA-256 of each criterion's text (scripts/proof-change.mjs). */
export const AC = { 1: '#2014.13d18756', 2: '#2014.be2d6fcd' } as const;
/** The issue's agreement: 1e-6 m. */
export const TOL = 1e-6;

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
export function num(v: JsonValue | undefined, what: string): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${what} is a finite number, got ${brief(v)}`).toBe(true);
  return v as number;
}
/** No failures; the message lists them. */
export function none(failures: readonly string[], what: string): void {
  expect(failures, `${what}:\n  ${failures.slice(0, 20).join('\n  ')}`).toEqual([]);
}

// ---------------------------------------------------------------------------------------------------
// The build: `deep-show` with every module, copied out of target/.

const CARGO_ARGS = ['build', '--locked', '--bin', SHOW, '--no-default-features', '--features', 'full'];

/** Builds `deep-show` once, before the file's tests; a test whose build failed fails with cargo's error. */
export function useShow(): () => string {
  let dir = '';
  let made = { bin: '', error: 'the build did not run' };
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-2014-bin-'));
    const r = spawnSync('cargo', CARGO_ARGS, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
    if (r.error) { made = { bin: '', error: `cargo could not run: ${r.error.message}` }; return; }
    if (r.status !== 0) {
      const lines = (r.stderr ?? '').split('\n').filter((l) => !/Blocking waiting|Compiling|Finished|Downloaded|Downloading/.test(l));
      made = { bin: '', error: `cargo ${CARGO_ARGS.join(' ')} failed:\n${lines.join('\n').slice(-4000)}` };
      return;
    }
    const bin = join(dir, SHOW);
    copyFileSync(join(TARGET_DIR, 'debug', SHOW), bin);
    made = { bin, error: '' };
  }, 7_200_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = ''; });
  return (): string => {
    expect(made.error, `the binary builds: cargo ${CARGO_ARGS.join(' ')}`).toBe('');
    return made.bin;
  };
}

/** Fresh folders for a test (evidence stores), all deleted after it. */
export function useFolders(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-2014-')); made.push(d); return d; };
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: one scenario line in, one answer line out, exit 0 (#393).

/** One `deep-show run` process on this machine: its replies, one per call. */
export function run(bin: string, scenario: JsonObject): JsonObject[] {
  const r = spawnSync(bin, ['run'], { cwd: REPO, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`${SHOW} run: ${r.error.message}`);
  expect(timedOut, `${SHOW} run finished within its timeout`).toBe(false);
  expect(r.status, `${SHOW} run exits 0 (${r.signal ?? 'no signal'}); stdout: ${(r.stdout ?? '').slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(lines.length, `${SHOW} run: one output line per input line`).toBe(1);
  const out = obj(JSON.parse(lines[0]!) as JsonValue, `${SHOW} run: the answer`);
  const calls = arr(scenario['calls'], 'the calls').map((c) => (isObject(c) ? String(c['call']) : '?'));
  const planted = typeof scenario['planted'] === 'string' ? `, its planted program ${scenario['planted']}` : '';
  expect(out['ok'], `${SHOW} run refused the scenario (its calls ${calls.join(', ')}${planted}): ${brief(out, 3000)}`).toBe(true);
  const replies = arr(out['replies'], `${SHOW} run: replies`).map((v, i) => obj(v, `${SHOW} run: replies[${i}]`));
  expect(replies.length, `${SHOW} run: one reply per call`).toBe(calls.length);
  return replies;
}

/** The working agent, alpha. */
export const SESSION = 'sess-alpha';
const ulid = (prefix: string, n: number): string => `${prefix}${String(n).padStart(26 - prefix.length, '0')}`;
export const docId = (n: number): string => ulid('01JB2014D', n);

/** The scenario: the documents on the panel (each shown by a call), the calls, and a planted program. */
export function scenarioOf(evidence: string, docs: readonly string[], calls: JsonObject[], planted?: string): JsonObject {
  return {
    evidence,
    sessions: { [SESSION]: { thread: 'thread-alpha', name: 'Claude Code: terrain', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 4100, ppid: 3000, start: 1_000 }],
    panels: { main: { rect: [0, 0, 1280, 720] } },
    docs: Object.fromEntries(docs.map((d) => [d, { panel: 'main' }])),
    ...(planted ? { planted } : {}), calls,
  };
}

/** The working agent's deep_show of a whole revision (#393's agent form: no `id`, no `layers`). */
export const show = (doc: string, document: JsonObject): JsonObject => ({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
/** #420's `geometry` call on the named items: each one's built mesh. */
export const geometry = (doc: string, items: readonly string[]): JsonObject => ({ call: 'geometry', doc, items: [...items] });
/** #411's `deep_query` of evaluated values at 0 s. */
export const query = (doc: string, paths: readonly string[]): JsonObject => ({ call: 'deep_query', session: SESSION, doc, paths: [...paths], at: ['0s'] });

export type V3 = [number, number, number];
export interface Ray { from: V3; dir: V3 }
/** A ray straight down through (x, z), from height `top`. */
export const down = (x: number, z: number, top: number): Ray => ({ from: [x, top, z], dir: [0, -1, 0] });
/** This suite's `terrain_rays` call (README: The surface under test): each ray met by the plate's drawn triangles, its physics height-field shape and a pick on it. */
export const terrainRays = (doc: string, item: string, rays: readonly Ray[]): JsonObject =>
  ({ call: 'terrain_rays', doc, item, rays: rays.map((r) => ({ from: [...r.from], dir: [...r.dir] })) });

/** Why a show isn't presented: an item skipped as a kind the build doesn't know, an error the check raised, or another outcome. */
export function presentedFailures(reply: JsonObject): string[] {
  const notices = Array.isArray(reply['notices']) ? reply['notices'].filter(isObject) : [];
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  return [
    ...[...notices, ...issues].filter((n) => n['code'] === 'unknown_kind').map((n) => `an item is skipped as a kind the build doesn't know: ${brief(n, 600)}`),
    ...issues.filter((i) => i['severity'] === 'error').map((i) => `the check raises an error: ${brief(i, 600)}`),
    ...(reply['outcome'] === 'presented' ? [] : [`the show's outcome is ${brief(reply['outcome'])}, not presented: ${brief(reply, 1500)}`]),
  ];
}
/** The show was presented: no error issue, and no item skipped as a kind the build doesn't know. */
export const presented = (reply: JsonObject, what: string): void => none(presentedFailures(reply), `${what} is presented`);

// ---------------------------------------------------------------------------------------------------
// Scenes. Metres, +Y up, right +X. A terrain plate is `plate@1` with `params.terrain`; it has no `at`, so its own space
// is the world's. Its samples lie `spacing` apart over `size`, centred on its origin: x = −size[0] ÷ 2 + i × spacing
// for i from 0 to size[0] ÷ spacing, z likewise, and the height at each is the field `height` read at (x, 0, z).
// Cell [c, r] is the square from sample (c, r) to sample (c + 1, r + 1): c counts along +x from the −x edge, r along
// +z from the −z edge, both from 0.

export interface Terrain { height: string; size: [number, number]; spacing: number; tile: number; lod_levels: number }
export type Cell = [number, number];

/** The plate's ID in every fixture, and the resting item's. */
export const PLATE = 'ground';
export const STONE = 'stone';
export const STONE_POS = `items/${STONE}/at/pos`;

const plateItem = (t: Terrain): JsonObject => ({ kind: 'plate@1', params: { terrain: { ...t, size: [...t.size] } } });
/** A ball of radius `r` centred at `at`: `mark.sphere@1` is a unit solid scaled by `params.size`, its own true shape. */
const ballItem = (r: number, at: V3): JsonObject => ({ kind: 'mark.sphere@1', params: { size: [2 * r, 2 * r, 2 * r] }, at: { pos: [...at] } });

/** A scene in the agent's form, each item given its ID, name and order key. */
export function scene(title: string, items: Record<string, JsonObject>, extra: JsonObject = {}, modules: readonly string[] = ['scene3d']): JsonObject {
  const entries = Object.entries(items).map(([id, item], k) => [id, { id, name: id, order: `a${String(k).padStart(4, '0')}`, ...item }] as const);
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #2014 acceptance fixture.`, size: [640, 480],
    requires: { modules: Object.fromEntries(modules.map((m) => [m, '^1'])) }, ...extra, items: Object.fromEntries(entries),
  };
}
/** The plate alone. */
export const plateDoc = (t: Terrain, title: string): JsonObject => scene(title, { [PLATE]: plateItem(t) });
/** The plate and the stone over it, which `rest: {owner: stone, kind: rest_on, on: ground}` rests on it with every default (axis (0, −1, 0), contact true_shape, offset 0, max_drop 10). */
export const restDoc = (t: Terrain, stone: { r: number; at: V3 }, title: string): JsonObject =>
  scene(title, { [PLATE]: plateItem(t), [STONE]: ballItem(stone.r, stone.at) }, { constraints: { rest: { owner: STONE, kind: 'rest_on', on: PLATE } } }, ['scene3d', 'motion']);

/** The samples of a plate: x and z of each, by [i, j]. */
export function samplesOf(t: Terrain): { at: Cell; x: number; z: number }[] {
  const [nx, nz] = [Math.round(t.size[0] / t.spacing), Math.round(t.size[1] / t.spacing)];
  const out: { at: Cell; x: number; z: number }[] = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) out.push({ at: [i, j], x: -t.size[0] / 2 + i * t.spacing, z: -t.size[1] / 2 + j * t.spacing });
  return out;
}
/** A cell's square and centre. */
export function cellOf(t: Terrain, cell: Cell): { x0: number; z0: number; x1: number; z1: number; centre: [number, number] } {
  const x0 = -t.size[0] / 2 + cell[0] * t.spacing, z0 = -t.size[1] / 2 + cell[1] * t.spacing;
  return { x0, z0, x1: x0 + t.spacing, z1: z0 + t.spacing, centre: [x0 + t.spacing / 2, z0 + t.spacing / 2] };
}
/** How a failure names a cell. */
export function cellName(t: Terrain, cell: Cell): string {
  const c = cellOf(t, cell);
  return `cell [${cell[0]}, ${cell[1]}] (x ${c.x0} to ${c.x1} m, z ${c.z0} to ${c.z1} m)`;
}

// ---- Criterion 1: a 2 × 2 m plate at 1 m spacing whose one raised sample makes one cell's corners 0, 0, 0 and 1 m

/**
 * Nine samples at x, z ∈ {−1, 0, 1}; the field is 1 where x > 0.5 and z < −0.5 and 0 elsewhere, so only the sample at
 * (1, −1), the plate's +x −z corner, is 1 m. Cell [1, 0] (x 0 to 1, z −1 to 0) holds it: its corner heights are 0, 0, 0
 * and 1 m. The other three cells are flat at 0.
 */
export const CELL_PLATE: Terrain = { height: 'max(sign(position.x - 0.5), 0) * max(sign(-position.z - 0.5), 0)', size: [2, 2], spacing: 1, tile: 2, lod_levels: 1 };
export const TARGET: Cell = [1, 0];
export const CELLS: readonly Cell[] = [[0, 0], [1, 0], [0, 1], [1, 1]];
/** The sample heights the field gives: 1 m at (1, −1), else 0. */
export const cellHeight = (x: number, z: number): number => (Math.abs(x - 1) < 1e-9 && Math.abs(z + 1) < 1e-9 ? 1 : 0);
/** A ball of radius 0.1 m written 1.5 m over the target cell's centre (0.5, −0.5). */
export const CELL_STONE = { r: 0.1, at: [0.5, 1.5, -0.5] as V3 };
/** Every ray starts here, above the plate's highest point (1 m). */
export const CELL_TOP = 2;
export const cellDoc = (): JsonObject => restDoc(CELL_PLATE, CELL_STONE, 'A plate cell with one raised corner');
/** Criterion 1's planted program: the plate's builder splits every cell along its other diagonal (README: The planted programs). */
export const SPLITS_OTHER_DIAGONAL = 'terrain_splits_other_diagonal';

// ---- Criterion 2: a 24 × 24 km plate at 30 m spacing, and one 4,097 spacings a side

/**
 * Terraces 2,048 m wide: 10 m a step along x and 5 m along z (x × 2⁻¹¹ is exact for a whole number of metres, so no
 * sample sits on a rounding edge). The heights run from −90 m to 75 m; the plate's highest sample is 75 m.
 */
export const LAND: Terrain = { height: '10 * floor(position.x * 0.00048828125) + 5 * floor(position.z * 0.00048828125)', size: [24000, 24000], spacing: 30, tile: 2400, lod_levels: 1 };
export const landHeight = (x: number, z: number): number => 10 * Math.floor(x / 2048) + 5 * Math.floor(z / 2048);
/** 24,000 ÷ 30 + 1 samples a side. */
export const LAND_SAMPLES = 801;
/** The sampled cell, [650, 250]: x 7,500 to 7,530 m, z −4,500 to −4,470 m, inside the terrace at 15 m with its neighbours. */
export const SAMPLED: Cell = [650, 250];
export const SAMPLED_HEIGHT = 15;
/** A ball of radius 0.5 m written 5 m over the sampled cell's centre (7,515, −4,485), so it drops 4.5 m, within max_drop. */
export const LAND_STONE = { r: 0.5, at: [7515, 20, -4485] as V3 };
/** The ray down through the sampled cell's centre starts above the plate's highest sample. */
export const LAND_TOP = 100;
export const landDoc = (): JsonObject => restDoc(LAND, LAND_STONE, 'A 24 km plate at 30 m');
/** 4,097 spacings of 30 m a side: one past the cap. */
export const OVER: Terrain = { ...LAND, size: [4097 * 30, 4097 * 30] };
/**
 * The bound on the physics hit at the sampled cell: the criterion gives the physics shape no bound at this size, and a
 * backend in f32 resolves heights near 75 m to about 4e-6 m and places near 12 km to about 1e-3 m.
 */
export const PHYSICS_FAR_TOL = 1e-3;
/** Criterion 2's planted program: the size cap reads the size in metres, size ≤ 4,096 m a side (README: The planted programs). */
export const CAP_IN_METRES = 'terrain_cap_in_metres';

// ---------------------------------------------------------------------------------------------------
// Readings

/** Where one ray meets the plate: its drawn triangles, its physics height-field shape, and a pick on it. */
export interface Hits { drawn: V3 | null; physics: V3 | null; pick: V3 | null }
export interface RaysReply { shape: { kind: string; samples: [number, number] } | null; rays: Hits[] }

function pointOrNull(v: JsonValue | undefined, what: string): V3 | null {
  if (v === null) return null;
  const a = arr(v, what);
  expect(a.length, `${what} holds three numbers`).toBe(3);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`), num(a[2], `${what}[2]`)];
}
/** A `terrain_rays` reply: the plate's physics shape, and each ray's three points, in order. */
export function raysOf(reply: JsonObject, count: number, what: string): RaysReply {
  expect(reply['code'], `${what}: terrain_rays answers: ${brief(reply)}`).toBeUndefined();
  const s = reply['shape'];
  let shape: RaysReply['shape'] = null;
  if (s !== null) {
    const o = obj(s, `${what}: shape`);
    const n = arr(o['samples'], `${what}: shape.samples`);
    expect(n.length, `${what}: shape.samples holds two counts`).toBe(2);
    shape = { kind: String(o['kind']), samples: [num(n[0], 'samples[0]'), num(n[1], 'samples[1]')] };
  }
  const rays = arr(reply['rays'], `${what}: rays`).map((v, k): Hits => {
    const o = obj(v, `${what}: rays[${k}]`);
    for (const key of ['drawn', 'physics', 'pick']) expect(key in o, `${what}: rays[${k}] has ${key} (a point, or null)`).toBe(true);
    return { drawn: pointOrNull(o['drawn'], `${what}: rays[${k}].drawn`), physics: pointOrNull(o['physics'], `${what}: rays[${k}].physics`), pick: pointOrNull(o['pick'], `${what}: rays[${k}].pick`) };
  });
  expect(rays.length, `${what}: one answer per ray`).toBe(count);
  return { shape, rays };
}

export type Tri = [V3, V3, V3];
/** The plate's drawn triangles from a `geometry` reply: its row's positions and indices, in world m. */
export function drawnOf(reply: JsonObject, id: string, what: string): { positions: V3[]; tris: Tri[] } {
  expect(reply['code'], `${what}: the geometry call answers for ${id}: ${brief(reply)}`).toBeUndefined();
  const row = arr(reply['items'], `${what}: the geometry reply's items`).filter(isObject).find((r) => r['id'] === id);
  expect(row, `${what}: the geometry reply has a row for ${id}: ${brief(reply)}`).toBeDefined();
  // A row's `world` (rows of a 3 × 4 matrix) places its positions; the plate has no `at`, so it is the identity.
  const w = Array.isArray(row!['world']) ? row!['world'].map((r, i) => arr(r, `${what}: world[${i}]`).map((x, k) => num(x, `${what}: world[${i}][${k}]`))) : null;
  const place = (p: V3): V3 => (w ? [0, 1, 2].map((i) => w[i]![0]! * p[0] + w[i]![1]! * p[1] + w[i]![2]! * p[2] + w[i]![3]!) as V3 : p);
  const positions = arr(row!['positions'], `${what}: ${id}.positions`).map((v, k) => {
    const p = arr(v, `${what}: ${id}.positions[${k}]`);
    return place([num(p[0], 'x'), num(p[1], 'y'), num(p[2], 'z')]);
  });
  const indices = arr(row!['indices'], `${what}: ${id}.indices`).map((v) => num(v, `${what}: an index`));
  expect(indices.length % 3 === 0 && indices.every((k) => Number.isInteger(k) && k >= 0 && k < positions.length), `${what}: ${id}'s indices are whole triangles of its positions`).toBe(true);
  const tris: Tri[] = [];
  for (let k = 0; k < indices.length; k += 3) tris.push([positions[indices[k]!]!, positions[indices[k + 1]!]!, positions[indices[k + 2]!]!]);
  return { positions, tris };
}
/** An item's evaluated place from a deep_query reply. */
export function positionAt(reply: JsonObject, path: string): V3 {
  const at = arr(arr(obj(reply['values'], 'the query\'s values')[path], `values[${path}]`)[0], `${path} at 0 s`);
  expect(at.length, `${path} holds three numbers`).toBe(3);
  return [num(at[0], `${path}[0]`), num(at[1], `${path}[1]`), num(at[2], `${path}[2]`)];
}

// ---------------------------------------------------------------------------------------------------
// The judges. Each is run on planted sets it must fail, in every file that uses it.

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3): number => Math.sqrt(dot(a, a));

/** The heights where the vertical line through (x, z) meets `tris` (each triangle whose plan holds the point, edges included), topmost first. */
export function heightsAt(tris: readonly Tri[], x: number, z: number): number[] {
  const out: number[] = [];
  for (const [a, b, c] of tris) {
    const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
    if (Math.abs(d) < 1e-12) continue;
    const la = ((b[0] - x) * (c[2] - z) - (c[0] - x) * (b[2] - z)) / d;
    const lb = ((c[0] - x) * (a[2] - z) - (a[0] - x) * (c[2] - z)) / d;
    const lc = 1 - la - lb;
    if (la < -1e-9 || lb < -1e-9 || lc < -1e-9) continue;
    out.push(la * a[1] + lb * b[1] + lc * c[1]);
  }
  return out.sort((p, q) => q - p);
}
/** The topmost height of `tris` over (x, z), which a ray from above meets first; null when none lies over it. */
export const topAt = (tris: readonly Tri[], x: number, z: number): number | null => heightsAt(tris, x, z)[0] ?? null;

/** The point of triangle (a, b, c) nearest `p` (by Voronoi regions of its corners and edges). */
function nearestOn(p: V3, a: V3, b: V3, c: V3): V3 {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return add(a, scale(ab, d1 / (d1 - d3)));
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return add(a, scale(ac, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return add(b, scale(sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  const k = 1 / (va + vb + vc);
  return add(add(a, scale(ab, vb * k)), scale(ac, vc * k));
}
/** A ball's gap to `tris`, m: its centre's distance to the nearest triangle less its radius; over 0 apart, under 0 passing in. */
export const ballGap = (tris: readonly Tri[], c: V3, r: number): number => Math.min(...tris.map(([a, b, d]) => len(sub(c, nearestOn(c, a, b, d))))) - r;

/** Why a ball of radius `r` resting at `c`, written at `written`, doesn't rest on the drawn triangles within 1e-6 m. */
export function restFailures(c: V3, written: V3, r: number, tris: readonly Tri[], what: string): string[] {
  const out: string[] = [];
  if (Math.abs(c[0] - written[0]) > TOL || Math.abs(c[2] - written[2]) > TOL) out.push(`${what} left its axis (0, −1, 0): it is at x ${c[0]}, z ${c[2]}, written at x ${written[0]}, z ${written[2]}`);
  const under = topAt(tris, c[0], c[2]);
  if (under === null) return [...out, `${what} at (${c.join(', ')}) has no drawn surface under it`];
  if (c[1] < under) return [...out, `${what}'s centre at y ${c[1]} is under the drawn surface, at y ${under} there`];
  const gap = ballGap(tris, c, r);
  if (gap > TOL) out.push(`${what} at y ${c[1]} is ${gap} m from the drawn surface: a gap past ${TOL} m`);
  if (gap < -TOL) out.push(`${what} at y ${c[1]} passes ${-gap} m into the drawn surface: past ${TOL} m`);
  return out;
}

/** What is read at one cell's centre: the drawn triangles' height there, and the `terrain_rays` answer for the ray down through it. */
export interface CellReading { cell: Cell; triangles: number | null; hits: Hits }
/** Why the readings at each cell's centre don't agree within 1e-6 m: one that meets nothing or leaves the ray, or heights that spread past it. Each failure names its cell. */
export function spreadFailures(t: Terrain, readings: readonly CellReading[]): string[] {
  const out: string[] = [];
  for (const { cell, triangles, hits } of readings) {
    const name = cellName(t, cell);
    const [x, z] = cellOf(t, cell).centre;
    const points = [['the drawn surface by ray', hits.drawn], ['the physics height-field shape', hits.physics], ['the pick\'s ground point', hits.pick]] as const;
    const missing = [...(triangles === null ? ['the drawn triangles'] : []), ...points.filter(([, p]) => p === null).map(([label]) => label)];
    const off = points.filter(([, p]) => p !== null && (Math.abs(p[0] - x) > TOL || Math.abs(p[2] - z) > TOL));
    if (missing.length) out.push(`${name}: at its centre nothing is met on ${missing.join(' or ')}`);
    for (const [label, p] of off) out.push(`${name}: ${label} at its centre is (${p!.join(', ')}), off the ray down through (${x}, ${z})`);
    if (missing.length || off.length) continue;
    const heights: [string, number][] = [['the drawn triangles', triangles!], ...points.map(([label, p]): [string, number] => [label, p![1]])];
    const ys = heights.map(([, y]) => y);
    const spread = Math.max(...ys) - Math.min(...ys);
    if (spread > TOL) out.push(`${name}: at its centre ${heights.map(([label, y]) => `${label} is at y ${y}`).join(', ')}: ${spread} m apart, past ${TOL} m`);
  }
  return out;
}

/** Why the drawn mesh's samples aren't the field's: a sample with no vertex over it, or whose topmost vertex is at another height (a vertex under it, such as a tile's skirt, is allowed). */
export function sampleFailures(t: Terrain, h: (x: number, z: number) => number, positions: readonly V3[]): string[] {
  const out: string[] = [];
  for (const s of samplesOf(t)) {
    const ys = positions.filter((p) => Math.abs(p[0] - s.x) <= TOL && Math.abs(p[2] - s.z) <= TOL).map((p) => p[1]);
    if (!ys.length) out.push(`no drawn vertex lies at sample [${s.at.join(', ')}] (x ${s.x}, z ${s.z})`);
    else if (Math.abs(Math.max(...ys) - h(s.x, s.z)) > TOL) out.push(`the drawn surface at sample [${s.at.join(', ')}] (x ${s.x}, z ${s.z}) is at y ${Math.max(...ys)}, not the field's ${h(s.x, s.z)}`);
  }
  return out;
}

/** A plate's cells as two triangles each from the field `h`, split along `diagonal`: `main` from (x0, z0) to (x1, z1), `anti` from (x0, z1) to (x1, z0). A planted set for the judges. */
export function gridTris(t: Terrain, h: (x: number, z: number) => number, diagonal: 'main' | 'anti'): Tri[] {
  const out: Tri[] = [];
  const [nx, nz] = [Math.round(t.size[0] / t.spacing), Math.round(t.size[1] / t.spacing)];
  for (let r = 0; r < nz; r++) for (let c = 0; c < nx; c++) {
    const { x0, z0, x1, z1 } = cellOf(t, [c, r]);
    const p = (x: number, z: number): V3 => [x, h(x, z), z];
    const [a, b, d, e] = [p(x0, z0), p(x1, z0), p(x0, z1), p(x1, z1)];
    if (diagonal === 'main') out.push([a, b, e], [a, e, d]);
    else out.push([a, b, d], [b, e, d]);
  }
  return out;
}
/** The readings a program whose drawn triangles are `drawn` and whose physics and pick meet `collision` gives at each cell's centre. */
function readingsOf(t: Terrain, cells: readonly Cell[], drawn: readonly Tri[], collision: readonly Tri[]): CellReading[] {
  return cells.map((cell) => {
    const [x, z] = cellOf(t, cell).centre;
    const at = (tris: readonly Tri[]): V3 | null => { const y = topAt(tris, x, z); return y === null ? null : [x, y, z]; };
    return { cell, triangles: topAt(drawn, x, z), hits: { drawn: at(drawn), physics: at(collision), pick: at(collision) } };
  });
}

/**
 * Criterion 1's judges fail their planted sets, so a judge that passes everything can't pass a file:
 * - the cell's drawn centre is 0.5 m split along the diagonal through its raised corner (`anti`), 0 along the other;
 * - the samples: the field's mesh passes, its mirror (the raised sample at (−1, 1)) fails at two samples;
 * - the spread: one surface passes; drawn along one diagonal and met along the other fails, naming cell [1, 0] alone;
 * - the rest: a ball of 0.1 m touches the ridge (`anti`) with its centre at 0.5 + 0.1 √1.5 m and the valley (`main`)
 *   at 0.1 √3 m; 2e-6 m higher is a gap, 2e-6 m lower passes in, the valley's place on the ridge is under it, the
 *   ball's lowest point on the valley's centre passes 0.042 m into its slope, and a ball moved 1e-5 m left its axis.
 */
export function cellJudgesFailTheirPlants(): void {
  const anti = gridTris(CELL_PLATE, cellHeight, 'anti'), main = gridTris(CELL_PLATE, cellHeight, 'main');
  const [cx, cz] = cellOf(CELL_PLATE, TARGET).centre;
  expect(topAt(anti, cx, cz), 'split through its raised corner, the cell\'s centre is at 0.5 m').toBeCloseTo(0.5, 12);
  expect(topAt(main, cx, cz), 'split along its other diagonal, the cell\'s centre is at 0 m').toBeCloseTo(0, 12);
  expect(sampleFailures(CELL_PLATE, cellHeight, anti.flat()), 'the sample judge passes the field\'s mesh').toEqual([]);
  expect(sampleFailures(CELL_PLATE, cellHeight, gridTris(CELL_PLATE, (x, z) => cellHeight(z, x), 'anti').flat()).length, 'the sample judge fails the mirrored mesh at two samples').toBe(2);
  expect(spreadFailures(CELL_PLATE, readingsOf(CELL_PLATE, CELLS, anti, anti)), 'the spread judge passes one surface').toEqual([]);
  const planted = spreadFailures(CELL_PLATE, readingsOf(CELL_PLATE, CELLS, main, anti));
  expect(planted.length, 'the spread judge fails drawing along one diagonal and meeting along the other, at one cell').toBe(1);
  expect(planted[0], 'it names the cell').toContain(cellName(CELL_PLATE, TARGET));
  const { r, at } = CELL_STONE;
  const ridge: V3 = [cx, 0.5 + r * Math.sqrt(1.5), cz], valley: V3 = [cx, r * Math.sqrt(3), cz];
  expect(restFailures(ridge, at, r, anti, 'a ball on the ridge'), 'the rest judge passes a ball touching the ridge').toEqual([]);
  expect(restFailures(valley, at, r, main, 'a ball in the valley'), 'the rest judge passes a ball touching the valley').toEqual([]);
  expect(restFailures([cx, ridge[1] + 2e-6, cz], at, r, anti, 'a ball').join(), 'the rest judge fails a ball 2e-6 m high').toContain('a gap');
  expect(restFailures([cx, ridge[1] - 2e-6, cz], at, r, anti, 'a ball').join(), 'the rest judge fails a ball 2e-6 m low').toContain('passes');
  expect(restFailures(valley, at, r, anti, 'a ball').join(), 'the rest judge fails the valley\'s place on the ridge').toContain('under the drawn surface');
  expect(ballGap(main, [cx, r, cz], r), 'a ball whose lowest point is on the valley\'s centre passes 0.042 m into its slope').toBeCloseTo(r / Math.sqrt(3) - r, 9);
  expect(restFailures([cx, r, cz], at, r, main, 'a ball').join(), 'the rest judge fails it').toContain('passes');
  expect(restFailures([cx + 1e-5, ridge[1], cz], at, r, anti, 'a ball').join(), 'the rest judge fails a ball moved sideways').toContain('left its axis');
}

// ---- Criterion 2's judges

/** Why the plate's physics shape isn't one height field of `n` × `n` samples. */
export function shapeFailures(rays: RaysReply, n: number): string[] {
  if (rays.shape === null) return ['the plate has no physics height-field shape (terrain_rays answers shape: null)'];
  const out: string[] = [];
  if (rays.shape.kind !== 'heightfield') out.push(`the plate's physics shape is a ${rays.shape.kind}, not a heightfield`);
  if (rays.shape.samples[0] !== n || rays.shape.samples[1] !== n) out.push(`the plate's physics height field holds ${rays.shape.samples.join(' × ')} samples, not ${n} × ${n}`);
  return out;
}
/** Why the ray down through the sampled cell's centre doesn't meet the drawn surface at 15 m there, and the physics shape with it. */
export function sampledFailures(hits: Hits): string[] {
  const [x, z] = cellOf(LAND, SAMPLED).centre;
  const name = cellName(LAND, SAMPLED);
  const out: string[] = [];
  const d = hits.drawn;
  if (d === null) out.push(`${name}: the ray down through its centre meets no drawn triangle`);
  else if (Math.abs(d[0] - x) > TOL || Math.abs(d[2] - z) > TOL || Math.abs(d[1] - SAMPLED_HEIGHT) > TOL) out.push(`${name}: the drawn surface at its centre is (${d.join(', ')}), not (${x}, ${SAMPLED_HEIGHT}, ${z}), the field's flat terrace`);
  const p = hits.physics;
  if (p === null) out.push(`${name}: the ray down through its centre meets no physics height-field shape`);
  else if (d !== null && len(sub(p, d)) > PHYSICS_FAR_TOL) out.push(`${name}: the physics shape is met at (${p.join(', ')}), ${len(sub(p, d))} m from the drawn surface's (${d.join(', ')}), past ${PHYSICS_FAR_TOL} m`);
  return out;
}
/** Why the stone, resting at `c`, doesn't stand within 1e-6 m of the drawn surface where the ray down through the sampled cell's centre met it. */
export function standFailures(c: V3, drawn: V3 | null): string[] {
  const { r, at } = LAND_STONE;
  const out: string[] = [];
  if (Math.abs(c[0] - at[0]) > TOL || Math.abs(c[2] - at[2]) > TOL) out.push(`the stone left its axis (0, −1, 0): it is at x ${c[0]}, z ${c[2]}, written at x ${at[0]}, z ${at[2]}`);
  if (drawn === null) return [...out, 'there is no drawn surface under the stone to stand on'];
  const gap = c[1] - r - drawn[1];
  if (Math.abs(gap) > TOL) out.push(`the stone's lowest point is at y ${c[1] - r}, ${gap} m from the drawn surface at y ${drawn[1]} under it, past ${TOL} m`);
  return out;
}
/** Why a show isn't refused at check with an out_of_range error naming the plate, its size and its spacing, as `t` writes them. */
export function capFailures(reply: JsonObject, t: Terrain): string[] {
  if (reply['outcome'] !== 'refused') return [`the show's outcome is ${brief(reply['outcome'])}, not refused: ${brief(reply, 1500)}`];
  const issues = Array.isArray(reply['issues']) ? reply['issues'].filter(isObject) : [];
  const path = `items/${PLATE}/params/terrain`;
  const named = issues.find((i) => {
    const actual = i['actual'];
    return i['code'] === 'out_of_range' && i['severity'] === 'error' && Array.isArray(i['ids']) && i['ids'].includes(PLATE)
      && typeof i['path'] === 'string' && (i['path'] === path || i['path'].startsWith(`${path}/`))
      && isObject(actual) && JSON.stringify(actual['size']) === JSON.stringify(t.size) && actual['spacing'] === t.spacing;
  });
  return named ? [] : [`no out_of_range error names ${PLATE} at ${path} with its size ${JSON.stringify(t.size)} and spacing ${t.spacing} in its actual; the issues: ${brief(issues, 2500)}`];
}

/**
 * Criterion 2's judges fail their planted sets:
 * - the fixture: 24,000 ÷ 30 + 1 = 801 samples a side, 4,097 spacings a side for the refused plate; the sampled cell
 *   and its eight neighbours flat at 15 m; the plate's highest sample 75 m;
 * - the stand: the stone's centre at 15.5 m passes; 2e-6 m higher, as written (20 m), on the ground plane (0.5 m), on
 *   the plate's bounds (75.5 m) and moved 1e-5 m sideways fail;
 * - the refusal: an out_of_range error naming the plate's terrain with its size and spacing passes; the base's
 *   unknown_field at the same path with the same actual, a presented show, an actual without the spacing, and an
 *   error naming another item fail.
 */
export function landJudgesFailTheirPlants(): void {
  expect(LAND.size[0] / LAND.spacing + 1, 'the 24 km plate has 801 samples a side').toBe(LAND_SAMPLES);
  expect(OVER.size[0] / OVER.spacing, 'the refused plate is 4,097 spacings a side').toBe(4097);
  const c = cellOf(LAND, SAMPLED);
  const around = [-30, 0, 30, 60].flatMap((dx) => [-30, 0, 30, 60].map((dz) => landHeight(c.x0 + dx, c.z0 + dz)));
  expect(around, 'the sampled cell and its neighbours are flat at 15 m').toEqual(around.map(() => SAMPLED_HEIGHT));
  expect(landHeight(LAND.size[0] / 2, LAND.size[1] / 2), 'the plate\'s highest sample, at its +x +z corner (the terraces rise along both), is 75 m').toBe(75);
  const [x, z] = c.centre;
  const drawn: V3 = [x, SAMPLED_HEIGHT, z];
  const y = SAMPLED_HEIGHT + LAND_STONE.r;
  expect(standFailures([x, y, z], drawn), 'the stand judge passes the stone on the terrace').toEqual([]);
  for (const [at, why] of [[[x, y + 2e-6, z], '2e-6 m high'], [LAND_STONE.at, 'left as written'], [[x, LAND_STONE.r, z], 'on the ground plane'], [[x, 75 + LAND_STONE.r, z], 'on the plate\'s bounds'], [[x + 1e-5, y, z], 'moved sideways']] as [V3, string][])
    expect(standFailures(at, drawn).length, `the stand judge fails the stone ${why}`).toBeGreaterThan(0);
  const issue = (code: string, actual: JsonObject, ids = [PLATE]): JsonObject => ({ outcome: 'refused', issues: [{ code, severity: 'error', ids, path: `items/${ids[0]}/params/terrain`, actual }] });
  const written: JsonObject = { ...OVER, size: [...OVER.size] };
  expect(capFailures(issue('out_of_range', written), OVER), 'the refusal judge passes the cap\'s refusal').toEqual([]);
  expect(capFailures(issue('unknown_field', written), OVER).length, 'the refusal judge fails the base\'s unknown_field at the same path').toBe(1);
  expect(capFailures({ outcome: 'presented', issues: [] }, OVER).length, 'the refusal judge fails a presented show').toBe(1);
  expect(capFailures(issue('out_of_range', { size: [...OVER.size] }), OVER).length, 'the refusal judge fails an actual without the spacing').toBe(1);
  expect(capFailures(issue('out_of_range', written, ['other']), OVER).length, 'the refusal judge fails an error naming another item').toBe(1);
}
