// The #1700 suite's glTF fixtures, made here with node built-ins at test time, so nothing binary is committed: a
// GLB writer (a 12-byte header, a JSON chunk padded with spaces, a BIN chunk padded with zeros, as #453's suite
// writes one) and the two meshes the criteria need from a route the base has no builder for. A glTF stores f32
// positions, so every coordinate written here is exact in f32 (README: Fixtures). Nothing here stands in for
// geometry.shape.

export type V3 = [number, number, number];

/** One triangle-list primitive: positions, flat or radial normals, and indices. */
export interface Mesh { positions: V3[]; normals: V3[]; indices: number[] }

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
const exact = (v: number): boolean => Math.fround(v) === v;

/** A glTF 2.0 binary of one node (node 0) holding `mesh` as its one primitive. Throws on a position f32 can't hold. */
export function glb(mesh: Mesh): Buffer {
  for (const p of mesh.positions) if (!p.every(exact)) throw Error(`position ${JSON.stringify(p)} isn't exact in f32`);
  const chunks: Buffer[] = [];
  let length = 0;
  const views: object[] = [];
  const accessors: object[] = [];
  const view = (bytes: Buffer): number => {
    const pad = (4 - (length % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); length += pad; }
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
    chunks.push(bytes); length += bytes.length;
    return views.length - 1;
  };
  const floats = (rows: V3[], extra: object = {}): number => {
    const b = Buffer.alloc(rows.length * 12);
    rows.flat().forEach((v, i) => b.writeFloatLE(v, i * 4));
    accessors.push({ bufferView: view(b), componentType: 5126, count: rows.length, type: 'VEC3', ...extra });
    return accessors.length - 1;
  };
  const uints = (values: number[]): number => {
    const b = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => b.writeUInt32LE(v, i * 4));
    accessors.push({ bufferView: view(b), componentType: 5125, count: values.length, type: 'SCALAR' });
    return accessors.length - 1;
  };
  const min = [0, 1, 2].map((k) => Math.min(...mesh.positions.map((p) => p[k]!)));
  const max = [0, 1, 2].map((k) => Math.max(...mesh.positions.map((p) => p[k]!)));
  const POSITION = floats(mesh.positions, { min, max });
  const NORMAL = floats(mesh.normals);
  const indices = uints(mesh.indices);
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'deepbuild tests/acceptance/1700' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'mesh', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION, NORMAL }, indices, mode: 4 }] }],
    accessors,
    bufferViews: views,
  };
  const bin = Buffer.concat([...chunks, Buffer.alloc((4 - (length % 4)) % 4)]);
  json['buffers'] = [{ byteLength: bin.length }];
  let text = Buffer.from(JSON.stringify(json), 'utf8');
  text = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + text.length + 8 + bin.length, 8);
  const chunk = (body: Buffer, kind: number): Buffer => { const h = Buffer.alloc(8); h.writeUInt32LE(body.length, 0); h.writeUInt32LE(kind, 4); return Buffer.concat([h, body]); };
  return Buffer.concat([header, chunk(text, 0x4e4f534a), chunk(bin, 0x004e4942)]);
}

// ---------------------------------------------------------------------------------------------------
// The window as a boolean job leaves it: a slab with four square cuts, in decimetres

/** The grid the cut slab's faces lie on, in dm: its edges at ±5, its cuts' edges at ±1.5 and ±3.5. */
const GRID = [-5, -3.5, -1.5, 1.5, 3.5, 5];
/** The cells cut through: columns and rows 1 and 3 of the 5 × 5 grid, so four 2 dm squares centred at (±2.5, ±2.5) dm. */
const cut = (i: number, j: number): boolean => (i === 1 || i === 3) && (j === 1 || j === 3);

/**
 * A quad as two triangles, each corner its own vertex with the face's normal (flat, as a mesh whose sharp edges are
 * split is written): `corners` in order around the quad, wound so each triangle faces `n`.
 */
function quad(m: Mesh, corners: [V3, V3, V3, V3], n: V3): void {
  const c = dot(cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])), n) < 0 ? [...corners].reverse() : corners;
  const base = m.positions.length;
  for (const p of c) { m.positions.push(p); m.normals.push(n); }
  m.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/**
 * The window a slab with four boolean cuts makes, as a boolean job's mesh asset holds it, in decimetres: a
 * 10 × 10 × 1 dm slab (x and y from −5 to 5, z from 0 to 1) cut through along z by four 2 dm squares centred at
 * (±2.5, ±2.5) dm. Placed at scale 0.1 it is the issue's window, 1 × 1 × 0.1 m with four 0.2 m holes centred at
 * (±0.25, ±0.25) m, z from 0 to 0.1 m, the same surface as the extruded window. Its faces are the 21 uncut cells of
 * the 5 × 5 grid on each side, the four walls of each cut, and each outer side split at the grid's lines, so no
 * vertex lies on another face's edge: 78 quads, 156 triangles, 312 vertices that weld to 72; V − E + F =
 * 72 − 234 + 156 = −6, genus 4; volume 100 − 16 = 84 dm³, 0.084 m³ placed. Every coordinate is a multiple of 0.5,
 * exact in f32.
 */
