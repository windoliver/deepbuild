// The reviewed CPU references the #440 criteria are held to, written from the design's definitions alone
// (canvas primitives: Modifier: subdivide, Modifier: bevel, Builder: uv, Builder `hull`, Marks in 3D: mesh
// edges): welding, edge topology, area and volume; the mesh's face edges as `quads` reads them; Catmull-Clark
// counts from the design's formulas and Catmull-Clark positions with infinitely sharp creases (the DeRose /
// OpenSubdiv rules); a triangle's UV stretch; 2D triangle overlap; a seeded shuffle; the icosahedron's volume;
// and the order-free hashes the criteria compare. Nothing here reads the program; no vitest import.

import { createHash } from 'node:crypto';

export type V3 = [number, number, number];
export type V2 = [number, number];
export type Tri = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => scale(a, 1 / length(a));
export const dist = (a: V3, b: V3): number => length(sub(a, b));
/** The angle between two directions, in radians, well conditioned near 0 and π. */
export const angle = (a: V3, b: V3): number => Math.atan2(length(cross(a, b)), dot(a, b));
export const fmt = (x: number): string => String(Number(x.toPrecision(10)));
export const fmtV = (v: readonly number[]): string => `(${v.map(fmt).join(', ')})`;
export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

// ---------------------------------------------------------------------------------------------------
// Welding, edges, Euler characteristic, area and volume (as #420's and #441's suites read them).

/** Welding: positions equal to 1e-6 m (by rounding to a 1e-6 m grid) are one point. */
export const WELD = 1e-6;
export const weldKey = (p: readonly number[]): string => p.map((x) => Math.round(x / WELD)).join(',');
export interface Welded { ids: number[]; points: V3[] }
export function weld(positions: V3[]): Welded {
  const at = new Map<string, number>();
  const points: V3[] = [];
  const ids = positions.map((p) => {
    const k = weldKey(p);
    let id = at.get(k);
    if (id === undefined) { id = points.length; at.set(k, id); points.push(p); }
    return id;
  });
  return { ids, points };
}
/** Triangle t of `indices` as its three vertex indices. */
export const triAt = (indices: number[], t: number): Tri => [indices[3 * t]!, indices[3 * t + 1]!, indices[3 * t + 2]!];
/** Every triangle as welded point IDs, degenerate ones (two equal welded corners) left out. */
export function weldedTriangles(indices: number[], ids: number[]): Tri[] {
  const out: Tri[] = [];
  for (let t = 0; 3 * t + 2 < indices.length; t++) {
    const [a, b, c] = triAt(indices, t).map((i) => ids[i]!) as Tri;
    if (a === b || b === c || c === a) continue;
    out.push([a, b, c]);
  }
  return out;
}
export interface Topology { V: number; E: number; F: number; open: number; nonManifold: number; misoriented: number }
/** V, E and F of a triangle set, and its edges used once (open), more than twice, or twice the same way. */
export function topology(tris: Tri[]): Topology {
  const uses = new Map<string, { n: number; dirs: number }>();
  const verts = new Set<number>();
  for (const [a, b, c] of tris) {
    for (const [p, q] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      verts.add(p);
      const k = p < q ? `${p}-${q}` : `${q}-${p}`;
      const e = uses.get(k) ?? { n: 0, dirs: 0 };
      e.n++; e.dirs += p < q ? 1 : -1;
      uses.set(k, e);
    }
  }
  let open = 0; let nonManifold = 0; let misoriented = 0;
  for (const e of uses.values()) {
    if (e.n === 1) open++;
    else if (e.n > 2) nonManifold++;
    else if (e.dirs !== 0) misoriented++;
  }
  return { V: verts.size, E: uses.size, F: tris.length, open, nonManifold, misoriented };
}
export const triArea = (a: V3, b: V3, c: V3): number => length(cross(sub(b, a), sub(c, a))) / 2;
export function areaOf(points: V3[], tris: Tri[]): number {
  let s = 0;
  for (const [a, b, c] of tris) s += triArea(points[a]!, points[b]!, points[c]!);
  return s;
}
/** The signed volume a closed, outward-wound triangle set encloses (divergence theorem). */
export function volumeOf(points: V3[], tris: Tri[]): number {
  let s = 0;
  for (const [a, b, c] of tris) s += dot(points[a]!, cross(points[b]!, points[c]!)) / 6;
  return s;
}

