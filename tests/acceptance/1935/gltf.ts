// The #1935 suite's glTF fixtures, written here with node built-ins at test time, so nothing binary is committed:
// a GLB writer that writes TEXCOORD_0 and TEXCOORD_1, and the meshes the three criteria name, each with exact areas
// by construction (README: Fixtures). Every UV corner is a whole number of pixels of a 1,024 px square and every
// position a short binary fraction, so the f32 file holds the numbers the README works with. Nothing here stands in
// for geometry.shading.

export type V2 = [number, number];
export type V3 = [number, number, number];

/** One triangle primitive as this suite writes it. */
export interface Prim {
  positions: V3[];
  normals?: V3[];
  /** TEXCOORD_0. */
  uv0?: V2[];
  /** TEXCOORD_1. */
  uv1?: V2[];
  indices: number[];
}

const f32 = (v: V3): V3 => [Math.fround(v[0]), Math.fround(v[1]), Math.fround(v[2])];

// ---------------------------------------------------------------------------------------------------
// The GLB writer (glTF 2.0: a 12-byte header, a JSON chunk padded with spaces, a BIN chunk padded with zeros):
// one node (node 0) whose mesh has one primitive.

export function glb(p: Prim): Buffer {
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
  const floats = (rows: number[][], type: string, extra: object = {}): number => {
    const b = Buffer.alloc(rows.length * rows[0]!.length * 4);
    rows.flat().forEach((v, i) => b.writeFloatLE(v, i * 4));
    accessors.push({ bufferView: view(b), componentType: 5126, count: rows.length, type, ...extra });
    return accessors.length - 1;
  };
  const positions = p.positions.map(f32);
  const bounds = {
    min: [0, 1, 2].map((k) => Math.min(...positions.map((v) => v[k]!))),
    max: [0, 1, 2].map((k) => Math.max(...positions.map((v) => v[k]!))),
  };
  const attributes: Record<string, number> = { POSITION: floats(positions, 'VEC3', bounds) };
  if (p.normals) attributes['NORMAL'] = floats(p.normals, 'VEC3');
  if (p.uv0) attributes['TEXCOORD_0'] = floats(p.uv0, 'VEC2');
  if (p.uv1) attributes['TEXCOORD_1'] = floats(p.uv1, 'VEC2');
  const ib = Buffer.alloc(p.indices.length * 4);
  p.indices.forEach((v, i) => ib.writeUInt32LE(v, i * 4));
  accessors.push({ bufferView: view(ib), componentType: 5125, count: p.indices.length, type: 'SCALAR' });
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'deepbuild tests/acceptance/1935' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'mesh', mesh: 0 }],
    meshes: [{ primitives: [{ attributes, indices: accessors.length - 1, mode: 4 }] }],
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
  const chunk = (body: Buffer, kind: number) => { const h = Buffer.alloc(8); h.writeUInt32LE(body.length, 0); h.writeUInt32LE(kind, 4); return Buffer.concat([h, body]); };
  return Buffer.concat([header, chunk(text, 0x4e4f534a), chunk(bin, 0x004e4942)]);
}

// ---------------------------------------------------------------------------------------------------
// IDs (README: Names)

/** A face: `<primitive>:<triangle>`, the triangle's index in its primitive in file order (#453's FaceID). */
export const faceId = (prim: number, tri: number): string => `${prim}:${tri}`;

// ---------------------------------------------------------------------------------------------------
// Charts: flat sheets in z = 0, each one UV chart in both sets

/** The square the UV pixels are counted on: the check input's `resolution`. */
export const RESOLUTION = 1024;

/** A rectangle [x0, y0, x1, y1] in a sheet's own metres. */
export type Rect = [number, number, number, number];
/** Where a sheet's own origin lands in one UV set, in pixels of the 1,024 px square, and its texel density (px/m). */
export interface Place { at: V2; density: number }
/**
 * One chart: a flat sheet facing +z, the union of `rects`, which meet only along whole edges; at `at` (m) in 3D;
 * its uv1 and uv0 its own metres times the density, from where it lands. So each set maps the sheet without
 * stretch, at one density per chart.
 */
