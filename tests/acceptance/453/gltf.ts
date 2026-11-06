// The #453 suite's glTF fixtures, made here with node built-ins at test time, so nothing binary is committed:
// a GLB writer and the meshes the criteria name, each with what the criterion and its geometry say it must
// report (README: Fixtures). Every position is rounded to f32 first, since a glTF stores f32, so what these
// functions say about a fixture is what the file holds. Nothing here stands in for geometry.shading.

export type V3 = [number, number, number];
export type Quat = [number, number, number, number];

/** One glTF primitive as this suite writes it. */
export interface Prim {
  positions: V3[];
  normals?: V3[];
  uvs?: [number, number][];
  indices?: number[];
  /** glTF's primitive mode; 4 (triangles) when absent. */
  mode?: number;
  /** Written as KHR_draco_mesh_compression data that no decoder can read (README: Readings). */
  draco?: boolean;
}

/** A file's one mesh node (node 0) and, with `skin`, a skin of one joint (node 1). */
export interface Spec {
  prims: Prim[];
  /** The joint's rotation in the file; its inverse bind matrix is the identity, so `[0, 0, 0, 1]` is the bind pose. */
  skin?: { joint: Quat };
}

export const f32 = (v: V3): V3 => [Math.fround(v[0]), Math.fround(v[1]), Math.fround(v[2])];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => { const l = len(a); return l === 0 ? [0, 0, 0] : scale(a, 1 / l); };

// ---------------------------------------------------------------------------------------------------
// The GLB writer (glTF 2.0, §4.4: a 12-byte header, a JSON chunk padded with spaces, a BIN chunk padded with zeros)

const KHR_DRACO = 'KHR_draco_mesh_compression';

export function glb(spec: Spec): Buffer {
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
  const uints = (values: number[]): number => {
    const b = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => b.writeUInt32LE(v, i * 4));
    accessors.push({ bufferView: view(b), componentType: 5125, count: values.length, type: 'SCALAR' });
    return accessors.length - 1;
  };
  const bytes4 = (rows: number[][]): number => {
    const b = Buffer.from(rows.flat());
    accessors.push({ bufferView: view(b), componentType: 5121, count: rows.length, type: 'VEC4' });
    return accessors.length - 1;
  };
  const bounds = (ps: V3[]) => ({
    min: [0, 1, 2].map((k) => Math.min(...ps.map((p) => Math.fround(p[k]!)))),
    max: [0, 1, 2].map((k) => Math.max(...ps.map((p) => Math.fround(p[k]!)))),
  });
  const primitives = spec.prims.map((p) => {
    if (p.draco) {
      // Accessors with no bufferView, as the extension writes them, and a cut Draco stream: the magic and
      // four header bytes, then seven zero bytes: nothing a decoder can read.
      accessors.push({ componentType: 5126, count: p.positions.length, type: 'VEC3', ...bounds(p.positions) });
      const pos = accessors.length - 1;
      accessors.push({ componentType: 5125, count: (p.indices ?? []).length, type: 'SCALAR' });
      const ind = accessors.length - 1;
      const stream = view(Buffer.concat([Buffer.from('DRACO', 'ascii'), Buffer.from([2, 2, 1, 1]), Buffer.alloc(7)]));
      return { attributes: { POSITION: pos }, indices: ind, mode: 4, extensions: { [KHR_DRACO]: { bufferView: stream, attributes: { POSITION: 0 } } } };
    }
    const attributes: Record<string, number> = { POSITION: floats(p.positions, 'VEC3', bounds(p.positions)) };
    if (p.normals) attributes['NORMAL'] = floats(p.normals.map(unit), 'VEC3');
    if (p.uvs) attributes['TEXCOORD_0'] = floats(p.uvs, 'VEC2');
    if (spec.skin) {
      attributes['JOINTS_0'] = bytes4(p.positions.map(() => [0, 0, 0, 0]));
      attributes['WEIGHTS_0'] = floats(p.positions.map(() => [1, 0, 0, 0]), 'VEC4');
    }
    return { attributes, ...(p.indices ? { indices: uints(p.indices) } : {}), ...(p.mode !== undefined ? { mode: p.mode } : {}) };
  });
  const json: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'deepbuild tests/acceptance/453' },
    scene: 0,
    scenes: [{ nodes: spec.skin ? [0, 1] : [0] }],
    nodes: [{ name: 'mesh', mesh: 0, ...(spec.skin ? { skin: 0 } : {}) }, ...(spec.skin ? [{ name: 'joint', rotation: spec.skin.joint }] : [])],
    meshes: [{ primitives }],
  };
  if (spec.skin) {
    json['skins'] = [{ joints: [1], inverseBindMatrices: floats([[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]], 'MAT4') }];
  }
  if (spec.prims.some((p) => p.draco)) { json['extensionsUsed'] = [KHR_DRACO]; json['extensionsRequired'] = [KHR_DRACO]; }
  json['accessors'] = accessors;
  json['bufferViews'] = views;
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
// IDs (README: Face, vertex and edge IDs)

