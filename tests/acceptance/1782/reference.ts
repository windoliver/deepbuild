// The CPU references the #1782 acceptance tests hold the product to, and the issue's numbers with the sentence each
// comes from: the ranking of a line's picked edges by welded ends (README: An edge's ID and start), the generated
// meshes (the 2 × 2 plane as glTF primitives, the fold whose ridge is "a 1 m edge", the flat blocker), and where a
// dash inks an edge. Vector math, welding and the one-primitive glTF are #1640's, imported. Nothing here reads the
// product's code or output.

import { createHash } from 'node:crypto';
import { WELD, gltf, length, sub, type TriMesh, type V3 } from '../1640/reference.ts';

export interface Asset { bytes: Buffer; sha: string }

// ---------------------------------------------------------------------------------------------------
// Edge IDs: the rank in the set ordered by welded ends

export interface Edge { id: number; start: V3; end: V3; length: number }
const welded = (p: V3): V3 => [Math.round(p[0] / WELD), Math.round(p[1] / WELD), Math.round(p[2] / WELD)];
/** x, then y, then z. */
const order = (a: V3, b: V3): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
/**
 * A line's picked edges by ID. An edge's start is the lesser of its two welded ends, comparing x, then y, then z;
 * edges are ordered by start, then by end; an edge's ID is its 0-based rank in that order.
 */
export function rank(segments: readonly (readonly [V3, V3])[]): Edge[] {
  const ends = segments.map(([a, b]): [V3, V3] => (order(welded(a), welded(b)) <= 0 ? [a, b] : [b, a]));
  ends.sort((p, q) => order(welded(p[0]), welded(q[0])) || order(welded(p[1]), welded(q[1])));
  return ends.map(([start, end], id) => ({ id, start, end, length: length(sub(end, start)) }));
}

// ---------------------------------------------------------------------------------------------------
// AC1: "A flat plane of 2 × 2 quads (8 triangles) whose two columns are named parts with different materials"

/** The plane: 1 × 1 m in y = 0, centred on the origin, facing +Y; its columns are split at x = 0. */
export const PLANE = { size: 1, cells: 2, triangles: 8 } as const;
/** One cell of the plane with its own four vertices: two triangles that share the diagonal from its least corner. */
function cell(i: number, j: number): TriMesh {
  const step = PLANE.size / PLANE.cells;
  const at = (a: number, b: number): V3 => [-PLANE.size / 2 + a * step, 0, -PLANE.size / 2 + b * step];
  return { positions: [at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)], triangles: [[0, 1, 2], [0, 2, 3]] };
}
/** Meshes joined into one, each keeping its own vertices. */
function joined(parts: readonly TriMesh[]): TriMesh {
  const out: TriMesh = { positions: [], triangles: [] };
  for (const m of parts) {
    const base = out.positions.length;
    out.positions.push(...m.positions);
    out.triangles.push(...m.triangles.map(([a, b, c]): [number, number, number] => [base + a, base + b, base + c]));
  }
  return out;
}
/**
 * The plane as glTF primitives, which the base imports as the named parts `primitive.0`, `primitive.1`, …:
 * `columns` gives two, primitive 0 the column x < 0 and primitive 1 the column x > 0; `quads` gives four, one a
 * cell. Every primitive has its own vertices, so the edges between parts exist only on welded positions.
 */
export function planeParts(by: 'columns' | 'quads'): TriMesh[] {
  const cells = [0, 1].map((i) => [0, 1].map((j) => cell(i, j)));
  return by === 'columns' ? cells.map((column) => joined(column)) : cells.flat();
}

/** A JSON glTF of one mesh with a primitive per part (POSITION and u32 indices, one node, no material, no
 * normals), its buffer inline, as #1640's one-primitive `gltf` writes it. */
export function gltfParts(parts: readonly TriMesh[]): Asset {
  const chunks: Buffer[] = [];
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const primitives: object[] = [];
  let offset = 0;
  const view = (b: Buffer): number => {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: b.length });
    chunks.push(b);
    offset += b.length;
    return bufferViews.length - 1;
  };
  for (const m of parts) {
    const pos = Buffer.alloc(m.positions.length * 12);
    const idx = Buffer.alloc(m.triangles.length * 12);
    m.positions.forEach((p, i) => p.forEach((v, k) => pos.writeFloatLE(v, i * 12 + k * 4)));
    m.triangles.forEach((t, i) => t.forEach((v, k) => idx.writeUInt32LE(v, i * 12 + k * 4)));
    const min = [0, 1, 2].map((k) => Math.min(...m.positions.map((p) => p[k]!)));
    const max = [0, 1, 2].map((k) => Math.max(...m.positions.map((p) => p[k]!)));
    const first = accessors.length;
    accessors.push({ bufferView: view(pos), componentType: 5126, count: m.positions.length, type: 'VEC3', min, max });
    accessors.push({ bufferView: view(idx), componentType: 5125, count: m.triangles.length * 3, type: 'SCALAR' });
    primitives.push({ attributes: { POSITION: first }, indices: first + 1, mode: 4 });
  }
  const data = Buffer.concat(chunks);
  const doc = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives }], accessors, bufferViews,
    buffers: [{ byteLength: data.length, uri: `data:application/octet-stream;base64,${data.toString('base64')}` }],
  };
  const bytes = Buffer.from(JSON.stringify(doc));
  return { bytes, sha: createHash('sha256').update(bytes).digest('hex') };
}