/** An undirected segment keyed by its two welded ends, order-free. */
export const segmentKey = (a: readonly number[], b: readonly number[]): string => [weldKey(a), weldKey(b)].sort().join('|');

/**
 * A mesh's edges on welded positions, as Marks in 3D: mesh edges defines them: `all` is every triangle edge;
 * `quads` leaves out an edge whose two triangles belong to one face (a quad's or a polygon's diagonal), with each
 * triangle's face from the reply's `faces`. Keys are `segmentKey`s.
 */
export function meshEdges(positions: V3[], indices: number[], faces: number[]): { all: Set<string>; quads: Set<string> } {
  const on = new Map<string, number[]>();
  for (let t = 0; 3 * t + 2 < indices.length; t++) {
    const [a, b, c] = triAt(indices, t).map((i) => positions[i]!) as [V3, V3, V3];
    for (const [p, q] of [[a, b], [b, c], [c, a]] as [V3, V3][]) {
      if (weldKey(p) === weldKey(q)) continue;
      const k = segmentKey(p, q);
      on.set(k, [...(on.get(k) ?? []), faces[t]!]);
    }
  }
  const all = new Set(on.keys());
  const quads = new Set([...on].filter(([, f]) => !(f.length === 2 && f[0] === f[1])).map(([k]) => k));
  return { all, quads };
}

// ---------------------------------------------------------------------------------------------------
// Catmull-Clark (Modifier: subdivide).

/**
 * The design's exact counts: a face of n sides becomes n quads at the first level and each quad four after, so
 * faces = C × 4^(levels − 1) with C the sum of face sizes; each level gives V′ = V + E + F and E′ = 2E + C.
 */
export function ccCounts(V: number, E: number, F: number, C: number, levels: number): { V: number; E: number; F: number } {
  for (let l = 0; l < levels; l++) {
    [V, E, F, C] = [V + E + F, 2 * E + C, C, 4 * C];
  }
  return { V, E, F };
}

export interface PolyMesh { points: V3[]; faces: number[][] }
export const edgeKey = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);
const mean = (ps: V3[]): V3 => scale(ps.reduce((s, p) => add(s, p), [0, 0, 0] as V3), 1 / ps.length);

/**
 * Catmull-Clark on a closed polygon mesh, `levels` times, with the edges in `creased` infinitely sharp at every
 * level (DeRose, Kass and Truong; OpenSubdiv's rules for a sharpness at or past the level count): a face point
 * is its face's centroid; a smooth edge point (a + b + f₁ + f₂) / 4 and a creased one the midpoint; a vertex on
 * fewer than two creased edges takes the smooth rule (Q + 2R + (n − 3) v) / n, on exactly two the crease rule
 * (a + 6v + b) / 8 with a, b the creased neighbours, on three or more stays put. A creased edge's two halves stay
 * creased.
 */