export interface Sheet { rects: Rect[]; at: V2; uv1: Place; uv0: Place }

/** One mesh of sheets, all in primitive 0, with each sheet's chart ID: its first triangle's face ID (README: Names). */
export function sheets(list: Sheet[]): { prim: Prim; charts: string[] } {
  const positions: V3[] = []; const normals: V3[] = []; const uv0: V2[] = []; const uv1: V2[] = []; const indices: number[] = [];
  const charts: string[] = [];
  const uv = (p: Place, x: number, y: number): V2 => [(p.at[0] + x * p.density) / RESOLUTION, (p.at[1] + y * p.density) / RESOLUTION];
  for (const s of list) {
    charts.push(faceId(0, indices.length / 3));
    const own = new Map<string, number>();
    const vertex = (x: number, y: number): number => {
      const key = `${x},${y}`;
      let i = own.get(key);
      if (i === undefined) {
        i = positions.length; own.set(key, i);
        positions.push([s.at[0] + x, s.at[1] + y, 0]); normals.push([0, 0, 1]);
        uv1.push(uv(s.uv1, x, y)); uv0.push(uv(s.uv0, x, y));
      }
      return i;
    };
    for (const [x0, y0, x1, y1] of s.rects) {
      const a = vertex(x0, y0), b = vertex(x1, y0), c = vertex(x1, y1), d = vertex(x0, y1);
      indices.push(a, b, c, a, c, d); // counter-clockwise seen from +z, in 3D and in both UV sets
    }
  }
  return { prim: { positions, normals, uv0, uv1, indices }, charts };
}

/** `px` pixels of uv1 at 512 px/m, in metres. */
const m = (px: number): number => px / 512;
/** A rectangle given in pixels at 512 px/m. */
const rect = (x0: number, y0: number, x1: number, y1: number): Rect => [m(x0), m(y0), m(x1), m(y1)];

// ---- Criterion 1: overlap

/**
 * Two 520 × 800 px charts at 512 px/m (1.015625 × 1.5625 m sheets), uv1 at x = 112 and x = 392: they share a
 * 240 px wide strip, so the covered area is 800 × 800 px and the overlap 240 × 800 px, a share of 0.3. In uv0 they
 * sit 124 px apart at 256 px/m.
 */
export function overlapPair(): { prim: Prim; charts: string[] } {
  const r = [rect(0, 0, 520, 800)];
  return sheets([
    { rects: r, at: [0, 0], uv1: { at: [112, 112], density: 512 }, uv0: { at: [64, 64], density: 256 } },
    { rects: r, at: [3, 0], uv1: { at: [392, 112], density: 512 }, uv0: { at: [448, 64], density: 256 } },
  ]);
}

/**
 * Two interlocking L charts that don't touch, at 512 px/m. L1's corner is at the lower left, [64, 448]², with arms
 * to 960 px along both axes; L2's corner is at the upper right, [704, 960]², with arms back to 480 px, so L2 lies in
 * L1's notch, 32 px from it everywhere. L1's bounding box [64, 960]² holds L2's [480, 960]², so a reading from
 * bounding boxes finds 480² px² of overlap where there is none. In uv0 the two sit apart at 256 px/m.
 */
export function lPair(): { prim: Prim; charts: string[] } {
  const l1 = [rect(0, 0, 384, 384), rect(384, 0, 896, 384), rect(0, 384, 384, 896)];
  const l2 = [rect(224, 224, 480, 480), rect(0, 224, 224, 480), rect(224, 0, 480, 224)];
  return sheets([
    { rects: l1, at: [0, 0], uv1: { at: [64, 64], density: 512 }, uv0: { at: [32, 32], density: 256 } },
    { rects: l2, at: [3, 0], uv1: { at: [480, 480], density: 512 }, uv0: { at: [720, 720], density: 256 } },
  ]);
}