/** AC1's counts, each with the criterion's words. `all` and `border` are fixture guards the base answers. */
export const PLANE_COUNTS = {
  /** "draws exactly 2 segments, end to end along the line between the columns, and no diagonal" */
  columns: 2,
  /** "With `border: true` it draws 10": the plane's 8 border edges and those 2. */
  withBorder: 10,
  /** "with one material 0" */
  oneMaterial: 0,
  /** "with a material per quad 4": the two lines through the middle, two segments each. */
  perQuad: 4,
  /** "A planted picker that keeps every edge two faces share draws 8": those 4 and the 4 diagonals. */
  planted: 8,
  /** Every welded edge of the 3 × 3 grid: 12 quad sides and 4 diagonals. */
  all: 16,
  /** Its border alone: the edges with one face. */
  border: 8,
} as const;

// ---------------------------------------------------------------------------------------------------
// AC2: "A 1 m cube with crease edges and `hidden` set, in a three-quarter view, gives 12 spans, each a whole edge:
// 9 visible and the 3 that meet the far corner hidden"

export const CUBE = { spans: 12, visible: 9, hidden: 3, edge: 1 } as const;

// ---------------------------------------------------------------------------------------------------
// AC3 to AC6: "A 1 m edge", its blocker, and the spans the issue gives

/** The ridge: from (−0.5, 0, 0), its start (the lesser end by x), to (0.5, 0, 0). */
export const RIDGE = { start: [-0.5, 0, 0] as V3, end: [0.5, 0, 0] as V3, length: 1 } as const;
/**
 * The fold: two quads that meet at 90° along the ridge and run back from it to z = −0.5 m, one up and one down,
 * each with its own vertices. Under `crease {angle: 30}` and `border: false` the ridge is its only picked edge,
 * so it is edge 0. Seen from +Z, nothing of the fold is in front of the ridge.
 */
export function fold(): Asset {
  const [a, b] = [RIDGE.start, RIDGE.end];
  const back = (p: V3, y: number): V3 => [p[0], y, -0.5];
  const up: TriMesh = { positions: [a, b, back(b, 0.5), back(a, 0.5)], triangles: [[0, 1, 2], [0, 2, 3]] };
  const down: TriMesh = { positions: [a, back(a, -0.5), back(b, -0.5), b], triangles: [[0, 1, 2], [0, 2, 3]] };
  return gltf(joined([up, down]));
}
/**
 * The blocker: a flat quad with no thickness in the plane z = `z`, facing +Z, from x = `x0` to `x1`, `height` tall
 * about y = 0. With no thickness its silhouette is exact from any distance (README: The blocker).
 */
export function quad(x0: number, x1: number, z: number, height = 0.4): Asset {
  const h = height / 2;
  return gltf({ positions: [[x0, -h, z], [x1, -h, z], [x1, h, z], [x0, h, z]], triangles: [[0, 1, 2], [0, 2, 3]] });
}

/** A span or a dash the issue gives: metres from the edge's start, and whether it is hidden. */
export type Want = readonly [from: number, to: number, hidden: boolean];
/** AC3 and AC4: "spans 0 to 0.3 m visible, 0.3 to 0.7 m hidden and 0.7 to 1 m visible". */
export const MIDDLE: readonly Want[] = [[0, 0.3, false], [0.3, 0.7, true], [0.7, 1, false]];
/** AC3: "reports one visible span". AC6: "leaves the edge one visible span". */
export const WHOLE: readonly Want[] = [[0, 1, false]];
/** AC4: "A planted classifier that projects the blocker without perspective hides 0.4 to 0.6 m". */
export const UNPROJECTED: readonly Want[] = [[0, 0.4, false], [0.4, 0.6, true], [0.6, 1, false]];
/** AC5: "With the orthographic blocker moved to hide 0.33 to 0.73 m". */
export const MOVED: readonly Want[] = [[0, 0.33, false], [0.33, 0.73, true], [0.73, 1, false]];
/** AC6: "a cutaway that removes the blocker past the edge's midpoint leaves only 0.3 to 0.5 m hidden". */
export const CUT: readonly Want[] = [[0, 0.3, false], [0.3, 0.5, true], [0.5, 1, false]];

