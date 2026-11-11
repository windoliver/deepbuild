// Test-side tools for the #1921 acceptance tests (README: The surface under test). They extend #1918's surface: the same
// `deep-physics` binary (#2009's build, through ../1918/helpers.ts and ../2010/helpers.ts, imported read only) asked for
// a scene's world (`scene` with `world: "<world ID>"`); `deep-show run` (#393's convention, built through
// ../1918/helpers.ts) for what a scene's items show at each frame; `deep-gpu run` (#377's convention, #378's `view3d`,
// #484's counters) for what a frame draws and uploads; and `node scripts/physics-budget.mjs` (#2011) for a world's step
// time on the reference Mac. Nothing here stands in for the physics module, the column view or the renderer: every
// issue, state, hash, column, draw and timing read here is the program's own; every expected value comes from the issue's
// text, the design and the fixtures' own numbers, written here before any program runs.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import {
  CARGO_ENV, REPO, TARGET, TIMEOUT, arr, cargoError, isObject, num, obj, physics, show, world, type JsonObject, type JsonValue,
} from '../1918/helpers.ts';
import { BUDGET_SCRIPT, BUDGET_TIMEOUT } from '../2011/helpers.ts';
import { LOOK } from '../484/helpers.ts';

export * from '../1918/helpers.ts';
export { BUDGET_TIMEOUT, LOOK };

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const CRITERIA = {
  1: '#1921.a5fff896',
  2: '#1921.e4dd3dda',
  3: '#1921.877e2ad5',
  4: '#1921.e35aba59',
  5: '#1921.ff1e7756',
  6: '#1921.bcd2acd3',
} as const;

const MIB = 1024 * 1024;

/** A test that can't be judged on this machine fails with this, never passes (invariant 2). */
export function inconclusive(why: string): never {
  throw Error(`INCONCLUSIVE: ${why}; this is not a pass`);
}

// ---------------------------------------------------------------------------------------------------
// Numbers: f32, rotations (Units and conventions: degrees in documents, R = Rz·Ry·Rx), boxes.

export type V3 = [number, number, number];
export type Quat = [number, number, number, number];
type M3 = [V3, V3, V3];

/** The rotation matrix of a unit quaternion [x, y, z, w] (rows). */
export function quatMatrix(q: readonly number[]): M3 {
  const l = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!);
  const [x, y, z, w] = q.map((c) => c / l) as Quat;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}
/** The rotation matrix of Euler degrees about X, then Y, then Z in fixed axes: R = Rz·Ry·Rx. */
export function eulerMatrix(deg: readonly number[]): M3 {
  const [a, b, c] = deg.map((d) => (d * Math.PI) / 180) as V3;
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  return [
    [cc * cb, cc * sb * sa - sc * ca, cc * sb * ca + sc * sa],
    [sc * cb, sc * sb * sa + cc * ca, sc * sb * ca - cc * sa],
    [-sb, cb * sa, cb * ca],
  ];
}
/** An item's `at/rot` as read: Euler degrees [x, y, z] (the design's form), or a quaternion [x, y, z, w]. */
export function rotMatrix(v: JsonValue | undefined, what: string): M3 {
  const a = arr(v, what).map((x, i) => num(x, `${what}[${i}]`));
  expect(a.length === 3 || a.length === 4, `${what} is a rotation, Euler degrees [x, y, z] or a quaternion [x, y, z, w]: ${show(v)}`).toBe(true);
  return a.length === 3 ? eulerMatrix(a) : quatMatrix(a);
}
export const matrixGap = (a: M3, b: M3): number => Math.max(...a.flatMap((row, i) => row.map((x, j) => Math.abs(x - b[i]![j]!))));
const apply = (m: M3, v: readonly number[]): V3 => m.map((row) => row[0] * v[0]! + row[1] * v[1]! + row[2] * v[2]!) as V3;
/** The eight corners of a box of half extents `half` at `pos`, turned by `m`. */
export function corners(pos: readonly number[], m: M3, half: readonly number[]): V3[] {
  const out: V3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const d = apply(m, [sx * half[0]!, sy * half[1]!, sz * half[2]!]);
    out.push([pos[0]! + d[0], pos[1]! + d[1], pos[2]! + d[2]]);
  }
  return out;
}
/** An item's `at/scale` as read: a vec3, or one number for all three. */
export function scale3(v: JsonValue | undefined, what: string): V3 {
  if (typeof v === 'number') return [v, v, v];
  const a = arr(v, what).map((x, i) => num(x, `${what}[${i}]`));
  expect(a.length, `${what} is a scale, a vec3 or one number: ${show(v)}`).toBe(3);
  return a as V3;
}