// ---- Criterion 2: texel density, fill and gaps

/** The texel band criterion 2 names, and the density its in-band charts are laid at (its middle) and half of it. */
export const TEXEL_BAND: V2 = [480, 560];
export const IN_BAND = 520;
export const HALF = IN_BAND / 2;
/** The sheet (0-based) whose uv1 is at half the others' density. */
export const HALF_SHEET = 2;

/**
 * Four 0.5 m square sheets, each a quarter of the mesh's area, in uv1 at 520 px/m (260 px squares) but sheet 2 at
 * 260 px/m (130 px), one per quadrant at (64, 64), (576, 64), (64, 576), (576, 576) px. uv0 is the same layout with
 * all four at 520 px/m.
 */
export function texelQuad(): { prim: Prim; charts: string[] } {
  const corners: V2[] = [[64, 64], [576, 64], [64, 576], [576, 576]];
  return sheets(corners.map((c, k): Sheet => ({
    rects: [[0, 0, 0.5, 0.5]], at: [k, 0],
    uv1: { at: c, density: k === HALF_SHEET ? HALF : IN_BAND }, uv0: { at: c, density: IN_BAND },
  })));
}

/** One 1 m square sheet whose uv1 is the lower-left quarter, [0, 512]² px at 512 px/m; uv0 [64, 960]² at 896 px/m. */
export function lowerLeftQuarter(): { prim: Prim; charts: string[] } {
  return sheets([{ rects: [[0, 0, 1, 1]], at: [0, 0], uv1: { at: [0, 0], density: 512 }, uv0: { at: [64, 64], density: 896 } }]);
}

/**
 * Two 440 × 896 px charts at 512 px/m (0.859375 × 1.75 m sheets), side by side in uv1 `gap` px apart, the pair
 * centred: the left from x = (144 − gap) / 2. In uv0 they are 80 px apart.
 */
export function gapPair(gap: number): { prim: Prim; charts: string[] } {
  const r = [rect(0, 0, 440, 896)];
  const left = (144 - gap) / 2;
  return sheets([
    { rects: r, at: [0, 0], uv1: { at: [left, 64], density: 512 }, uv0: { at: [32, 64], density: 512 } },
    { rects: r, at: [2, 0], uv1: { at: [left + 440 + gap, 64], density: 512 }, uv0: { at: [552, 64], density: 512 } },
  ]);
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: closed boxes, a cup, stray vertices and a floating triangle (no normals, no UV sets)

/** The unit cube's eight corners and its twelve triangles, counter-clockwise seen from outside (#453's order). */
const CORNERS: V3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const CUBE_TRIS: [number, number, number][] = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
];

/** A closed cube of side `side` from `origin`: 8 vertices from `base`, 12 triangles wound outward. */
function cube(origin: V3, side: number, base: number): { positions: V3[]; indices: number[] } {
  return {
    positions: CORNERS.map((c) => [origin[0] + c[0] * side, origin[1] + c[1] * side, origin[2] + c[2] * side]),
    indices: CUBE_TRIS.flat().map((i) => i + base),
  };
}

/** A closed 2 m box about the origin (triangles 0–11) with a closed 1 m box about the origin inside it (triangles 12–23). */
export function boxInBox(): { prim: Prim; inner: string[] } {
  const outer = cube([-1, -1, -1], 2, 0), inner = cube([-0.5, -0.5, -0.5], 1, 8);
  return {
    prim: { positions: [...outer.positions, ...inner.positions], indices: [...outer.indices, ...inner.indices] },
    inner: Array.from({ length: 12 }, (_, t) => faceId(0, 12 + t)),
  };
}