// ---------------------------------------------------------------------------------------------------
// AC5: dashes measured from the edge's start

/** "the line's `dash` and `hidden.dash` both 0.05 m on and 0.05 m off in world size space". */
export const DASH: [number, number] = [0.05, 0.05];
/**
 * "the first hidden dash ends at 0.35 m and the next starts at 0.40 m, within 1e-5 m, and the visible dash after
 * the blocker runs from 0.73 to 0.75 m. A planted dash that restarts at each split ends its first hidden dash at
 * 0.38 m".
 */
export const DASH_ENDS = { firstHiddenEnd: 0.35, nextHiddenStart: 0.4, visibleAfter: [0.73, 0.75], restartedFirstHiddenEnd: 0.38 } as const;

const SLIVER = 1e-9;
/** The stretches of [from, to] a dash `[on, off]` inks when it is measured from `origin`, in metres along the edge. */
export function dashIntervals(from: number, to: number, [on, off]: readonly [number, number], origin = 0): [number, number][] {
  const period = on + off;
  const out: [number, number][] = [];
  for (let k = Math.floor((from - origin) / period); origin + k * period < to - SLIVER; k++) {
    const lo = Math.max(from, origin + k * period);
    const hi = Math.min(to, origin + k * period + on);
    if (hi - lo > SLIVER) out.push([lo, hi]);
  }
  return out;
}
/**
 * Every stretch the line inks on an edge with `spans`, each span dashed by `dash` from the edge's start: the
 * reference for `dashes`. With `restart` each span is dashed from its own `from` instead, the wrong program AC5 names.
 */
export function inked(spans: readonly Want[], dash: readonly [number, number], restart = false): Want[] {
  return spans.flatMap(([from, to, hidden]) => dashIntervals(from, to, dash, restart ? from : 0).map(([a, b]): Want => [a, b, hidden]));
}

// ---------------------------------------------------------------------------------------------------
// AC7: "A 10 s orbit of a 100,000-triangle asset, sampled at 100 fixed times"

/**
 * The orbit of #1640's folded sheet: #1640's camera (35° up, 9 m from (0, 0.5, 0), fov 40°) turning once in 10 s,
 * sampled at t = k ÷ 10 s, k = 0 to 99. It starts at azimuth 45°, where the sheet hides part of itself at t = 0 and
 * another part at t = 0.1 s; from azimuth 0° it hides nothing for the first 1.2 s.
 */
export const ORBIT = { seconds: 10, fps: 10, times: 100, azimuth: 45, turn: 360, elevation: 35, distance: 9, target: [0, 0.5, 0] as V3, fov: 40 } as const;
/** The camera's azimuth at time k, in degrees: the channel's linear value. */
export const orbitAzimuth = (k: number): number => ORBIT.azimuth + (ORBIT.turn * k) / ORBIT.times;
/** The eye at time k: target + distance · (cos el · sin az, sin el, cos el · cos az), as the base's orbit camera. */
export function orbitEye(k: number): V3 {
  const az = (orbitAzimuth(k) * Math.PI) / 180;
  const el = (ORBIT.elevation * Math.PI) / 180;
  const [x, y, z] = ORBIT.target;
  return [x + ORBIT.distance * Math.cos(el) * Math.sin(az), y + ORBIT.distance * Math.sin(el), z + ORBIT.distance * Math.cos(el) * Math.cos(az)];
}
/** #1640's folded sheet as the five flat strips it is: x from x0 to x1, y = slope · x + c, z from −2 to 2 m. */
const STRIPS: readonly (readonly [x0: number, x1: number, slope: number, c: number])[] = [
  [-2.5, -1.5, 1, 2.5], [-1.5, -0.5, -1, -0.5], [-0.5, 0.5, 1, 0.5], [0.5, 1.5, -1, 1.5], [1.5, 2.5, 1, -1.5],
];
/**
 * Whether the sheet hides `p`, a point on it, from `eye`: the segment from p to the eye meets a strip past p. A
 * strip that p lies on is met at p alone, so the faces that share p's edge never hide it.
 */
export function sheetHides(p: V3, eye: V3): boolean {
  const d = sub(eye, p);
  return STRIPS.some(([x0, x1, slope, c]) => {
    const along = d[1] - slope * d[0];
    if (Math.abs(along) < 1e-12) return false;
    const t = (slope * p[0] + c - p[1]) / along;
    if (t <= 1e-9 || t >= 1) return false;
    const x = p[0] + t * d[0];
    const z = p[2] + t * d[2];
    return x >= x0 && x <= x1 && z >= -2 && z <= 2;
  });
}
/** A fixed permutation of 0 to n − 1: Fisher–Yates driven by a seeded generator (mulberry32). */
export function shuffled(n: number, seed: number): number[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let r = Math.imul(state ^ (state >>> 15), 1 | state);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