export function catmullClark(mesh: PolyMesh, creased: Set<string>, levels: number): PolyMesh {
  let { points, faces } = mesh;
  let crease = creased;
  for (let l = 0; l < levels; l++) {
    const facePoint = faces.map((f) => mean(f.map((i) => points[i]!)));
    const edges = new Map<string, { a: number; b: number; faces: number[]; index: number }>();
    faces.forEach((f, fi) => f.forEach((a, i) => {
      const b = f[(i + 1) % f.length]!;
      const k = edgeKey(a, b);
      const e = edges.get(k) ?? { a: Math.min(a, b), b: Math.max(a, b), faces: [], index: 0 };
      e.faces.push(fi);
      edges.set(k, e);
    }));
    for (const e of edges.values()) if (e.faces.length !== 2) throw Error('catmullClark: the reference takes closed manifold meshes only');
    const vEdges: string[][] = points.map(() => []);
    const vFaces: number[][] = points.map(() => []);
    for (const [k, e] of edges) { vEdges[e.a]!.push(k); vEdges[e.b]!.push(k); }
    faces.forEach((f, fi) => f.forEach((v) => vFaces[v]!.push(fi)));
    const P = points.length; const F = faces.length;
    const out: V3[] = points.map((v, i) => {
      const sharp = vEdges[i]!.filter((k) => crease.has(k));
      if (sharp.length >= 3) return v;
      if (sharp.length === 2) {
        const [a, b] = sharp.map((k) => { const e = edges.get(k)!; return points[e.a === i ? e.b : e.a]!; }) as [V3, V3];
        return scale(add(add(a, b), scale(v, 6)), 1 / 8);
      }
      const n = vEdges[i]!.length;
      const Q = mean(vFaces[i]!.map((fi) => facePoint[fi]!));
      const R = mean(vEdges[i]!.map((k) => { const e = edges.get(k)!; return scale(add(points[e.a]!, points[e.b]!), 0.5); }));
      return scale(add(add(Q, scale(R, 2)), scale(v, n - 3)), 1 / n);
    });
    out.push(...facePoint);
    let next = P + F;
    for (const [k, e] of edges) {
      e.index = next++;
      const [pa, pb] = [points[e.a]!, points[e.b]!];
      out.push(crease.has(k) ? scale(add(pa, pb), 0.5) : scale(add(add(pa, pb), add(facePoint[e.faces[0]!]!, facePoint[e.faces[1]!]!)), 0.25));
    }
    const ep = (a: number, b: number): number => edges.get(edgeKey(a, b))!.index;
    const quads: number[][] = [];
    faces.forEach((f, fi) => f.forEach((c, i) => {
      const prev = f[(i + f.length - 1) % f.length]!; const nxt = f[(i + 1) % f.length]!;
      quads.push([c, ep(c, nxt), P + fi, ep(prev, c)]);
    }));
    const nextCrease = new Set<string>();
    for (const k of crease) {
      const e = edges.get(k);
      if (!e) continue;
      nextCrease.add(edgeKey(e.a, e.index));
      nextCrease.add(edgeKey(e.index, e.b));
    }
    points = out; faces = quads; crease = nextCrease;
  }
  return { points, faces };
}

/** A slab box `size` as slab@1 places it (centred on x and z, from y = 0 up): its corners and six quad faces, the top first. */
export function slabBox(size: V3): { mesh: PolyMesh; top: number[] } {
  const [hx, h, hz] = [size[0] / 2, size[1], size[2] / 2];
  const points: V3[] = [];
  for (const x of [-hx, hx]) for (const y of [0, h]) for (const z of [-hz, hz]) points.push([x, y, z]);
  // Index = 4·ix + 2·iy + iz.
  const top = [2, 3, 7, 6];
  const faces = [top, [0, 4, 5, 1], [0, 1, 3, 2], [4, 6, 7, 5], [0, 2, 6, 4], [1, 5, 7, 3]];
  return { mesh: { points, faces }, top };
}

// ---------------------------------------------------------------------------------------------------
// UVs (Builder: uv).

/**
 * The two singular values of the map from a triangle's surface (metres) to its UV triangle (UV units): how many
 * UV units one metre spans along the triangle's most and least stretched directions. One texel density in every
 * direction is both equal to 1 ÷ uv_scale.
 */
export function uvStretch(p: [V3, V3, V3], t: [V2, V2, V2]): [number, number] {
  const e1 = sub(p[1], p[0]); const e2 = sub(p[2], p[0]);
  const x = unit(e1);
  const yRaw = sub(e2, scale(x, dot(e2, x)));
  const y = unit(yRaw);
  // World triangle in its own plane: (|e1|, 0) and (e2·x, e2·y).
  const a = [length(e1), 0]; const b = [dot(e2, x), dot(e2, y)];
  const du = [t[1][0] - t[0][0], t[2][0] - t[0][0]]; const dv = [t[1][1] - t[0][1], t[2][1] - t[0][1]];
  const det = a[0]! * b[1]! - b[0]! * a[1]!;
  // J = [du; dv] · [a b]⁻¹, [a b]⁻¹ = [[b1, −b0], [−a1, a0]] / det.
  const j00 = (du[0]! * b[1]! - du[1]! * a[1]!) / det; const j01 = (-du[0]! * b[0]! + du[1]! * a[0]!) / det;
  const j10 = (dv[0]! * b[1]! - dv[1]! * a[1]!) / det; const j11 = (-dv[0]! * b[0]! + dv[1]! * a[0]!) / det;
  const s = j00 * j00 + j01 * j01 + j10 * j10 + j11 * j11;
  const d = Math.abs(j00 * j11 - j01 * j10);
  const root = Math.sqrt(Math.max(s * s - 4 * d * d, 0));
  return [Math.sqrt(Math.max((s - root) / 2, 0)), Math.sqrt((s + root) / 2)];
}