/** A face: `<primitive>:<triangle>`, the triangle's index in its primitive in file order. */
export const faceId = (prim: number, tri: number): string => `${prim}:${tri}`;
/** A welded vertex: `<primitive>:<vertex>`, its first member in (primitive, vertex index) order. */
export const vertexId = (prim: number, vertex: number): string => `${prim}:${vertex}`;
/** An edge: its two welded vertices' IDs, the earlier in (primitive, vertex index) order first. */
export function edgeId(a: [number, number], b: [number, number]): string {
  const [x, y] = a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]) ? [a, b] : [b, a];
  return `${vertexId(...x)}/${vertexId(...y)}`;
}

// ---------------------------------------------------------------------------------------------------
// Meshes

/** The unit cube's eight corners, in this order (scaled by `side` from `origin` where a fixture places one): */
// 0 (0,0,0)  1 (1,0,0)  2 (1,1,0)  3 (0,1,0)  4 (0,0,1)  5 (1,0,1)  6 (1,1,1)  7 (0,1,1)
const CORNERS: V3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
/** The cube's twelve triangles, wound counter-clockwise seen from outside, two per face: −Z, +Z, −Y, +Y, −X, +X. */
export const CUBE_TRIS: [number, number, number][] = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5],
];
/** The cube's faces as quads (corner indices counter-clockwise from outside) with their outward normals, in CUBE_TRIS's order. */
const CUBE_QUADS: { q: [number, number, number, number]; n: V3 }[] = [
  { q: [0, 3, 2, 1], n: [0, 0, -1] }, { q: [4, 5, 6, 7], n: [0, 0, 1] }, { q: [0, 1, 5, 4], n: [0, -1, 0] },
  { q: [3, 7, 6, 2], n: [0, 1, 0] }, { q: [0, 4, 7, 3], n: [-1, 0, 0] }, { q: [1, 2, 6, 5], n: [1, 0, 0] },
];

const corner = (k: number, origin: V3, side: number): V3 => f32(add(origin, scale(CORNERS[k]!, side)));
const radial = (k: number): V3 => unit(sub(CORNERS[k]!, [0.5, 0.5, 0.5]));

/**
 * An indexed cube of 8 shared corners, normals along each corner's diagonal (outward), triangles as CUBE_TRIS:
 * `reversed` lists triangles wound backwards (their normals still out), `inward` winds every triangle backwards
 * and turns every normal in, `drop` leaves one triangle out.
 */
export function indexedCube(origin: V3 = [0, 0, 0], side = 1, o: { reversed?: number[]; inward?: boolean; drop?: number } = {}): Prim {
  const tris = CUBE_TRIS.map((t, i) => (o.inward || o.reversed?.includes(i) ? [t[0], t[2], t[1]] : t)).filter((_, i) => i !== o.drop);
  return {
    positions: CORNERS.map((_, k) => corner(k, origin, side)),
    normals: CORNERS.map((_, k) => scale(radial(k), o.inward ? -1 : 1)),
    indices: tris.flat(),
  };
}

/** The cube with a fin: a ninth vertex (0.5, −1, 0) and the triangle (0, 1, 8), a third face on the edge 0–1. */
export function finCube(): Prim {
  const c = indexedCube();
  return { positions: [...c.positions, f32([0.5, -1, 0])], normals: [...c.normals!, [0, 0, -1]], indices: [...c.indices!, 0, 1, 8] };
}

/** Two unit cubes in one primitive (vertices 0–7 and 8–15): the second from (1, 1, 1), touching the first only at its corner 6, or from (2, 2, 2), apart. */
export function twoCubes(touching: boolean): Prim {
  const a = indexedCube(), b = indexedCube(touching ? [1, 1, 1] : [2, 2, 2]);
  return { positions: [...a.positions, ...b.positions], normals: [...a.normals!, ...b.normals!], indices: [...a.indices!, ...b.indices!.map((i) => i + 8)] };
}

