// Test-side tools for the #2288 acceptance tests (README: The surface under test). They extend #1921's surface, imported
// read only through ../1921/helpers.ts (and through it #1918's, #2010's and #2009's): the same `deep-physics` binary
// asked to check and bake a scene's world (`scene` with `world: "<world ID>"`), answering `built` and each body's state
// per step and #2010's `step_hashes`; and `deep-show run` (#393's convention, #1918's build) presenting a scene, reading
// an instancer's columns with `eval` at each frame, and reading a scatter's elements with #420's `geometry` call (#2013's
// row). Nothing here stands in for the physics module, the scatter or the column view: every state, hash, column,
// element and issue read here is the program's own; every expected value comes from the issue's numbers, the design's
// transform rule (Instance `instance@1`: element world = instancer world × its row; Units and axes: degrees,
// R = Rz·Ry·Rx) and the fixtures' own rows, written here before any program runs.

import { expect } from 'vitest';
import {
  GROUND, MATERIALS, arr, camera, corners, isObject, num, obj, quatMatrix, show, world, type JsonObject, type JsonValue, type Quat,
  type V3,
} from '../1921/helpers.ts';

export * from '../1921/helpers.ts';

/** Each criterion's ID (scripts/proof-change.mjs: the first eight hex digits of the SHA-256 of its text, trimmed, white space collapsed). */
export const AC = {
  1: '#2288.392506fb',
  2: '#2288.015cbad4',
  3: '#2288.e6a5f511',
} as const;

/** The criterion's tolerance on a pose read back or built: 1e-6 m. */
export const METRE_TOL = 1e-6;

// ---------------------------------------------------------------------------------------------------
// Quaternions [x, y, z, w] and poses, in f64.