// ---------------------------------------------------------------------------------------------------
// Worlds (README: The world document). Fields are #2009's and #1918's; `item`, `each` and `<body>#*` outputs are this
// suite's.

export const MATERIALS: JsonObject = {
  ground: { friction: 0.6, restitution: 0 },
  block: { friction: 0.5, restitution: 0, density: 500 },
};
/** The static plane y = 0, normal +Y. */
export const GROUND: JsonObject = { kind: 'static', shapes: [{ shape: 'plane', contact_material: 'ground' }] };
const PLANE: JsonObject = { kind: 'plane', normal: [0, 1, 0] };
/** A world document with this suite's seed and capacity (every body here has one shape use, so shapes = bodies). */
export const world1921 = (bodies: number, parts: JsonObject, shapes = bodies): JsonObject =>
  world({ seed: 1921, capacity: { bodies, shapes, joints: 0, contacts: 8192, particles: 0 }, contact_materials: MATERIALS, ...parts });

// ---------------------------------------------------------------------------------------------------
// Scenes, in the agent's form (#421's payload: no `id`, no `layers`), as deep-show and deep-physics take them; `forGpu`
// gives the same scene as a session holds it, as deep-gpu's `view3d` reads it (#378).

export const FPS = 60;
export const camera = (position: V3, target: V3): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', position, target, fov: 50, near: 0.5, far: 500 } });
export function sceneOf(title: string, span: string, items: Record<string, JsonObject>, worlds: JsonObject): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(items)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #1921 acceptance fixture.`, size: [640, 360], camera: 'cam',
    transport: { span, frame_rate: [FPS, 1] }, requires: { modules: { scene3d: '^1' } }, worlds, items: withIds,
  };
}
/** The scene as a session holds it: an `id` and one writer layer holding every item (#378, #484). */
export function forGpu(scene: JsonObject, id: string): JsonObject {
  const items: JsonObject = {};
  for (const [k, v] of Object.entries(obj(scene['items'], 'the scene\'s items'))) items[k] = { ...obj(v, k), layer: 'main' };
  return { ...scene, id, layers: { main: { writer: 'agent:sess-1921', title: 'main', order: 'a0' } }, items };
}

// Criterion 1: the crate lab. `crate` is a box drawn by `mark.box@1` (a unit solid centred on its origin, scaled by
// `size`), `box` the body bound to it; `token` an item drawn at scale 0.5 that an output from `die` only drives.

export const CRATE_WORLD = 'lab';
export const CRATE_STEPS = 240;
export const CRATE_FRAMES = 120;
/** The crate's place and its collider's half extents, sized in metres (the fix the refusal names). */
export const CRATE_AT: V3 = [0, 1.5, 0];
export const CRATE_HALF: V3 = [1, 1, 0.5];
export const CRATE_SCALE: V3 = [2, 1, 1];
export const TOKEN_SCALE: V3 = [0.5, 0.5, 0.5];
export const DIE_AT: V3 = [3, 2, 0];
/**
 * `scaled`: the crate drawn 1 × 2 × 1 at scale (2, 1, 1), its collider 1 × 2 × 1 m (half (0.5, 1, 0.5)): refused.
 * `sized`: the crate drawn 2 × 2 × 1 at scale 1, its collider's half extents doubled along x instead (half (1, 1, 0.5)).
 * Either way `token`, a 1 m box drawn at scale 0.5, is driven by `die`, a 0.5 m box with its own pose, spun about +Y at
 * 90°/s and dropped 1.75 m.
 */