/** Each corner's three seam copies are moved apart by at most this much (2 µm): well within the 10 µm weld. */
export const SEAM_JITTER = 2e-6;

/**
 * The glTF cube split at its UV seams: 24 vertices (four per face, each with the face's normal and its own UV
 * square), 36 indices, side 1 about the origin. A corner's copy on its second and third face is moved by
 * SEAM_JITTER along x and y, so only a weld within 0.00001 m, not exact equality, joins them. `backwards` lists
 * the triangles (indices into its 12) wound backwards while their normals still point out.
 */
export function seamCube(backwards: number[] = []): Prim {
  const positions: V3[] = []; const normals: V3[] = []; const uvs: [number, number][] = []; const indices: number[] = [];
  const seen = new Map<number, number>();
  const SQUARE: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
  CUBE_QUADS.forEach(({ q, n }, f) => {
    const base = positions.length;
    q.forEach((k, i) => {
      const copy = seen.get(k) ?? 0; seen.set(k, copy + 1);
      const jitter: V3 = copy === 1 ? [SEAM_JITTER, 0, 0] : copy === 2 ? [0, SEAM_JITTER, 0] : [0, 0, 0];
      positions.push(f32(add(corner(k, [-0.5, -0.5, -0.5], 1), jitter))); normals.push(n); uvs.push(SQUARE[i]!);
    });
    const tris: [number, number, number][] = [[base, base + 1, base + 2], [base, base + 2, base + 3]];
    tris.forEach((t, j) => indices.push(...(backwards.includes(2 * f + j) ? [t[0], t[2], t[1]] : t)));
  });
  return { positions, normals, uvs, indices };
}

/** A triangle soup: each triangle its own three vertices with its own flat normal (from its own winding unless given). */
export function soup(tris: [V3, V3, V3][], normals?: V3[]): Prim {
  const positions: V3[] = []; const ns: V3[] = [];
  tris.forEach((t, i) => {
    const n = normals?.[i] ?? unit(cross(sub(t[1], t[0]), sub(t[2], t[0])));
    for (const p of t) { positions.push(f32(p)); ns.push(n); }
  });
  return { positions, normals: ns, indices: positions.map((_, i) => i) };
}

/** The cube's twelve triangles as a soup (36 vertices, flat normals), `reversed` wound and facing backwards. */
export function soupCube(reversed: number[] = []): Prim {
  const tris = CUBE_TRIS.map((t, i): [V3, V3, V3] => {
    const [a, b, c] = t.map((k) => corner(k, [0, 0, 0], 1)) as [V3, V3, V3];
    return reversed.includes(i) ? [a, c, b] : [a, b, c];
  });
  return soup(tris);
}

/** Side of the box the sliver fixture is cut from (m): large, so 1e-14 of its diagonal squared is far above 1e-12 m². */
export const SLIVER_BOX = 100;

/**
 * A closed box of side SLIVER_BOX from the origin whose −Z face has a sliver along its edge A (0,0,0) → B (side,0,0):
 * M sits inside the face at (side/2, h, 0), the face's triangle on AB is split at M, and the sliver (B, A, M)
 * closes the gap. Its area is side × h ÷ 2; `ratio` is that area over the box's bounds diagonal squared
 * (3 side²), so h = 6 side × ratio. 14 triangles, a soup with flat normals; the sliver is triangle 13.
 */
export function sliverBox(ratio: number): { prim: Prim; sliver: number; area: number; diagonal2: number } {
  const s = SLIVER_BOX;
  const h = Math.fround(6 * s * ratio);
  const c = (k: number) => corner(k, [0, 0, 0], s);
  const A = c(0), B = c(1), C = c(2), D = c(3);
  const M = f32([s / 2, h, 0]);
  const rest = CUBE_TRIS.slice(2).map((t) => t.map(c) as [V3, V3, V3]);
  // −Z was (A, C, B), (A, D, C): (A, C, B) splits at M on AB.
  const tris: [V3, V3, V3][] = [[A, C, M], [M, C, B], [A, D, C], ...rest, [B, A, M]];
  const area = len(cross(sub(A, B), sub(M, B))) / 2;
  return { prim: soup(tris), sliver: tris.length - 1, area, diagonal2: 3 * s * s };
}