export function cutWindow(): Mesh {
  const m: Mesh = { positions: [], normals: [], indices: [] };
  const g = GRID;
  for (let i = 0; i < 5; i++) {
    for (let j = 0; j < 5; j++) {
      const [x0, x1, y0, y1] = [g[i]!, g[i + 1]!, g[j]!, g[j + 1]!];
      if (cut(i, j)) {
        // The cut's four walls, each facing into the cut, away from the solid around it.
        quad(m, [[x0, y0, 0], [x0, y1, 0], [x0, y1, 1], [x0, y0, 1]], [1, 0, 0]);
        quad(m, [[x1, y0, 0], [x1, y1, 0], [x1, y1, 1], [x1, y0, 1]], [-1, 0, 0]);
        quad(m, [[x0, y0, 0], [x1, y0, 0], [x1, y0, 1], [x0, y0, 1]], [0, 1, 0]);
        quad(m, [[x0, y1, 0], [x1, y1, 0], [x1, y1, 1], [x0, y1, 1]], [0, -1, 0]);
        continue;
      }
      quad(m, [[x0, y0, 1], [x1, y0, 1], [x1, y1, 1], [x0, y1, 1]], [0, 0, 1]);
      quad(m, [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]], [0, 0, -1]);
    }
  }
  // The outer sides, each split at the grid's lines.
  for (let k = 0; k < 5; k++) {
    const [a, b] = [g[k]!, g[k + 1]!];
    quad(m, [[-5, a, 0], [-5, b, 0], [-5, b, 1], [-5, a, 1]], [-1, 0, 0]);
    quad(m, [[5, a, 0], [5, b, 0], [5, b, 1], [5, a, 1]], [1, 0, 0]);
    quad(m, [[a, -5, 0], [b, -5, 0], [b, -5, 1], [a, -5, 1]], [0, -1, 0]);
    quad(m, [[a, 5, 0], [b, 5, 0], [b, 5, 1], [a, 5, 1]], [0, 1, 0]);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------------
// The 2 × 1 × 0.5 m box, closed or with one face's winding flipped

/** The box's half sizes, in m: x ±1, y ±0.5, z ±0.25, centred on the origin. */
export const BOX_HALF: V3 = [1, 0.5, 0.25];
/** Its eight corners: corner k has bit 0 for +x, bit 1 for +y, bit 2 for +z. */
export const BOX_CORNERS: V3[] = Array.from({ length: 8 }, (_, k) => [
  (k & 1 ? 1 : -1) * BOX_HALF[0], (k & 2 ? 1 : -1) * BOX_HALF[1], (k & 4 ? 1 : -1) * BOX_HALF[2],
]);
/** Its twelve triangles over the corners, two per face, wound counter-clockwise seen from outside: −Z, +Z, −Y, +Y, −X, +X. */
const BOX_TRIS: [number, number, number][] = [
  [0, 2, 3], [0, 3, 1], [4, 5, 7], [4, 7, 6], [0, 1, 5], [0, 5, 4], [2, 6, 7], [2, 7, 3], [0, 4, 6], [0, 6, 2], [1, 3, 7], [1, 7, 5],
];
/** The +Z face's two triangles, by index in the primitive's own order: the face the flipped box winds backwards. */
export const FLIPPED_FACE: readonly number[] = [2, 3];
/** The +Z face's height: both points of any edge of the flipped face lie at z = 0.25 m. */
export const FLIPPED_Z = BOX_HALF[2];

/**
 * The box as an indexed mesh of its 8 shared corners, normals along each corner's diagonal (outward), 12 triangles.
 * With `flipped`, the +Z face's two triangles (FLIPPED_FACE) are wound backwards, their normals still out: every
 * edge is still held by two triangles, but the four edges around that face are held twice in one direction. Every
 * coordinate is ±1, ±0.5 or ±0.25, exact in f32; closed, its volume is 2 × 1 × 0.5 = 1 m³.
 */
export function box(flipped: boolean): Mesh {
  const tris = BOX_TRIS.map((t, i) => (flipped && FLIPPED_FACE.includes(i) ? [t[0], t[2], t[1]] : t));
  return {
    positions: BOX_CORNERS.map((p) => [...p] as V3),
    normals: BOX_CORNERS.map(unit),
    indices: tris.flat(),
  };
}