export function crateScene(variant: 'scaled' | 'sized'): JsonObject {
  const scaled = variant === 'scaled';
  const lab = world1921(8, {
    shapes: { plane: PLANE, crate: { kind: 'box', half: scaled ? [0.5, 1, 0.5] : CRATE_HALF }, die: { kind: 'box', half: [0.25, 0.25, 0.25] } },
    bodies: {
      ground: GROUND,
      box: { kind: 'dynamic', item: 'crate', shapes: [{ shape: 'crate', contact_material: 'block' }] },
      die: { kind: 'dynamic', shapes: [{ shape: 'die', contact_material: 'block' }], pose: { pos: DIE_AT }, velocity: { angular: [0, 90, 0] } },
    },
    outputs: {
      crate: { from: 'box', read: 'pose', to: 'items/crate/at' },
      token: { from: 'die', read: 'pose', to: 'items/token/at' },
    },
  });
  return sceneOf(scaled ? 'Scaled crate' : 'Sized crate', '2s', {
    cam: camera([0, 3, 12], [1.5, 1, 0]),
    crate: { kind: 'mark.box@1', params: { size: scaled ? [1, 2, 1] : [2, 2, 1] }, at: scaled ? { pos: CRATE_AT, scale: CRATE_SCALE } : { pos: CRATE_AT } },
    token: { kind: 'mark.box@1', params: { size: [1, 1, 1] }, at: { pos: DIE_AT, scale: TOKEN_SCALE } },
  }, { [CRATE_WORLD]: lab });
}

// Criterion 2: the pile. One body `crate` with `each:` the 400-element instancer `crates`, whose element IDs 0 … 399
// sit in its rows out of order: row i holds element (163 × i) mod 400 (163 and 400 are coprime, so each ID once).

export const PILE_WORLD = 'pile';
export const PILE = 400;
export const pileId = (row: number): number => (163 * row) % PILE;
/** Row i's position (exact in f32) and its turn about +Y, (7 × i) mod 360 degrees, as an f32 quaternion. */
export const pilePos = (row: number): V3 => [(row % 20) * 1.5 - 14.25, 2 + Math.floor(row / 20), 0.5 * (row % 3)];
export function pileRot(row: number): Quat {
  const half = ((((7 * row) % 360) * Math.PI) / 180) / 2;
  return [0, Math.fround(Math.sin(half)), 0, Math.fround(Math.cos(half))];
}
export function pileScene(capacity: number): JsonObject {
  const rows = Array.from({ length: PILE }, (_, i) => i);
  const pile = world1921(capacity, {
    shapes: { cube: { kind: 'box', half: [0.25, 0.25, 0.25] } },
    bodies: { crate: { kind: 'dynamic', each: 'crates', shapes: [{ shape: 'cube', contact_material: 'block' }] } },
  }, PILE);
  return sceneOf('Pile', '1s', {
    cam: camera([0, 10, 40], [0, 10, 0]),
    proto: { kind: 'mark.box@1', params: { size: [0.5, 0.5, 0.5] }, visible: false },
    crates: { kind: 'instance@1', params: { of: ['proto'], ids: rows.map(pileId), pos: rows.map(pilePos), rot: rows.map(pileRot) } },
  }, { [PILE_WORLD]: pile });
}

// Criteria 3 to 6: the drop. 400 boxes and 400 balls, each instancer's elements 1000 … 1399 in row order (four digits, so
// ID order and the order of their addresses as text agree), on a 20 × 20 grid 1 m apart, boxes at z < 0 and balls at
// z > 0, element j (ID 1000 + j) dropped from 1 + 3j/64 m (1 m to 19.70 m, every place exact in f32) onto a plane, so
// they land, settle and fall asleep one after another. Rest needs no wall: no two bodies touch.

