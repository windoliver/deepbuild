// The criteria's fixtures (README: Fixtures): the documents, each in two envelopes (a session's, which `view3d` draws,
// and the agent's, which `deep_show` checks), the tank's glTF, and the f64 reference poses criterion 4 holds the barrel
// tips to. Nothing here draws, narrows, poses or selects anything.

import { ARMY, FOG_WRITES, GRID, HORDE, LINE_WRITES, SLOT_WRITES, THREE_GRIDS, armyWrites, tankAt, zerosProgram, type Army } from './programs.ts';
import {
  DARK_SKY, agentDoc, column, logicItem, material, sessionDoc, sha256, sun, topDown, type JsonObject, type Program, type V3,
} from './helpers.ts';

// ---------------------------------------------------------------------------------------------------
// Criterion 1: `units`, 16 slots of a 1.6 × 1 × 1.6 m box from `brains`, seen from straight above, 20 m across 400 px.

export const UNITS_SIZE: [number, number] = [400, 400];
export const UNITS_TARGET: V3 = [0, 0, 0];
export const UNITS_WIDTH = 20;
/** The unit's unlit color (linear), so a drawn unit reads it exactly. */
const UNIT_PAINT = material({ base_color: [0.9, 0.35, 0.1, 1], unlit: true });
function unitsItems(program: Program, distribute: boolean): Record<string, JsonObject> {
  return {
    cam: topDown(UNITS_TARGET, UNITS_WIDTH),
    sky: DARK_SKY,
    paint: UNIT_PAINT,
    ...(distribute ? { floor: { kind: 'plate@1', params: { grid: [1, 1], size: [20, 20] } } } : {}),
    unit: { kind: 'mark.box@1', params: { size: [1.6, 1, 1.6] }, material: 'paint', visible: false },
    brains: logicItem(program, SLOT_WRITES),
    units: {
      kind: 'instance@1',
      params: {
        of: ['unit'], live: column('brains.live', 'bool'), gen: column('brains.gen', 'u32'), pos: column('brains.pos', 'f32'),
        ...(distribute ? { from: { distribute: { on: 'floor', mode: 'poisson', min_distance: 1, seed: 537 } } } : {}),
      },
    },
  };
}
/** The units as a session holds them, fed by `program` (the criterion's plan, or the seeds' reference), at `seed` when given. */
export function unitsSession(program: Program, name = 'units', seed?: number): JsonObject {
  return sessionDoc(name, UNITS_SIZE, unitsItems(program, false), seed === undefined ? {} : { seed });
}
/** The units in the agent's form, with `from: distribute(…)` beside the array columns when `distribute`. */
export function unitsAgent(program: Program, distribute: boolean): JsonObject {
  return agentDoc(distribute ? 'Units fed by logic and a scatter' : 'Units fed by logic', UNITS_SIZE, unitsItems(program, distribute), [program]);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: `ground`, a 128 × 128 m terrain plate at 1 m spacing, flat at 0, centred on the origin, lit by one sun,
// in `soil`; its fog overlay from `fogger.fog`. Seen from straight above, 128 m across 2,048 px: 16 px a metre.

export const PLATE = 128;
export const FOG_SIZE: [number, number] = [2048, 2048];
export const FOG_TARGET: V3 = [0, 0, 0];
export const ROLES = ['fog', 'dim', 'none'] as const;
const SOIL = material({ base_color: [0.16, 0.3, 0.1, 1], metallic: 0, roughness: 1 });
/** The reference's cover outside the square: a material whose base color is the look's `fog` role. */
const FOGGED = material({ base_color: { role: 'fog' }, metallic: 0, roughness: 1 });
const SUN = sun(3, [-60, 20, 0]);
const terrain = { height: '0', size: [PLATE, PLATE], spacing: 1, tile: 64, lod_levels: 1 };
export const overlay = (grid: string): JsonObject => ({ grid, size: [GRID, GRID], roles: [...ROLES], opacity: 1 });
function plateItems(cover: 'soil' | 'fogged', overlays: JsonObject[], logic: JsonObject | null): Record<string, JsonObject> {
  return {
    cam: topDown(FOG_TARGET, PLATE),
    sky: DARK_SKY,
    sun: SUN,
    soil: SOIL,
    fogged: FOGGED,
    ...(logic ? { fogger: logic } : {}),
    ground: { kind: 'plate@1', params: { terrain, ...(overlays.length ? { overlays } : {}) }, material: cover },
  };
}
/** The fogged plate as a session holds it, at `size`. */
export const fogSession = (program: Program, size: [number, number] = FOG_SIZE): JsonObject =>
  sessionDoc('fog', size, plateItems('soil', [overlay('fogger.fog')], logicItem(program, FOG_WRITES)));
/** The references: the same plate with no overlay, its cover its own (`soil`) or the fog role's color (`fogged`). */
export const plateRefSession = (cover: 'soil' | 'fogged', size: [number, number] = FOG_SIZE): JsonObject =>
  sessionDoc(`plate-${cover}`, size, plateItems(cover, [], null));
/** The fogged plate in the agent's form. */
export const fogAgent = (program: Program): JsonObject =>
  agentDoc('Fog over a terrain plate', FOG_SIZE, plateItems('soil', [overlay('fogger.fog')], logicItem(program, FOG_WRITES)), [program]);
/** The plate with `n` overlays (2 or 3), each from its own grid of a logic item that writes three. */
export function overlaysAgent(program: Program, n: number): JsonObject {
  const grids = ['fogger.fog', 'fogger.a', 'fogger.b'].slice(0, n);
  return agentDoc(`${n} overlays on a terrain plate`, FOG_SIZE, plateItems('soil', grids.map(overlay), logicItem(program, THREE_GRIDS)), [program]);
}
export const threeGridsProgram = (): Program => zerosProgram('grids', THREE_GRIDS);

// ---------------------------------------------------------------------------------------------------
// Criterion 3: `links`, a `mark.line@1` in segments mode, 4 px wide, in the look's `sand`, whose points read
// `laser.points`; seen from straight above, 40 m across 800 px: 20 px a metre.

export const LINE_SIZE: [number, number] = [800, 800];
export const LINE_TARGET: V3 = [0, 0, 0];
export const LINE_WIDTH_M = 40;
function lineItems(program: Program): Record<string, JsonObject> {
  return {
    cam: topDown(LINE_TARGET, LINE_WIDTH_M),
    sky: DARK_SKY,
    laser: logicItem(program, LINE_WRITES),
    links: { kind: 'mark.line@1', params: { points: { array: 'laser.points', rows: 'all' }, mode: 'segments', width: 4, cap: 'butt', fog: false, paint: { fill: { role: 'sand' } } } },
  };
}
export const lineSession = (program: Program): JsonObject => sessionDoc('links', LINE_SIZE, lineItems(program));
export const lineAgent = (program: Program): JsonObject => agentDoc('Live 3D lines', LINE_SIZE, lineItems(program), [program]);

// ---------------------------------------------------------------------------------------------------
// Criterion 4: the tank's glTF and `tanks`, an instancer of it fed by `army`.

/** The tank's nodes, each a translation from its parent with no rotation or scale: hull (a root), turret on the hull,
 * barrel on the turret, and the barrel's tip, an empty node 2.5 m along the barrel's +Z. Every number is exact in f32. */
export const HULL: V3 = [0, 0.5, 0];
export const TURRET: V3 = [0, 0.75, -0.375];
export const BARREL: V3 = [0, 0.125, 0.75];
export const TIP: V3 = [0, 0, 2.5];
interface BoxMesh { positions: number[]; normals: number[]; indices: number[] }
/** An axis-aligned box from `lo` to `hi`, flat-shaded, wound counterclockwise seen from outside. */
function boxMesh(lo: V3, hi: V3): BoxMesh {
  const positions: number[] = []; const normals: number[] = []; const indices: number[] = [];
  const faces: [V3, V3[]][] = [
    [[1, 0, 0], [[hi[0], lo[1], hi[2]], [hi[0], lo[1], lo[2]], [hi[0], hi[1], lo[2]], [hi[0], hi[1], hi[2]]]],
    [[-1, 0, 0], [[lo[0], lo[1], lo[2]], [lo[0], lo[1], hi[2]], [lo[0], hi[1], hi[2]], [lo[0], hi[1], lo[2]]]],
    [[0, 1, 0], [[lo[0], hi[1], hi[2]], [hi[0], hi[1], hi[2]], [hi[0], hi[1], lo[2]], [lo[0], hi[1], lo[2]]]],
    [[0, -1, 0], [[lo[0], lo[1], lo[2]], [hi[0], lo[1], lo[2]], [hi[0], lo[1], hi[2]], [lo[0], lo[1], hi[2]]]],
    [[0, 0, 1], [[lo[0], lo[1], hi[2]], [hi[0], lo[1], hi[2]], [hi[0], hi[1], hi[2]], [lo[0], hi[1], hi[2]]]],
    [[0, 0, -1], [[hi[0], lo[1], lo[2]], [lo[0], lo[1], lo[2]], [lo[0], hi[1], lo[2]], [hi[0], hi[1], lo[2]]]],
  ];
  for (const [n, quad] of faces) {
    const base = positions.length / 3;
    for (const p of quad) { positions.push(...p); normals.push(...n); }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, indices };
}
/** The tank: a JSON glTF 2.0 of four nodes in one scene, its buffer inline as a data URI; its bytes and SHA-256. */
export function tankGltf(): { bytes: Buffer; sha: string } {
  const meshes = [
    boxMesh([-1.5, -0.5, -2.5], [1.5, 0.5, 2.5]),
    boxMesh([-0.75, -0.25, -0.75], [0.75, 0.25, 0.75]),
    boxMesh([-0.125, -0.125, 0], [0.125, 0.125, 2.5]),
  ];
  const chunks: Buffer[] = []; const views: JsonObject[] = []; const accessors: JsonObject[] = [];
  let length = 0;
  const view = (b: Buffer): number => { views.push({ buffer: 0, byteOffset: length, byteLength: b.length }); chunks.push(b); length += b.length; return views.length - 1; };
  const floats = (v: number[], extra: JsonObject = {}): number => {
    const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeFloatLE(x, i * 4));
    accessors.push({ bufferView: view(b), componentType: 5126, count: v.length / 3, type: 'VEC3', ...extra });
    return accessors.length - 1;
  };
  const uints = (v: number[]): number => {
    const b = Buffer.alloc(v.length * 4); v.forEach((x, i) => b.writeUInt32LE(x, i * 4));
    accessors.push({ bufferView: view(b), componentType: 5125, count: v.length, type: 'SCALAR' });
    return accessors.length - 1;
  };
  const gltfMeshes = meshes.map((m, k) => {
    const xs = [0, 1, 2].map((a) => m.positions.filter((_, i) => i % 3 === a));
    const POSITION = floats(m.positions, { min: xs.map((c) => Math.min(...c)), max: xs.map((c) => Math.max(...c)) });
    const NORMAL = floats(m.normals);
    return { primitives: [{ attributes: { POSITION, NORMAL }, indices: uints(m.indices), material: k, mode: 4 }] };
  });
  const bin = Buffer.concat(chunks);
  const color = (c: [number, number, number]): JsonObject => ({ pbrMetallicRoughness: { baseColorFactor: [...c, 1], metallicFactor: 0, roughnessFactor: 1 } });
  const doc = {
    asset: { version: '2.0', generator: 'deepbuild tests/acceptance/537' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'hull', mesh: 0, translation: HULL, children: [1] },
      { name: 'turret', mesh: 1, translation: TURRET, children: [2] },
      { name: 'barrel', mesh: 2, translation: BARREL, children: [3] },
      { name: 'tip', translation: TIP },
    ],
    meshes: gltfMeshes,
    materials: [{ name: 'hull', ...color([0.3, 0.36, 0.2]) }, { name: 'turret', ...color([0.42, 0.48, 0.3]) }, { name: 'barrel', ...color([0.15, 0.15, 0.15]) }],
    accessors, bufferViews: views,
    buffers: [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${bin.toString('base64')}` }],
  };
  const bytes = Buffer.from(JSON.stringify(doc));
  return { bytes, sha: sha256(bytes) };
}
export const TANK_SIZE: [number, number] = [480, 320];
export const BUDGET_SIZE: [number, number] = [1920, 1080];
function tankItems(program: Program, a: Army, gltf: string): Record<string, JsonObject> {
  return {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 160, 300], target: [0, 0, 0], fov: 50, near: 1, far: 1000 } },
    sky: { kind: 'sky@1', params: { top: [0.2, 0.3, 0.5, 1], low: [0.5, 0.55, 0.6, 1], ambient_top: [0.2, 0.2, 0.25], ambient_low: [0.1, 0.1, 0.1] } },
    sun: sun(3, [-50, 30, 0]),
    tank: { kind: 'mesh.asset@1', params: { sha256: gltf, node: { scene: 0 } }, visible: false },
    army: logicItem(program, armyWrites(a)),
    tanks: {
      kind: 'instance@1',
      params: {
        of: ['tank'], live: column('army.live', 'bool'), gen: column('army.gen', 'u32'), pos: column('army.pos', 'f32'), yaw: column('army.yaw', 'f32'),
        parts: { turret: { yaw: column('army.turret', 'f32') }, barrel: { pitch: column('army.barrel', 'f32') } },
      },
    },
  };
}
/** The 1,000 tanks as a session holds them. */
export const tanksSession = (program: Program, gltf: string): JsonObject => sessionDoc('tanks', TANK_SIZE, tankItems(program, ARMY, gltf));
/** The 2,000 units in the showpiece class at 1080p. */
export const hordeSession = (program: Program, gltf: string): JsonObject =>
  sessionDoc('horde', BUDGET_SIZE, tankItems(program, HORDE, gltf), { budget: { class: 'showpiece' } });

/** Degrees to radians. */
const rad = (d: number): number => (d * Math.PI) / 180;
/** Right-handed turns about +Y and +X (Units and axes: R = Rz·Ry·Rx, degrees). */
const ry = (d: number, [x, y, z]: V3): V3 => [x * Math.cos(rad(d)) + z * Math.sin(rad(d)), y, -x * Math.sin(rad(d)) + z * Math.cos(rad(d))];
const rx = (d: number, [x, y, z]: V3): V3 => [x, y * Math.cos(rad(d)) - z * Math.sin(rad(d)), y * Math.sin(rad(d)) + z * Math.cos(rad(d))];
const plus = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/**
 * The f64 reference: tank i's barrel tip after step k, each part's pose applied in its parent node's space. The element
 * stands at its `pos` turned by its `yaw` about +Y (Instance `instance@1`: world × TRS); the hull at its rest; the
 * turret at its rest translation on the hull, turned by its yaw about the hull's +Y; the barrel at its rest translation
 * on the turret, turned by its pitch about the turret's +X; the tip 2.5 m along the barrel's +Z.
 */
export function tipAt(a: Army, i: number, k: number): V3 {
  const t = tankAt(a, i, k);
  const inTurret = plus(BARREL, rx(t.barrel, TIP));
  const inHull = plus(TURRET, ry(t.turret, inTurret));
  return plus(t.pos, ry(t.yaw, plus(HULL, inHull)));
}