export const uvArea = (t: [V2, V2, V2]): number => ((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2;

/**
 * Whether two UV triangles' interiors overlap by more than `eps` (separating axes: two convex polygons with
 * disjoint interiors are parted by a line along one of their edges; touching along an edge or at a corner is
 * not an overlap).
 */
export function uvOverlap(a: [V2, V2, V2], b: [V2, V2, V2], eps: number): boolean {
  for (const tri of [a, b]) {
    for (let i = 0; i < 3; i++) {
      const p = tri[i]!; const q = tri[(i + 1) % 3]!;
      const nx = q[1] - p[1]; const ny = p[0] - q[0];
      const l = Math.hypot(nx, ny);
      if (l === 0) continue;
      const proj = (t: [V2, V2, V2]): [number, number] => {
        const v = t.map((r) => (r[0] * nx + r[1] * ny) / l);
        return [Math.min(...v), Math.max(...v)];
      };
      const [a0, a1] = proj(a); const [b0, b1] = proj(b);
      if (a1 <= b0 + eps || b1 <= a0 + eps) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------------
// Hulls (Builder `hull`).

/** A seeded generator (mulberry32), so a shuffle is the same on every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** `list` in a seeded Fisher-Yates order. */
export function shuffled<T>(list: readonly T[], seed: number): T[] {
  const r = mulberry32(seed);
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
const lexLess = (a: V3, b: V3): boolean => a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

/**
 * Whether fanning the unit cube's faces from each face's first corner in `order` gives another diagonal than
 * fanning from the corner that sorts first by (x, y, z) on at least one face: so a hull that fans by input order
 * gives another mesh for `order`. (A square fanned from its first or its opposite corner has the same diagonal.)
 */
export function fanOrderShows(order: V3[]): boolean {
  for (let axis = 0; axis < 3; axis++) {
    for (const side of [0, 1]) {
      const corners = order.filter((p) => p[axis] === side && p.every((x) => x === 0 || x === 1));
      if (corners.length !== 4) throw Error('fanOrderShows: the order must hold the unit cube\'s corners');
      const first = corners[0]!;
      const least = corners.reduce((m, p) => (lexLess(p, m) ? p : m));
      const opposite = least.map((x, k) => (k === axis ? x : 1 - x)) as V3;
      if (weldKey(first) !== weldKey(least) && weldKey(first) !== weldKey(opposite)) return true;
    }
  }
  return false;
}

/** A regular icosahedron's volume with its corners on a sphere of radius r: (5/12)(3 + √5) a³, a = 4r ÷ √(10 + 2√5). */
export function icosahedronVolume(r: number): number {
  const a = (4 * r) / Math.sqrt(10 + 2 * Math.sqrt(5));
  return (5 / 12) * (3 + Math.sqrt(5)) * a ** 3;
}

// ---------------------------------------------------------------------------------------------------
// Hashes the criteria compare.

/** The mesh hash: SHA-256 of its positions and its indices, in their order, as JSON numbers. */
export const meshHash = (positions: V3[], indices: number[]): string => sha256(JSON.stringify({ positions, indices }));

/**
 * The welded-position and UV hash: SHA-256 of the sorted set of distinct (welded position, uv) pairs over every
 * vertex, each rounded to a 1e-6 grid, so it doesn't depend on vertex order, triangle order or which diagonal
 * splits a quad, and a seam's two UVs at one point both count.
 */
export function pointUvHash(positions: V3[], uv: V2[]): string {
  const keys = new Set(positions.map((p, i) => `${weldKey(p)}|${weldKey(uv[i]!)}`));
  return sha256([...keys].sort().join(';'));
}