export const DROP_WORLD = 'drop';
export const DROP_STEPS = 600;
export const DROP_FRAMES = DROP_STEPS / 2;
export const ID0 = 1000;
export const COUNT = 400;
export const INSTANCERS = ['boxes', 'balls'] as const;
export type Instancer = (typeof INSTANCERS)[number];
export const elementIds = Array.from({ length: COUNT }, (_, j) => ID0 + j);
export const address = (inst: Instancer, id: number): string => `${inst}#${id}`;
export function dropPos(inst: Instancer, j: number): V3 {
  const side = inst === 'boxes' ? -1 : 1;
  return [(j % 20) - 9.5, 1 + (3 * j) / 64, side * (1.5 + Math.floor(j / 20))];
}
const IDENTITY: Quat = [0, 0, 0, 1];
const DROP_SHAPES: JsonObject = { plane: PLANE, cube: { kind: 'box', half: [0.25, 0.25, 0.25] }, bead: { kind: 'sphere', radius: 0.25 } };
const shapeOf = (inst: Instancer): JsonObject[] => [{ shape: inst === 'boxes' ? 'cube' : 'bead', contact_material: 'block' }];
export function dropScene(): JsonObject {
  const drop = world1921(COUNT * 2 + 1, {
    shapes: DROP_SHAPES,
    bodies: {
      ground: GROUND,
      boxes: { kind: 'dynamic', each: 'boxes', shapes: shapeOf('boxes') },
      balls: { kind: 'dynamic', each: 'balls', shapes: shapeOf('balls') },
    },
    outputs: {
      boxes: { from: 'boxes#*', read: 'pose', to: 'items/boxes' },
      balls: { from: 'balls#*', read: 'pose', to: 'items/balls' },
    },
  });
  const column = (inst: Instancer): JsonObject => ({
    of: [inst === 'boxes' ? 'cube' : 'bead'], ids: elementIds, pos: elementIds.map((_, j) => dropPos(inst, j)), rot: elementIds.map(() => IDENTITY),
  });
  return sceneOf('Drop', '5s', {
    cam: camera([0, 15, 70], [0, 8, 0]),
    sun: { kind: 'light.sun@1', params: { illuminance: Math.PI, color: [1, 1, 1], shadow: false }, at: { rot: [-50, 30, 0] } },
    box_mat: { kind: 'material@1', params: { base_color: [0.8, 0.45, 0.2, 1], roughness: 0.7 } },
    ball_mat: { kind: 'material@1', params: { base_color: [0.2, 0.45, 0.8, 1], roughness: 0.4 } },
    cube: { kind: 'mark.box@1', params: { size: [0.5, 0.5, 0.5] }, material: 'box_mat', visible: false },
    bead: { kind: 'mark.sphere@1', params: { size: [0.5, 0.5, 0.5] }, material: 'ball_mat', visible: false },
    boxes: { kind: 'instance@1', params: column('boxes') },
    balls: { kind: 'instance@1', params: column('balls') },
  }, { [DROP_WORLD]: drop });
}
/**
 * Criterion 4's twin: the drop's world with the 800 bodies declared one by one, in element-ID order, each under the
 * stable ID its element body has (`balls#1000` …), with the each-body's fields and its element's pose, and no outputs.
 */
export function oneByOneTwin(): JsonObject {
  const bodies: JsonObject = { ground: GROUND };
  for (const inst of INSTANCERS) {
    elementIds.forEach((id, j) => { bodies[address(inst, id)] = { kind: 'dynamic', shapes: shapeOf(inst), pose: { pos: dropPos(inst, j), rot: IDENTITY } }; });
  }
  return world1921(COUNT * 2 + 1, { shapes: DROP_SHAPES, bodies });
}

// ---------------------------------------------------------------------------------------------------
// deep-physics: #1918's calls on a scene's world, and this suite's reply fields.

export const sceneCheck = (scene: JsonObject, w: string): JsonObject => ({ call: 'check', scene, world: w });
export const sceneBake = (scene: JsonObject, w: string, steps: number, extra: JsonObject = {}): JsonObject => ({ call: 'bake', scene, world: w, steps, ...extra });