/** The ring of a torus: `major` × `minor` quads, each split into two triangles, from a (major + 1) × (minor + 1) grid whose seam rows repeat (as a UV-mapped torus is written), radii R = 1, r = 0.4, wound outward. */
export function torus(major = 48, minor = 24): Prim {
  const R = 1, r = 0.4;
  const positions: V3[] = []; const normals: V3[] = []; const uvs: [number, number][] = []; const indices: number[] = [];
  for (let i = 0; i <= major; i++) {
    for (let j = 0; j <= minor; j++) {
      const u = (2 * Math.PI * (i % major)) / major, v = (2 * Math.PI * (j % minor)) / minor;
      const n: V3 = [Math.cos(v) * Math.cos(u), Math.sin(v), Math.cos(v) * Math.sin(u)];
      positions.push(f32([(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)]));
      normals.push(n); uvs.push([i / major, j / minor]);
    }
  }
  const at = (i: number, j: number) => i * (minor + 1) + j;
  for (let i = 0; i < major; i++) {
    for (let j = 0; j < minor; j++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      indices.push(a, d, c, a, c, b);
    }
  }
  return { positions, normals, uvs, indices };
}

/** An icosphere of radius 1: the icosahedron's 20 faces split in four `levels` times, each new point pushed out to the sphere (3 levels: 1,280 triangles, 642 vertices). */
export function icosphere(levels = 3): Prim {
  const t = (1 + Math.sqrt(5)) / 2;
  let ps: V3[] = ([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]] as V3[]).map(unit);
  let tris: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  for (let l = 0; l < levels; l++) {
    const mid = new Map<string, number>();
    const m = (a: number, b: number): number => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      let k = mid.get(key);
      if (k === undefined) { k = ps.length; ps = [...ps, unit(add(ps[a]!, ps[b]!))]; mid.set(key, k); }
      return k;
    };
    tris = tris.flatMap(([a, b, c]): [number, number, number][] => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]; });
  }
  return { positions: ps.map(f32), normals: ps, indices: tris.flat() };
}

/** The cube's twelve edges as a line-mode primitive (mode 1) over its eight corners. */
export function cubeLines(): Prim {
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  return { positions: CORNERS.map((_, k) => corner(k, [2, 0, 0], 1)), indices: edges.flat(), mode: 1 };
}

/** The cube again, as Draco data no decoder can read. */
export function dracoCube(): Prim {
  return { ...indexedCube([2, 0, 0]), draco: true };
}

/** A 90° turn about y: the joint away from its bind pose. */
export const TURNED: Quat = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
export const BIND: Quat = [0, 0, 0, 1];

// ---------------------------------------------------------------------------------------------------
// AC3's planted fixtures, one per defect kind, each with the IDs it holds and its clean twin

export type DefectKind = 'non_manifold_edges' | 'non_manifold_vertices' | 'inconsistent_edges' | 'flipped_faces' | 'degenerate_faces' | 'boundary_edges';
export interface DefectFixture { kind: DefectKind; what: string; planted: Prim; ids: string[]; clean: Prim }

const SLIVER_14 = sliverBox(1e-14);
export const DEFECT_FIXTURES: DefectFixture[] = [
  { kind: 'boundary_edges', what: 'the cube with its +Z triangle (4, 5, 6) left out', planted: indexedCube([0, 0, 0], 1, { drop: 2 }),
    ids: [edgeId([0, 4], [0, 5]), edgeId([0, 5], [0, 6]), edgeId([0, 4], [0, 6])], clean: indexedCube() },
  { kind: 'non_manifold_edges', what: 'the cube with a fin on its edge 0–1', planted: finCube(), ids: [edgeId([0, 0], [0, 1])], clean: indexedCube() },
  { kind: 'non_manifold_vertices', what: 'two cubes touching at one corner', planted: twoCubes(true), ids: [vertexId(0, 6)], clean: twoCubes(false) },
  // Triangle 4 is the corners 0, 1, 5; in the soup their first copies are vertices 0, 2 (triangle 0's third corner) and 7 (triangle 2's second).
  { kind: 'inconsistent_edges', what: 'the soup cube with triangle 4 wound and facing backwards', planted: soupCube([4]),
    ids: [edgeId([0, 0], [0, 2]), edgeId([0, 0], [0, 7]), edgeId([0, 2], [0, 7])], clean: soupCube() },
  { kind: 'flipped_faces', what: 'the cube with triangle 10 wound backwards, its normals out', planted: indexedCube([0, 0, 0], 1, { reversed: [10] }), ids: [faceId(0, 10)], clean: indexedCube() },
  { kind: 'degenerate_faces', what: 'the sliver box at 1e-14', planted: SLIVER_14.prim, ids: [faceId(0, SLIVER_14.sliver)], clean: sliverBox(1e-10).prim },
];