export function qmul(a: readonly number[], b: readonly number[]): Quat {
  const [ax, ay, az, aw] = a as Quat;
  const [bx, by, bz, bw] = b as Quat;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
export const qconj = (q: readonly number[]): Quat => [-q[0]!, -q[1]!, -q[2]!, q[3]!];
/** A turn of `deg` about the unit axis `axis`. */
export function qaxis(axis: V3, deg: number): Quat {
  const h = (deg * Math.PI) / 360;
  return [axis[0] * Math.sin(h), axis[1] * Math.sin(h), axis[2] * Math.sin(h), Math.cos(h)];
}
/** `v` turned by the rotation of `q`. */
export function rotate(q: readonly number[], v: readonly number[]): V3 {
  const m = quatMatrix(q);
  return m.map((row) => row[0] * v[0]! + row[1] * v[1]! + row[2] * v[2]!) as V3;
}

export interface Placed { pos: number[]; rot: number[] }
/**
 * How far apart two poses of one box of half extents `half` are, in metres: the most any of its eight corners moves
 * between them. A pose read back "within 1e-6 m" is one whose every point is within 1e-6 m, so this holds its position
 * and its rotation to the criterion's one tolerance in metres.
 */
export function poseGap(a: Placed, b: Placed, half: V3): number {
  const ca = corners(a.pos, quatMatrix(a.rot), half);
  const cb = corners(b.pos, quatMatrix(b.rot), half);
  return Math.max(...ca.map((c, i) => Math.hypot(c[0] - cb[i]![0], c[1] - cb[i]![1], c[2] - cb[i]![2])));
}

/** An issue names `id`: in its `ids`, as a segment of its `path`, as a word in its `what`, or as its `actual`. */
export function namesId(issue: JsonObject, id: string): boolean {
  const ids = issue['ids'];
  if (Array.isArray(ids) && ids.includes(id)) return true;
  if (typeof issue['path'] === 'string' && issue['path'].split(/[/.#]/).includes(id)) return true;
  if (typeof issue['what'] === 'string' && new RegExp(`(^|[^A-Za-z0-9_])${id}([^A-Za-z0-9_]|$)`).test(issue['what'])) return true;
  const actual = issue['actual'];
  return actual === id || (Array.isArray(actual) && actual.includes(id));
}

// ---------------------------------------------------------------------------------------------------
// Scenes, in the agent's form (#421's payload: no `id`, no `layers`), as deep-show and deep-physics take them.

export const SPAN_FPS = 60;
export function scene2288(title: string, span: string, items: Record<string, JsonObject>, extra: JsonObject): JsonObject {
  const withIds: JsonObject = {};
  let order = 0;
  for (const [id, item] of Object.entries(items)) withIds[id] = { id, name: id, order: `a${String(order++).padStart(3, '0')}`, ...item };
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #2288 acceptance fixture.`, size: [640, 360], camera: 'cam',
    transport: { span, frame_rate: [SPAN_FPS, 1] }, requires: { modules: { scene3d: '^1' } }, ...extra, items: withIds,
  };
}
const PLANE: JsonObject = { kind: 'plane', normal: [0, 1, 0] };
/** A world document: 120 Hz, 4 substeps, g = 9.81 m/s², seed 2288, the #1921 suite's materials, every body one shape use. */
export const world2288 = (bodies: number, parts: JsonObject): JsonObject =>
  world({ seed: 2288, capacity: { bodies, shapes: bodies, joints: 0, contacts: 4096, particles: 0 }, contact_materials: MATERIALS, ...parts });

/** Document IDs the hub minted (26 Crockford characters). */
export const DOC2288 = (n: number): string => `01JB2288D0${String(n).padStart(16, '0')}`;

// ---------------------------------------------------------------------------------------------------
// Criteria 1 and 3: `tiles`, a 100-element instancer at (5, 0, 0) turned 90° about +Y (the issue's numbers), and `tile`,
// a body with `each: "tiles"`, written back by a `<body>#*` output. Rows in the instancer's own frame:
// row i holds element (37 × i) mod 100 (37 and 100 are coprime, so each ID 0 … 99 once, out of row order), at
// ((i mod 10) × 0.5 − 2.25, 0.5 + 5i ÷ 128, ⌊i ÷ 10⌋ × 0.5 − 2.25), every place exact in f32, turned
// ((11 × i) mod 61) − 30 degrees about +X (an f32 quaternion), so an element's world rotation is the instancer's
// turn about +Y times its own about +X, which isn't the product the other way round.

export const TURNED_WORLD = 'turned';
export const TILES = 'tiles';
export const TILE = 'tile';
export const CHANNEL = 'nudge';
export const TILE_COUNT = 100;
/** The issue's: the instancer at (5, 0, 0), turned 90° about +Y (Euler degrees, R = Rz·Ry·Rx). */
export const TILES_AT: V3 = [5, 0, 0];
export const TILES_TURN: V3 = [0, 90, 0];
/** The instancer's turn as a quaternion, in f64 from the issue's 90° about +Y. */
export const TILES_Q: Quat = qaxis([0, 1, 0], 90);
/** A tile's collider and drawn prototype: a 0.3 m box. */
export const TILE_HALF: V3 = [0.15, 0.15, 0.15];
/** The issue's "played for 2 s": 120 frames at 60 fps after frame 0, frame f on step 2f of a 120 Hz world. */
export const TILE_FRAMES = 120;
export const TILE_STEPS = 2 * TILE_FRAMES;

export const tileId = (row: number): number => (37 * row) % TILE_COUNT;
export const tilePos = (row: number): V3 => [(row % 10) * 0.5 - 2.25, 0.5 + (5 * row) / 128, Math.floor(row / 10) * 0.5 - 2.25];
export function tileRot(row: number): Quat {
  const q = qaxis([1, 0, 0], ((11 * row) % 61) - 30);
  return q.map((c) => Math.fround(c)) as Quat;
}
export const tileAddress = (id: number): string => `${TILE}#${id}`;
export const TILE_ROWS = Array.from({ length: TILE_COUNT }, (_, i) => i);

/** Row `row`'s element in the world: the instancer's world transform × its row (pos T + R·p, rot q_T · q_row). */
export function tileWorld(row: number): Placed {
  const p = rotate(TILES_Q, tilePos(row));
  return { pos: [TILES_AT[0] + p[0], TILES_AT[1] + p[1], TILES_AT[2] + p[2]], rot: qmul(TILES_Q, tileRot(row)) };
}
/** A pose in the world as the instancer's own frame holds it: the inverse of its world transform applied. */
export function inTilesFrame(w: Placed): Placed {
  const d = [w.pos[0]! - TILES_AT[0], w.pos[1]! - TILES_AT[1], w.pos[2]! - TILES_AT[2]];
  return { pos: rotate(qconj(TILES_Q), d), rot: qmul(qconj(TILES_Q), w.rot) };
}

/**
 * The turned lab: `ground`, a static plane y = 0; `tile` with `each: "tiles"`, a 0.3 m box per element dropped from its
 * row, written back by the output `written` (`from: "tile#*"`, `to: "items/tiles"`). With `channel`, the scene's channel
 * `nudge` moves the instancer: `items/tiles/at/pos` from (5, 0, 0) at 0 s to (6, 0, 0) at 1 s, linear (criterion 3).
 */
export function turnedScene(channel = false): JsonObject {
  const lab = world2288(TILE_COUNT + 1, {
    shapes: { plane: PLANE, chip: { kind: 'box', half: TILE_HALF } },
    bodies: { ground: GROUND, [TILE]: { kind: 'dynamic', each: TILES, shapes: [{ shape: 'chip', contact_material: 'block' }] } },
    outputs: { written: { from: `${TILE}#*`, read: 'pose', to: `items/${TILES}` } },
  });
  const channels: JsonObject = {
    [CHANNEL]: {
      target: `items/${TILES}/at/pos`, type: 'vec3',
      keys: { k0: { t: '0s', value: TILES_AT, interp: 'linear' }, k1: { t: '1s', value: [6, 0, 0], interp: 'linear' } },
    },
  };
  return scene2288(channel ? 'Turned tiles, nudged' : 'Turned tiles', '2s', {
    cam: camera([5, 4, 14], [5, 1, 0]),
    chip: { kind: 'mark.box@1', params: { size: [0.3, 0.3, 0.3] }, visible: false },
    [TILES]: {
      kind: 'instance@1', at: { pos: TILES_AT, rot: TILES_TURN },
      params: { of: ['chip'], ids: TILE_ROWS.map(tileId), pos: TILE_ROWS.map(tilePos), rot: TILE_ROWS.map(tileRot) },
    },
  }, { ...(channel ? { channels } : {}), worlds: { [TURNED_WORLD]: lab } });
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: `rocks`, a 200-element scatter, and `rock`, a body with `each: "rocks"`. The scatter is a poisson
// distribute over `slab`, a 16 × 16 m plate 2 m up, its elements at least 0.9 m apart (a 0.5 m box turned any way
// stays within 0.433 m of its centre, so no two overlap), turned −60° to 60° about +Y and leaning up to 30°, capped at
// 200 (`max`); the instancer itself sits at the origin, unturned, so its elements' world poses are their own.

export const SCATTER_WORLD = 'scatter';
export const ROCKS = 'rocks';
export const ROCK = 'rock';
export const SLAB = 'slab';
export const SCATTER_COUNT = 200;
export const SCATTER_STEPS = 600;
export const MIN_DISTANCE = 0.9;
export const SLAB_Y = 2;
export const SLAB_SIZE = 16;
export const ROCK_HALF: V3 = [0.25, 0.25, 0.25];
const ROCK_SHAPES: JsonObject[] = [{ shape: 'pebble', contact_material: 'block' }];
const SCATTER_SHAPES: JsonObject = { plane: PLANE, pebble: { kind: 'box', half: ROCK_HALF } };
export const rockAddress = (id: number): string => `${ROCK}#${id}`;

/** The scatter scene; without `withWorld`, the same items and no world (the scatter's poses read on their own). */
export function scatterScene(withWorld = true): JsonObject {
  const field = { on: SLAB, mode: 'poisson', min_distance: MIN_DISTANCE, seed: 2288, max: SCATTER_COUNT, yaw: [-60, 60], tilt: 30 };
  const items = {
    cam: camera([0, 12, 24], [0, 1, 0]),
    [SLAB]: { kind: 'plate@1', params: { grid: [1, 1], size: [SLAB_SIZE, SLAB_SIZE] }, at: { pos: [0, SLAB_Y, 0] } },
    pebble: { kind: 'mark.box@1', params: { size: [0.5, 0.5, 0.5] }, visible: false },
    [ROCKS]: { kind: 'instance@1', params: { of: ['pebble'], from: { distribute: field } } },
  };
  const scatter = world2288(SCATTER_COUNT + 1, {
    shapes: SCATTER_SHAPES,
    bodies: { ground: GROUND, [ROCK]: { kind: 'dynamic', each: ROCKS, shapes: ROCK_SHAPES } },
  });
  return scene2288('Scattered rocks', '5s', items, withWorld ? { worlds: { [SCATTER_WORLD]: scatter } } : {});
}

/** One scattered element as the `geometry` call reads it (#2013's row): its stable ID, its world pose and its scale. */
export interface Scattered { id: number; pos: V3; rot: Quat; scale: V3; raw: JsonObject }
/**
 * Instancer `id`'s elements in a `geometry` reply, by ID: `pos` in world metres, `rot` its quaternion `[x, y, z, w]`
 * where it tilts, else its `yaw` about +Y as one.
 */
export function scatteredOf(reply: JsonObject | undefined, id: string, what: string): Scattered[] {
  expect(reply?.['code'], `${what}: the geometry call answers for the instancer ${id}: ${show(reply)}`).toBeUndefined();
  const row = arr(reply!['items'], `${what}: items`).filter(isObject).find((r) => r['id'] === id);
  expect(row, `${what}: a row for the instancer ${id}: ${show(reply)}`).toBeDefined();
  const out = arr(row!['elements'], `${what}: ${id}.elements`).map((v, i): Scattered => {
    const w = `${what}: ${id}.elements[${i}]`;
    const e = obj(v, w);
    const p = arr(e['pos'], `${w}.pos`).map((x, k) => num(x, `${w}.pos[${k}]`));
    expect(p.length, `${w}.pos is [x, y, z]`).toBe(3);
    const r = e['rot'];
    const rot = Array.isArray(r)
      ? r.map((x, k) => num(x, `${w}.rot[${k}]`))
      : qaxis([0, 1, 0], num(e['yaw'] ?? 0, `${w}.yaw`));
    expect(rot.length, `${w}.rot is [x, y, z, w]`).toBe(4);
    const s = e['scale'] ?? 1;
    const scale = (Array.isArray(s) ? s : [s, s, s]).map((x, k) => num(x as JsonValue, `${w}.scale[${k}]`));
    return { id: num(e['id'], `${w}.id`), pos: p as V3, rot: rot as Quat, scale: scale as V3, raw: e };
  });
  return out.sort((a, b) => a.id - b.id);
}

/**
 * Criterion 2's twin: the scatter world with its 200 bodies declared one by one, in element-ID order, each under the
 * stable ID its element body has (`rock#<id>`, #1921), with the each-body's fields and its element's pose as the
 * scatter gives it (the `geometry` row's numbers, unchanged).
 */
export function oneByOne(elements: readonly Scattered[]): JsonObject {
  const bodies: JsonObject = { ground: GROUND };
  for (const e of elements) bodies[rockAddress(e.id)] = { kind: 'dynamic', shapes: ROCK_SHAPES, pose: { pos: e.pos, rot: e.rot } };
  return world2288(SCATTER_COUNT + 1, { shapes: SCATTER_SHAPES, bodies });
}

/** #420's `geometry` call on the named items of a presented document. */
export const geometryCall = (doc: string, items: readonly string[]): JsonObject => ({ call: 'geometry', doc, items: [...items] });

/** A list of numbers `width` wide per row, read from a reply value, failures collected (any finite numbers). */
export function rowsOf(v: JsonValue | undefined, rows: number, width: number, what: string, fails: string[]): number[][] {
  if (!Array.isArray(v) || v.length !== rows) {
    fails.push(`${what} isn't ${rows} rows: ${show(v).slice(0, 200)}`);
    return [];
  }
  return v.map((row, i) => {
    const ok = Array.isArray(row) && row.length === width && row.every((x) => typeof x === 'number' && Number.isFinite(x));
    if (!ok) fails.push(`${what} row ${i} isn't ${width} numbers: ${show(row)}`);
    return ok ? (row as number[]) : new Array<number>(width).fill(NaN);
  });
}