/** Whether an issue names `id`: in its `ids`, as a segment of its `path`, or as a word in its `what`. */
export function names(issue: JsonObject, id: string): boolean {
  const ids = issue['ids'];
  if (Array.isArray(ids) && ids.includes(id)) return true;
  if (typeof issue['path'] === 'string' && issue['path'].split(/[/.#]/).includes(id)) return true;
  return typeof issue['what'] === 'string' && new RegExp(`\\b${id}\\b`).test(issue['what']);
}

export interface Pose { pos: number[]; rot: number[] }
/**
 * A bake's poses of body `id`, index k the state after k × `every` steps from the built state, read lightly (an
 * 800-body bake holds hundreds of thousands): failures are collected, not thrown one by one.
 */
export function posesOf(reply: JsonObject, id: string, count: number, fails: string[]): Pose[] {
  const bodies = reply['bodies'];
  const series = isObject(bodies) ? bodies[id] : undefined;
  if (!Array.isArray(series) || series.length !== count) {
    fails.push(`the bake's bodies.${id} isn't ${count} states: ${show(series).slice(0, 200)}`);
    return [];
  }
  return series.map((s, k) => {
    const o = isObject(s) ? s : {};
    const pos = o['pos'];
    const rot = o['rot'];
    const ok = Array.isArray(pos) && pos.length === 3 && Array.isArray(rot) && rot.length === 4 && [...pos, ...rot].every((x) => typeof x === 'number');
    if (!ok) fails.push(`bodies.${id}[${k}] has no pos [x, y, z] and rot [x, y, z, w]: ${show(s).slice(0, 200)}`);
    return { pos: ok ? (pos as number[]) : [NaN, NaN, NaN], rot: ok ? (rot as number[]) : [NaN, NaN, NaN, NaN] };
  });
}

/** The drop's world baked in its scene, every `every` steps: each element body's poses, by instancer and row. */
export function dropBake(steps: number, every: number): { reply: JsonObject; poses: Record<Instancer, Pose[][]> } {
  const [reply] = physics([sceneBake(dropScene(), DROP_WORLD, steps, { every })]);
  expect(reply!['ok'], `the drop's world is baked in its scene: ${show(reply).slice(0, 1500)}`).toBe(true);
  const fails: string[] = [];
  const count = steps / every + 1;
  const poses = { boxes: [], balls: [] } as Record<Instancer, Pose[][]>;
  for (const inst of INSTANCERS) poses[inst] = elementIds.map((id) => posesOf(reply!, address(inst, id), count, fails));
  expect(fails.slice(0, 20), 'the bake names each element body by its address, <body>#<element id>, with a pose at each sample').toEqual([]);
  return { reply: reply!, poses };
}

// ---------------------------------------------------------------------------------------------------
// Columns: an instancer's `pos` (vec3) and `rot` (quaternion [x, y, z, w]) as a frame reads them, f32 in row order.

export const COLUMN_WIDTH = { pos: 3, rot: 4 } as const;
export type Column = keyof typeof COLUMN_WIDTH;
/** A column read from a reply as f32 values in row order; failures name what isn't `rows` rows of exact f32s. */
export function columnOf(v: JsonValue | undefined, rows: number, width: number, what: string, fails: string[]): Float32Array {
  const out = new Float32Array(rows * width);
  if (!Array.isArray(v) || v.length !== rows) {
    fails.push(`${what} isn't ${rows} rows: ${show(v).slice(0, 200)}`);
    return out.fill(NaN);
  }
  v.forEach((row, i) => {
    if (!Array.isArray(row) || row.length !== width || row.some((x) => typeof x !== 'number')) {
      fails.push(`${what} row ${i} isn't ${width} numbers: ${show(row)}`);
      return;
    }
    row.forEach((x, k) => {
      const n = x as number;
      if (Math.fround(n) !== n) fails.push(`${what} row ${i}[${k}] = ${n} isn't an f32`);
      out[i * width + k] = n;
    });
  });
  return out;
}
/** The column a bake's poses give at sample `k`, f32 in row order. */
export function bakedColumn(poses: Pose[][], k: number, col: Column): Float32Array {
  const width = COLUMN_WIDTH[col];
  const out = new Float32Array(poses.length * width);
  poses.forEach((series, j) => { const s = series[k]; (s ? s[col] : []).forEach((x, i) => { out[j * width + i] = x; }); });
  return out;
}
/** The first row whose bytes differ, or -1: byte for byte, so -0 and 0 differ. */
export function firstByteDiff(a: Float32Array, b: Float32Array, width: number): number {
  const [x, y] = [new Uint32Array(a.buffer, a.byteOffset, a.length), new Uint32Array(b.buffer, b.byteOffset, b.length)];
  if (x.length !== y.length) return 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return Math.floor(i / width);
  return -1;
}
export const rowText = (c: Float32Array, row: number, width: number): string => `[${Array.from(c.subarray(row * width, row * width + width)).join(', ')}]`;

// ---------------------------------------------------------------------------------------------------
// deep-show: #1918's scenario run, with a planted name (README: Planted twins) in the scenario's `planted` field.

export type ShowPlanted = 'output_writes_whole_transform' | 'output_keeps_previous_columns';
export const withPlanted = (sc: JsonObject, planted?: ShowPlanted): JsonObject => (planted ? { ...sc, planted } : sc);

// ---------------------------------------------------------------------------------------------------
// deep-gpu: `cargo build --locked --bin deep-gpu` once per file, copied out of the target folder, and `deep-gpu run`:
// `{out, calls}` in, `{ok, replies}` out (#377).

const GPU_BIN = 'deep-gpu';
let gpuDir = '';
let gpuBuilt: { bin: string; error: string } | undefined;
function gpuBuild(): { bin: string; error: string } {
  if (!gpuBuilt) {
    if (!gpuDir) gpuDir = mkdtempSync(join(tmpdir(), 'deep-1921-gpu-'));
    const bin = join(gpuDir, GPU_BIN);
    const error = cargoError(['build', '--locked', '--bin', GPU_BIN]);
    if (error === '') copyFileSync(join(TARGET, 'debug', GPU_BIN), bin);
    gpuBuilt = { bin, error };
  }
  return gpuBuilt;
}
/** Builds deep-gpu before a file's tests (the slow part), so each test's own time is its own. */
export function prebuildGpu(): void {
  beforeAll(() => { gpuBuild(); }, TIMEOUT);
  afterAll(() => { if (gpuDir) rmSync(gpuDir, { recursive: true, force: true }); gpuDir = ''; gpuBuilt = undefined; });
}
/** The GPU layer draws on macOS's Metal device; anywhere else a test that draws is INCONCLUSIVE. */
export function requireGpu(): void {
  if (process.platform !== 'darwin') inconclusive(`the GPU layer draws on macOS's Metal device; this is ${process.platform}`);
}
/** A fresh folder per call, deleted after the test. */
export function useDirs(): () => string {
  const made: string[] = [];
  afterEach(() => { for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true }); });
  return () => { const d = mkdtempSync(join(tmpdir(), 'deep-1921-')); made.push(d); return d; };
}

/** One `deep-gpu run` process: exit 0, one answer line, ok, one reply per call. */
export function gpu(out: string, calls: JsonObject[]): JsonObject[] {
  const b = gpuBuild();
  expect(b.error, `deep-gpu builds (cargo build --locked --bin ${GPU_BIN})`).toBe('');
  const r = spawnSync(b.bin, ['run'], { cwd: REPO, input: `${JSON.stringify({ out, calls })}\n`, encoding: 'utf8', maxBuffer: 2048 * MIB, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  if (r.error && !timedOut) throw Error(`deep-gpu run: ${r.error.message}`);
  expect(timedOut, 'deep-gpu run finished within its timeout').toBe(false);
  const stdout = r.stdout ?? '';
  expect(r.status, `deep-gpu run exits 0 (${r.signal ?? 'no signal'}); stdout: ${stdout.slice(0, 1500)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l !== '');
  expect(lines.length, 'deep-gpu run: one answer line').toBe(1);
  const answer = obj(JSON.parse(lines[0]!) as JsonValue, 'deep-gpu run: the answer');
  expect(answer['ok'], `deep-gpu run answers the scenario ok: ${show(answer)}`).toBe(true);
  const replies = arr(answer['replies'], 'deep-gpu run: replies').map((x, i) => obj(x, `deep-gpu run: replies[${i}]`));
  expect(replies.length, 'deep-gpu run: one reply per call').toBe(calls.length);
  return replies;
}
/** The drop scene written as a session's document into `out`, for `view3d`'s `doc`. */
export function dropDoc(out: string): string {
  const p = join(out, 'drop.json');
  writeFileSync(p, JSON.stringify(forGpu(dropScene(), 'drop-1921')));
  return p;
}
export const GPU_SIZE: [number, number] = [320, 180];
/** `view3d` of frames `from` … `from + frames − 1` at 60 fps (frame f at t = f ÷ 60 s, step 2f), with #484's counts. */
export const view3d = (doc: string, frames: number, extra: JsonObject = {}): JsonObject =>
  ({ call: 'view3d', look: LOOK, doc, size: GPU_SIZE, fps: FPS, from: 0, frames, capture: [0], counts: true, ...extra });

export interface Drawn {
  frame: number;
  /** #484's: each indexed indirect draw of an instancer this frame. */
  indirect: { item: string; view: string; batch: string }[] | null;
  /** #378's: the batches encoded this frame, each with the items it draws. */
  encoded: { batch: string; items: string[] }[] | null;
  /** This suite's: per instancer, the element IDs whose rows this frame wrote to the GPU. */
  uploads: Record<string, number[]> | null;
  /** #429's `evaluate`: each path's evaluated value. */
  values: JsonObject | null;
}
/** A `view3d` reply's frames; a refusal fails the test, and one that says the platform can't draw is INCONCLUSIVE. */
export function drawnOf(reply: JsonObject, what: string): Drawn[] {
  if (reply['code'] === 'unsupported_platform') inconclusive(`${what} reports unsupported_platform`);
  expect(reply['code'], `${what} is drawn, not refused: ${show(reply)}`).toBeUndefined();
  return arr(reply['frames'], `${what}: frames`).map((v, i) => {
    const f = obj(v, `${what}: frames[${i}]`);
    const list = (k: string): JsonObject[] | null => (Array.isArray(f[k]) ? (f[k] as JsonValue[]).map((x, j) => obj(x, `${what}: frames[${i}].${k}[${j}]`)) : null);
    const ups = f['element_uploads'];
    let uploads: Record<string, number[]> | null = null;
    if (isObject(ups)) {
      uploads = {};
      for (const [k, x] of Object.entries(ups)) {
        expect(Array.isArray(x) && x.every((e) => Number.isSafeInteger(e)), `${what}: frames[${i}].element_uploads.${k} is a list of element IDs: ${show(x)}`).toBe(true);
        uploads[k] = (x as number[]).slice().sort((a, b) => a - b);
      }
    }
    return {
      frame: num(f['frame'], `${what}: frames[${i}].frame`),
      indirect: list('indirect_draws')?.map((d) => ({ item: String(d['item']), view: String(d['view']), batch: String(d['batch']) })) ?? null,
      encoded: list('encoded')?.map((e) => ({ batch: String(e['batch']), items: Array.isArray(e['items']) ? e['items'].map(String) : [] })) ?? null,
      uploads,
      values: isObject(f['values']) ? f['values'] : null,
    };
  });
}

// ---------------------------------------------------------------------------------------------------
// The step budget (#2011's `node scripts/physics-budget.mjs`), asked for a scene's world (README: The budget check).

export interface SceneBudget { scene: JsonObject; world: string; steps: number; reference_mac: { app: boolean; web: boolean } }
/** Runs the check on `request`: exit 0, one JSON report on stdout, ok. */
export function budget(request: SceneBudget): JsonObject {
  const what = 'node scripts/physics-budget.mjs';
  const r = spawnSync(process.execPath, [BUDGET_SCRIPT], { cwd: REPO, input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 256 * MIB, env: { ...process.env, ...CARGO_ENV }, timeout: BUDGET_TIMEOUT - 600_000, killSignal: 'SIGKILL' });
  const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
  expect(code === 'ETIMEDOUT' ? 'timed out' : '', `${what} finished in time`).toBe('');
  if (r.error && code !== 'EPIPE') throw Error(`${what}: ${r.error.message}`);
  const stdout = r.stdout ?? '';
  expect(r.status, `${what} exits 0; stdout: ${stdout.slice(0, 1000)}; stderr: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
  const lines = stdout.split('\n').filter((l) => l.trim() !== '');
  expect(lines.length, `${what} writes one JSON report line: ${stdout.slice(0, 1000)}`).toBe(1);
  const report = obj(JSON.parse(lines[0]!) as JsonValue, `${what}: the report`);
  expect(report['ok'], `${what}: the check ran (ok: true): ${show(report)}`).toBe(true);
  return report;
}
