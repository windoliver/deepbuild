// The criteria's fixtures (README: Fixtures): the documents, each in the agent's form for `deep_show` (no `id`, no
// layers; every program and mesh listed in `assets` with a license and held in the evidence store), with the point
// control's fields as the issue gives them. Every number a test expects comes from geometry.ts over the values here.
// Nothing here hits, picks, steps or draws anything.

import { encodeRgbaPng } from '../467/helpers.ts';
import { cross, sub, unit, type Plate, type Pose, type V2, type V3 } from './geometry.ts';
import { FLICKS, putEvidence, sha256, type JsonObject, type Program } from './helpers.ts';
import {
  ARMY_WRITES, BELT_WRITES, GRID, ORDER_WRITES, PIN_WRITES, SELECT_WRITES, WORLD_WRITES, type Army, type Writes,
} from './programs.ts';

const LICENSE: JsonObject = { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the #540 acceptance tests.' };
export const SEED = 540;

function ordered(items: Record<string, JsonObject>): JsonObject {
  return Object.fromEntries(Object.entries(items).map(([id, item], k) => [id, { id, name: id, order: `a${String(k).padStart(4, '0')}`, ...item }]));
}
const assets = (list: Record<string, string>): JsonObject =>
  Object.fromEntries(Object.entries(list).map(([name, sha]) => [name, { sha256: sha, license: LICENSE }]));
/** A logic item (Logic `logic@1`): its program by SHA-256, its step rate, the controls it reads and its arrays. */
export function logicItem(program: Program, writes: Writes, reads: string[] = [], stepRate = 60): JsonObject {
  return { kind: 'logic@1', params: { program: program.sha, step_rate: stepRate, ...(reads.length ? { reads } : {}), writes: Object.fromEntries(writes.map(([n, type, count]) => [n, { type, count }])) } };
}
const column = (path: string, as: string): JsonObject => ({ array: path, as });
/** A point control (Control: point), class document, with the fields given. */
export const pointControl = (label: string, fields: JsonObject): JsonObject => ({ kind: 'point', class: 'document', label, role: 'application', ...fields });

/** A 3D scene in the agent's form: metres, +Y up; the camera `cam`; a 4 s transport at 60 fps unless `extra` says. */
export function scene(title: string, size: V2, items: Record<string, JsonObject>, extra: JsonObject, modules: string[]): JsonObject {
  return {
    format: 1, profile: 'scene', title, description: `${title}: a #540 acceptance fixture.`, size, seed: SEED, camera: 'cam',
    transport: { span: '4s', frame_rate: [60, 1] }, requires: { modules: Object.fromEntries(modules.map((m) => [m, '^1'])) }, ...extra, items: ordered(items),
  };
}
export const perspective = (p: Pose, near = 0.1, far = 500): JsonObject => ({ kind: 'camera@1', params: { projection: 'perspective', position: p.eye, target: p.target, fov: p.fov!, near, far } });
export const orthographic = (p: Pose, far = 200): JsonObject => ({ kind: 'camera@1', params: { projection: 'orthographic', position: p.eye, target: p.target, view_width: p.viewWidth!, near: p.near!, far } });
const box = (size: V3, at: V3, extra: JsonObject = {}): JsonObject => ({ kind: 'mark.box@1', params: { size }, at: { pos: at }, ...extra });
const paint: JsonObject = { fill: { role: 'accent' } };

// ---------------------------------------------------------------------------------------------------
// Criterion 1: the 12 × 12 grid, a figure as #539's suite writes one. `board`, cell [16, 16] laid out by grid.size from
// `world`, at (8, 8) on a 224 × 224 u page shown in an 896 × 896 px panel (4 px a u): cell (cx, cy)'s centre is page
// (8 + 16 cx, 8 + 16 cy), where its drawn quad and the floor of the position over the cell agree.

export const PAGE: V2 = [224, 224];
export const PANEL_2D: V2 = [896, 896];
export const cellCentre = ([cx, cy]: V2): V2 => [8 + 16 * cx, 8 + 16 * cy];
/** A page point in panel px under the figure's camera (target the page's centre, view width the page's). */
export const toPanel = ([x, y]: V2): V2 => [PANEL_2D[0] / 2 + (x - PAGE[0] / 2) * (PANEL_2D[0] / PAGE[0]), PANEL_2D[1] / 2 + (y - PAGE[1] / 2) * (PANEL_2D[0] / PAGE[0])];
const TILES: [number, number, number][] = [[64, 112, 72], [104, 152, 96]];
export const putAtlas = (evidence: string): string => putEvidence(evidence, encodeRgbaPng(16, 8, (x) => [...TILES[Math.floor(x / 8)]!, 255]));
export function gridDoc(atlas: string, world: Program, belts: Program): JsonObject {
  return {
    format: 1, profile: 'figure', title: '#540 belts', description: 'The #540 acceptance tests\' 12 × 12 grid.', size: PAGE, seed: SEED, camera: 'cam',
    transport: { span: '4s', frame_rate: [60, 1] }, requires: { modules: { input: '^1', logic: '^1' } },
    items: ordered({
      cam: { kind: 'camera@1', params: { projection: 'orthographic', target: [PAGE[0] / 2, PAGE[1] / 2, 0], view_width: PAGE[0] } },
      world: logicItem(world, WORLD_WRITES),
      board: {
        kind: 'marks@1', at: { pos: [8, 8, 0] },
        params: {
          mark: 'image', atlas: { asset: atlas, cell: [8, 8], padding: 1 }, grid: { shape: 'square', cell: [16, 16], size: [GRID, GRID] },
          alive: column('world.alive', 'bool'), columns: { tile: column('world.tiles', 'u16') },
        },
      },
      belts: logicItem(belts, BELT_WRITES, ['place']),
    }),
    assets: assets({ tile_atlas: atlas, world_program: world.sha, belts_program: belts.sha }),
    controls: { place: { ...pointControl('Lay belts', { on: 'board', drag: 'path' }), role: 'grid' } },
  };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: a 64 × 64 m terrain plate at 1 m spacing whose height is 0.01 x z (a saddle, so each cell's two
// triangles differ from its bilinear surface and the split matters), 10 standing units on it, a perspective camera at
// (0, 40, 30) looking at the origin on a 1000 × 800 frame, and a box from (250, 340) to (750, 470) px.

export const TERRAIN: Plate = { size: [64, 64], spacing: 1, h: (x, z) => 0.01 * x * z };
export const TERRAIN_POSE: Pose = { eye: [0, 40, 30], target: [0, 0, 0], size: [1000, 800], fov: 60 };
export const BOX_PRESS: V2 = [250, 340];
export const BOX_RELEASE: V2 = [750, 470];
/** The units' x and z: the first six inside the box's ground quad (2.1 m or more from its edges), the last four outside it (5.1 m or more). */
export const STANDING: [number, number][] = [[-11, -1], [-5, 1], [0, -1.5], [4, 1.5], [9, 0], [12.5, -1], [-20, 0], [20, 1], [0, -10], [2, 10]];
export const STANDING_ARMY: Army = {
  name: 'army-standing', at: STANDING, perStep: 0, k0: 0, height: TERRAIN.h,
  heightText: (x, z) => `(f64.mul (f64.mul (f64.const 0.01) ${x}) ${z})`,
};
const unitItems = (army: Program): Record<string, JsonObject> => ({
  unit: box([0.8, 0.8, 0.8], [0, 0.4, 0], { visible: false }),
  army: logicItem(army, ARMY_WRITES, [], 20),
  units: { kind: 'instance@1', params: { of: ['unit'], live: column('army.live', 'bool'), gen: column('army.gen', 'u32'), pos: column('army.pos', 'f32') } },
});
export function terrainDoc(army: Program, select: Program): JsonObject {
  return scene('#540 terrain box', TERRAIN_POSE.size, {
    cam: perspective(TERRAIN_POSE),
    ground: { kind: 'plate@1', params: { terrain: { height: '0.01 * position.x * position.z', size: TERRAIN.size, spacing: TERRAIN.spacing, tile: 64, lod_levels: 1 } } },
    ...unitItems(army),
    select: logicItem(select, SELECT_WRITES, ['box'], 20),
  }, {
    assets: assets({ army_program: army.sha, select_program: select.sha }),
    controls: { box: pointControl('Select', { on: 'ground', drag: 'box' }) },
  }, ['scene3d', 'input', 'logic']);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: the level plane y = 0 under a camera 10 m up looking 30° below the horizon (its target on the plane
// 10 ÷ tan 30° m ahead of its foot), fov 90° on an 800 × 800 frame.

export const AHEAD = 10 / Math.tan(Math.PI / 6);
export const PLANE_POSE: Pose = { eye: [0, 10, 0], target: [0, 0, AHEAD], size: [800, 800], fov: 90 };
export function planeDoc(): JsonObject {
  return scene('#540 level plane', PLANE_POSE.size, {
    cam: perspective(PLANE_POSE),
    floor: { kind: 'plate@1', params: { grid: [1, 1], size: [200, 200] } },
  }, { controls: { aim: pointControl('Order a move', { on: { plane: { y: 0 } } }) } }, ['scene3d', 'input']);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4: the 2 × 2 m quad `panel` at y = 0.5, a JSON glTF of four vertices (x and z at ±1, uv (x + 1) ÷ 2 and
// (z + 1) ÷ 2) and two triangles wound to face +Y, split on the diagonal from (−1, −1) to (1, 1): face 0 (x ≥ z) is
// vertices 0, 2, 1 and face 1 is 0, 3, 2. Seen from (0, 10.5, 3) aimed at the origin, fov 60° on 800 × 600.

export const QUAD_XZ: V2[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
export const QUAD_UV: V2[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
export const QUAD_Y = 0.5;
export const QUAD_FACES: [number, number, number][] = [[0, 2, 1], [0, 3, 2]];
export const QUAD_POSE: Pose = { eye: [0, 10.5, 3], target: [0, 0, 0], size: [800, 600], fov: 60 };
/** The quad's glTF: positions, normals and uv0 as f32 (every value exact), u32 indices; its bytes and SHA-256. */
export function quadGltf(): { bytes: Buffer; sha: string } {
  const pos = QUAD_XZ.flatMap(([x, z]) => [x, QUAD_Y, z]);
  const nrm = QUAD_XZ.flatMap(() => [0, 1, 0]);
  const uv = QUAD_UV.flat();
  const idx = QUAD_FACES.flat();
  const f32 = (v: number[]): Buffer => { const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeFloatLE(x, i * 4)); return b; };
  const u32 = Buffer.alloc(idx.length * 4); idx.forEach((x, i) => u32.writeUInt32LE(x, i * 4));
  const parts = [f32(pos), f32(nrm), f32(uv), u32];
  let at = 0;
  const views = parts.map((b) => { const v = { buffer: 0, byteOffset: at, byteLength: b.length }; at += b.length; return v; });
  const bin = Buffer.concat(parts);
  const doc = {
    asset: { version: '2.0', generator: 'deepbuild tests/acceptance/540' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'panel', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-1, QUAD_Y, -1], max: [1, QUAD_Y, 1] },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 3, componentType: 5125, count: idx.length, type: 'SCALAR' },
    ],
    bufferViews: views, buffers: [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${bin.toString('base64')}` }],
  };
  const bytes = Buffer.from(JSON.stringify(doc));
  return { bytes, sha: sha256(bytes) };
}
/** Face `f`'s unit normal by its winding, in the world. */
export function quadNormal(f: number): V3 {
  const [a, b, c] = QUAD_FACES[f]!.map((i) => [QUAD_XZ[i]![0], QUAD_Y, QUAD_XZ[i]![1]] as V3);
  return unit(cross(sub(b!, a!), sub(c!, a!)));
}
export function quadDoc(gltf: string, pins: Program): JsonObject {
  return scene('#540 surface quad', QUAD_POSE.size, {
    cam: perspective(QUAD_POSE),
    panel: { kind: 'mesh.asset@1', params: { sha256: gltf, node: { scene: 0 } } },
    pins: logicItem(pins, PIN_WRITES, ['aim']),
  }, {
    assets: assets({ panel_mesh: gltf, pins_program: pins.sha }),
    controls: { aim: pointControl('Pin a note', { on: 'surface', targets: ['panel'] }) },
  }, ['scene3d', 'input', 'logic']);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 5: a 1 m cube at the origin, turned about +Y by the channel `spin` (0° at 0 s, linear to 360° at 4 s:
// 90°/s), under an orthographic camera at (0, 0, 10) looking along −Z, 4 m across a 400 × 400 frame (100 px a metre),
// its near plane 1 m ahead of the eye.

export const CUBE_POSE: Pose = { eye: [0, 0, 10], target: [0, 0, 0], size: [400, 400], viewWidth: 4, near: 1 };
export const DEG_PER_S = 90;
export function cubeDoc(targets: string[]): JsonObject {
  return scene('#540 turning cube', CUBE_POSE.size, {
    cam: orthographic(CUBE_POSE),
    cube: box([1, 1, 1], [0, 0, 0]),
  }, {
    channels: { spin: { target: 'items/cube/at/rot/1', type: 'f32', keys: { k0: { t: '0s', value: 0, interp: 'linear' }, k1: { t: '4s', value: 4 * DEG_PER_S, interp: 'linear' } } } },
    controls: { aim: pointControl('Stack a voxel', { on: 'surface', targets }) },
  }, ['scene3d', 'input', 'motion']);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 6: the lab. Two static 1 m boxes, `base` centred at (0, 0.5, 0) and `top` standing on it at (0, 1.5, 0),
// drawn by `base_box` and `top_box`; a 1 kg ball of radius 0.1 m with gravity_scale 0 resting at (4, 0.5, 4), launched
// by `throw`, derived from each entry of `aim`: from a pose at its ray.origin, at 20 m/s along its ray.dir. The camera
// at (0, 1.5, 10) looks at the top box's centre, fov 60° on 800 × 600; the transport is 3 s.

export const LAB_TARGET: V3 = [0, 1.5, 0];
export const LAB_POSE: Pose = { eye: [0, 1.5, 10], target: LAB_TARGET, size: [800, 600], fov: 60 };
/** The face of the top box that faces +Z, and its centre. */
export const FACE_CENTRE: V3 = [0, 1.5, 0.5];
export const SPEED = 20;
export const BALL_REST: V3 = [4, 0.5, 4];
export function labDoc(): JsonObject {
  const material = { friction: 0.5, restitution: 0, density: 1000 };
  const world: JsonObject = {
    kind: 'physics.world@1', dimensions: 3, step_rate: 120, substeps: 4, gravity: [0, -9.81, 0], seed: SEED, mode: 'dynamic',
    capacity: { bodies: 3, shapes: 2, joints: 0, contacts: 16, particles: 0 },
    backend: { name: 'rapier3d', version: '=0.36.1' },
    contact_materials: { m: material },
    shapes: { block: { kind: 'box', half: [0.5, 0.5, 0.5] }, ball: { kind: 'sphere', radius: 0.1 } },
    bodies: {
      base: { kind: 'static', shapes: [{ shape: 'block', contact_material: 'm' }], pose: { pos: [0, 0.5, 0] } },
      top: { kind: 'static', shapes: [{ shape: 'block', contact_material: 'm' }], pose: { pos: [0, 1.5, 0] } },
      ball: { kind: 'dynamic', shapes: [{ shape: 'ball', contact_material: 'm' }], pose: { pos: BALL_REST }, mass: 1, gravity_scale: 0, sleep: false },
    },
    inputs: {
      throw: { kind: 'launch', targets: ['ball'], on: { control: 'aim', each: 'entry' }, from: 'pose', data: { 'from.pos': 'aim.ray.origin', linear: `${SPEED} * aim.ray.dir` } },
    },
  };
  return scene('#540 throw lab', LAB_POSE.size, {
    cam: perspective(LAB_POSE),
    base_box: box([1, 1, 1], [0, 0.5, 0]),
    top_box: box([1, 1, 1], [0, 1.5, 0]),
  }, {
    transport: { span: '3s', frame_rate: [60, 1] }, worlds: { lab: world },
    controls: { aim: pointControl('Throw', { on: { plane: { y: 0 } } }) },
  }, ['scene3d', 'input', 'physics']);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 7: a match in lockstep (`net@1`: 2 players, 20 Hz, delay 4, window 0) seen from straight above by an
// orthographic camera 40 m across 800 × 800 (20 px a metre; screen right is +x and screen down +z). Ten units move along
// +x at 10 m/s (0.5 m a 20 Hz step); at step 20 (1 s) they stand at MOVING. The box from (240, 240) to (560, 560) px is
// the ground square x, z in [−8, 8]: at the gesture six units lie inside it, two of them (4 and 5) 1.5 m from its +x
// edge, which they cross within four steps.

export const MATCH_POSE: Pose = { eye: [0, 50, 0], target: [0, 0, 0], size: [800, 800], viewWidth: 40, near: 1 };
export const MATCH_STEP = FLICKS / 20;
export const DELAY = 4;
export const MOVING: [number, number][] = [[-4, -4], [-4, 4], [0, -4], [0, 4], [6.5, -2], [6.5, 2], [12, -2], [12, 2], [0, 12], [0, -12]];
export const MOVING_ARMY: Army = { name: 'army-moving', at: MOVING, perStep: 0.5, k0: 20, height: () => 0, heightText: () => '(f64.const 0)' };
export const SQUARE_PRESS: V2 = [240, 240];
export const SQUARE_RELEASE: V2 = [560, 560];
export const SQUARE = 8;
export function lockstepDoc(army: Program, orders: Program): JsonObject {
  return scene('#540 lockstep box', MATCH_POSE.size, {
    cam: orthographic(MATCH_POSE),
    match: { kind: 'net@1', params: { relay: 'https://relay.test/540', players: 2, step_rate: 20, delay: DELAY, window: 0 } },
    ...unitItems(army),
    orders: logicItem(orders, ORDER_WRITES, ['box'], 20),
  }, {
    assets: assets({ army_program: army.sha, orders_program: orders.sha }),
    controls: { box: pointControl('Select', { on: { plane: { y: 0 } }, drag: 'box', targets: ['units'] }) },
  }, ['scene3d', 'input', 'logic', 'net']);
}

// ---------------------------------------------------------------------------------------------------
// Criteria 8 to 11: a camera at the origin looking along −Z, fov 90° on 1000 × 1000 (a focal length of 500 px): a
// point at depth d and x lands at column 500 + 500 x ÷ d.

export const EYE_POSE: Pose = { eye: [0, 0, 0], target: [0, 0, -1], size: [1000, 1000], fov: 90 };
/** The world x at depth `d` whose column edge or centre is `px`, and y for row `py`. */
export const xAt = (px: number, d: number): number => ((px - 500) * d) / 500;
export const yAt = (py: number, d: number): number => (-(py - 500) * d) / 500;
/** Criterion 8's 1 px line from (−2, −10, −5) to (−2, 10, −5): column 500 + 500 (−2) ÷ 5 = 300. */
export const RAIL: [V3, V3] = [[-2, -10, -5], [-2, 10, -5]];
const line = (a: V3, b: V3): JsonObject => ({ kind: 'mark.line@1', params: { points: [a, b], width: 1, paint } });
const point = (size: number, at: V3): JsonObject => ({ kind: 'mark.point@1', params: { size, paint }, at: { pos: at } });
export function railDoc(on: JsonObject | string, pins?: Program): JsonObject {
  return scene('#540 rail', EYE_POSE.size, {
    cam: perspective(EYE_POSE),
    rail: line(...RAIL),
    ...(pins ? { pins: logicItem(pins, PIN_WRITES, ['aim']) } : {}),
  }, {
    ...(pins ? { assets: assets({ pins_program: pins.sha }) } : {}),
    controls: { aim: pointControl('Aim', { on, targets: ['rail'], margin: 3 }) },
  }, pins ? ['scene3d', 'input', 'logic'] : ['scene3d', 'input']);
}
/** Criterion 9's two 1 px points, each on one pixel's centre: `near` at depth 5 on (500.5, 500.5), `far` at 50 on (504.5, 500.5). */
export const NEAR_PX: V2 = [500.5, 500.5];
export const FAR_PX: V2 = [504.5, 500.5];
export const NEAR_AT: V3 = [xAt(NEAR_PX[0], 5), yAt(NEAR_PX[1], 5), -5];
export const FAR_AT: V3 = [xAt(FAR_PX[0], 50), yAt(FAR_PX[1], 50), -50];
export function pointsDoc(): JsonObject {
  return scene('#540 two points', EYE_POSE.size, { cam: perspective(EYE_POSE), near: point(1, NEAR_AT), far: point(1, FAR_AT) }, {
    controls: { aim: pointControl('Aim', { on: { plane: { y: -10 } }, targets: ['near', 'far'], margin: 3 }) },
  }, ['scene3d', 'input']);
}
/**
 * Criterion 10. `wall`: an opaque box 2 mm deep whose front face is at depth 10, from column 600 to column `edge` (its
 * right edge on a column boundary) and rows 450 to 550. `mark`: a 3 px point at depth 20 centred on pixel (700, 500),
 * covering columns 699 to 701: with `edge` 701 its column 701 is the 1 px sliver past the wall, with 702 the wall hides
 * it all. `block`: an opaque box at depth 10 from column 200 to 301; `rail2`: a 1 px line at depth 10 in column 302.
 */
export const MARK_PX: V2 = [700.5, 500.5];
export const SLIVER_EDGE = 701;
export const HIDDEN_EDGE = 702;
export function wallDoc(edge: number, targets: string[]): JsonObject {
  const d = 10, half = 0.001;
  const wx0 = xAt(600, d), wx1 = xAt(edge, d), bx0 = xAt(200, d), bx1 = xAt(301, d);
  return scene(`#540 wall ${edge}`, EYE_POSE.size, {
    cam: perspective(EYE_POSE),
    wall: box([wx1 - wx0, 2 * yAt(450, d), 2 * half], [(wx0 + wx1) / 2, 0, -d - half]),
    mark: point(3, [xAt(MARK_PX[0], 20), yAt(MARK_PX[1], 20), -20]),
    block: box([bx1 - bx0, 2 * yAt(450, d), 2 * half], [(bx0 + bx1) / 2, 0, -d - half]),
    rail2: line([xAt(302.5, d), -10, -d], [xAt(302.5, d), 10, -d]),
  }, { controls: { aim: pointControl('Aim', { on: { plane: { y: -10 } }, targets, margin: 3 }) } }, ['scene3d', 'input']);
}