/** The cup's outer half-width and height, its cavity's half-width and its floor's top (m). */
const CUP = { outer: 1.25, height: 0.5, inner: 1, floor: 0.25 } as const;

/**
 * A square cup open to +Y (glTF's up): outside 2.5 × 0.5 × 2.5 m, a cavity 2 m wide and 0.25 m deep, walls and floor
 * 0.25 m thick, so the cavity is eight times as wide as it is deep and every inner face sees the sky across most of
 * its upper half. One closed surface of 16 vertices and 28 triangles: the outer bottom and four outer walls, the
 * rim's four strips, the four inner walls and the inner floor (triangles 18–27), each quad wound to face out of the
 * solid.
 */
export function cup(): Prim {
  const { outer: a, height: h, inner: b, floor: f } = CUP;
  const square = (r: number, y: number): V3[] => [[-r, y, -r], [r, y, -r], [r, y, r], [-r, y, r]];
  const positions: V3[] = [...square(a, 0), ...square(a, h), ...square(b, h), ...square(b, f)];
  // Each quad in order around its edge, with the way it faces.
  const quads: { q: [number, number, number, number]; n: V3 }[] = [
    { q: [0, 1, 2, 3], n: [0, -1, 0] },
    { q: [0, 1, 5, 4], n: [0, 0, -1] }, { q: [1, 2, 6, 5], n: [1, 0, 0] }, { q: [2, 3, 7, 6], n: [0, 0, 1] }, { q: [3, 0, 4, 7], n: [-1, 0, 0] },
    { q: [4, 5, 9, 8], n: [0, 1, 0] }, { q: [5, 6, 10, 9], n: [0, 1, 0] }, { q: [6, 7, 11, 10], n: [0, 1, 0] }, { q: [7, 4, 8, 11], n: [0, 1, 0] },
    { q: [8, 9, 13, 12], n: [0, 0, 1] }, { q: [9, 10, 14, 13], n: [-1, 0, 0] }, { q: [10, 11, 15, 14], n: [0, 0, -1] }, { q: [11, 8, 12, 15], n: [1, 0, 0] },
    { q: [12, 13, 14, 15], n: [0, 1, 0] },
  ];
  const indices: number[] = [];
  for (const { q, n } of quads) {
    const [p0, p1, p2] = [positions[q[0]]!, positions[q[1]]!, positions[q[2]]!];
    const u: V3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], v: V3 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const c: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const along = c[0] * n[0] + c[1] * n[1] + c[2] * n[2] > 0;
    indices.push(...(along ? [q[0], q[1], q[2], q[0], q[2], q[3]] : [q[0], q[2], q[1], q[0], q[3], q[2]]));
  }
  return { positions, indices };
}

/** The floating triangle's base and height (m): area 0.002 × 0.001 ÷ 2 = 1 mm². */
export const FLOAT_BASE = 0.002;
export const FLOAT_HEIGHT = 0.001;
export const STRAYS = 10;

/**
 * The unit cube from the origin (vertices 0–7, triangles 0–11), then, with `dirty`, 10 vertices no triangle uses
 * (8–17, at x = −2, 0.1 m apart along z) and a 1 mm² triangle 2 m above the cube that touches nothing (vertices
 * 18–20, triangle 12). Without `dirty`, the cube alone: its clean twin.
 */
export function strayCube(dirty: boolean): Prim {
  const c = cube([0, 0, 0], 1, 0);
  if (!dirty) return { positions: c.positions, indices: c.indices };
  const strays: V3[] = Array.from({ length: STRAYS }, (_, k) => [-2, 0, 0.1 * k]);
  const tri: V3[] = [[0, 3, 0], [FLOAT_BASE, 3, 0], [FLOAT_BASE / 2, 3 + FLOAT_HEIGHT, 0]];
  const t0 = c.positions.length + STRAYS;
  return { positions: [...c.positions, ...strays, ...tri], indices: [...c.indices, t0, t0 + 1, t0 + 2] };
}
