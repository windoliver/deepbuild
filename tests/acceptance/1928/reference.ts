// The reviewed CPU references the #1928 criteria are held to, written from the issue's and the design's
// definitions alone (canvas primitives: Modifier): welding at 1e-6 m; the polygon view of a mesh row (each
// face's boundary loop on welded points, from the row's triangles and face IDs); welded points, edges and
// faces; a loop's area and normal (Newell); whether a triangle set closes and the volume it holds (the
// divergence theorem); and the order-free welded-position and UV hash. Nothing here reads the program; no
// vitest import.

import { createHash } from 'node:crypto';

export type V3 = [number, number, number];
export type V2 = [number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
/** A number as a failure prints it: six decimals, trailing zeros dropped, so 0.7371572… reads 0.737157. */
export const fmt = (x: number): string => String(Number(x.toFixed(6)));
export const fmtV = (v: readonly number[]): string => `(${v.map(fmt).join(', ')})`;
/** How far `got` is from `want`, as a share of `want`. */
export const relative = (got: number, want: number): number => Math.abs(got - want) / Math.abs(want);

// ---------------------------------------------------------------------------------------------------
// Welding and the polygon view.

/** Welding: positions equal to 1e-6 m (by rounding to a 1e-6 m grid) are one point. */
export const WELD = 1e-6;
export const weldKey = (p: readonly number[]): string => p.map((x) => Math.round(x / WELD)).join(',');

export interface Face {
  /** The face's ID, as the row's `faces` gives it. */
  id: number;
  /** Its triangles, by index. */
  tris: number[];
  /** Its distinct welded points. */
  points: number[];
  /** Its boundary as one simple loop of welded points in winding order, or null when its boundary is no such loop. */
  loop: number[] | null;
}
export interface View {
  /** The welded points, in order of first appearance. */
  points: V3[];
  /** Each vertex's welded point. */
  pointOf: number[];
  faces: Face[];
  /** Every edge of a face's boundary, once, by its two welded ends. */
  edges: Set<string>;
}

/**
 * The polygon view of a mesh row: its positions welded, and each face (the triangles that share one face ID)
 * read as its boundary: the triangle edges that no other triangle of the face runs back along, so a quad's
 * or a polygon's diagonals are left out. The view never reads triangle order, vertex order, how the IDs are
 * numbered or where a loop starts.
 */
export function polygons(positions: V3[], indices: number[], faceIds: number[]): View {
  const at = new Map<string, number>();
  const points: V3[] = [];
  const pointOf = positions.map((p) => {
    const k = weldKey(p);
    let id = at.get(k);
    if (id === undefined) { id = points.length; at.set(k, id); points.push(p); }
    return id;
  });
  const byId = new Map<number, number[]>();
  faceIds.forEach((f, t) => byId.set(f, [...(byId.get(f) ?? []), t]));
  const edges = new Set<string>();
  const faces: Face[] = [];
  for (const [id, tris] of byId) {
    const half = new Map<string, [number, number]>();
    const seen = new Set<number>();
    let simple = true;
    for (const t of tris) {
      const c = [0, 1, 2].map((j) => pointOf[indices[3 * t + j]!]!);
      c.forEach((p, j) => {
        seen.add(p);
        const q = c[(j + 1) % 3]!;
        if (p === q) return;
        if (half.has(`${p}>${q}`)) simple = false;
        half.set(`${p}>${q}`, [p, q]);
      });
    }
    const boundary = [...half.values()].filter(([p, q]) => !half.has(`${q}>${p}`));
    const next = new Map<number, number>();
    for (const [p, q] of boundary) {
      if (next.has(p)) simple = false;
      next.set(p, q);
      edges.add(p < q ? `${p}-${q}` : `${q}-${p}`);
    }
    const loop: number[] = [];
    let p = boundary[0]?.[0];
    while (p !== undefined && loop.length < boundary.length) {
      loop.push(p);
      p = next.get(p);
      if (p === loop[0]) break;
    }
    const whole = boundary.length >= 3 && loop.length === boundary.length && p === loop[0];
    faces.push({ id, tris, points: [...seen], loop: simple && whole ? loop : null });
  }
  return { points, pointOf, faces, edges };
}

export interface Counts { points: number; edges: number; faces: number }
/** A view's welded points, edges and faces. */
export const countsOf = (v: View): Counts => ({ points: v.points.length, edges: v.edges.size, faces: v.faces.length });
/** Each count that isn't the one wanted, as `<what>: <n> points, not <m>`. */
export function countProblems(what: string, got: Counts, want: Counts): string[] {
  return (['points', 'edges', 'faces'] as const).filter((k) => got[k] !== want[k]).map((k) => `${what}: ${got[k]} ${k}, not ${want[k]}`);
}

/**
 * A loop's area vector (Newell): half the sum of the cross products of its consecutive corners, taken about
 * its first corner. Its length is the loop's area, for a corner under or over 180° alike, and its direction
 * the normal the loop's winding gives.
 */
export function areaVector(v: View, loop: number[]): V3 {
  const o = v.points[loop[0]!]!;
  let n: V3 = [0, 0, 0];
  for (let i = 1; i + 1 < loop.length; i++) n = add(n, cross(sub(v.points[loop[i]!]!, o), sub(v.points[loop[i + 1]!]!, o)));
  return scale(n, 0.5);
}
/** A face's area from its loop; NaN when its boundary is no single simple loop. */
export const faceArea = (v: View, f: Face): number => (f.loop ? length(areaVector(v, f.loop)) : Number.NaN);
/** Why face `f`, named `what`, doesn't have the area `want` within the relative `tolerance`; nothing when it has. */
export function areaProblems(v: View, f: Face, want: number, tolerance: number, what: string): string[] {
  if (!f.loop) return [`${what}: its boundary is not one simple loop`];
  const got = faceArea(v, f);
  return relative(got, want) <= tolerance ? [] : [`${what}: its area is ${fmt(got)} m², not ${fmt(want)} m² (off by ${relative(got, want).toExponential(1)} of it)`];
}
/** Whether face `f` has a zero-length edge: one of its triangles has two corners at one welded point. */
export function hasZeroEdge(v: View, indices: number[], f: Face): boolean {
  return f.tris.some((t) => {
    const [a, b, c] = [0, 1, 2].map((j) => v.pointOf[indices[3 * t + j]!]!);
    return a === b || b === c || c === a;
  });
}

/** The tolerance, in metres, for "lies in this plane" and "sits at this place". */
export const PLACE = 1e-9;
/** Whether every point of face `f` has coordinate `axis` equal to `value`, within 1e-9 m. */
export const inPlane = (v: View, f: Face, axis: 0 | 1 | 2, value: number): boolean => f.points.every((p) => Math.abs(v.points[p]![axis] - value) <= PLACE);
/** Whether face `f` has a point welded to one of `corners`. */
export function touches(v: View, f: Face, corners: readonly V3[]): boolean {
  const keys = new Set(corners.map(weldKey));
  return f.points.some((p) => keys.has(weldKey(v.points[p]!)));
}
/** The eight corners of the box from `lo` to `hi`. */
export function boxCorners(lo: V3, hi: V3): V3[] {
  const out: V3[] = [];
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) out.push([x, y, z]);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Closed surfaces and the volume they hold.

/**
 * A row's triangles on welded points: how many of their edges aren't on exactly two triangles wound opposite
 * ways (0 for a closed, consistently wound surface), and the volume they hold by the divergence theorem, the
 * sum of p₀ · (p₁ × p₂) ÷ 6, positive when the winding faces outward. A triangle with two corners at one
 * point has no area and is left out.
 */
export function solid(v: View, indices: number[]): { open: number; volume: number } {
  const uses = new Map<string, number>();
  let volume = 0;
  for (let t = 0; 3 * t + 2 < indices.length; t++) {
    const [a, b, c] = [0, 1, 2].map((j) => v.pointOf[indices[3 * t + j]!]!) as [number, number, number];
    if (a === b || b === c || c === a) continue;
    for (const [p, q] of [[a, b], [b, c], [c, a]] as [number, number][]) uses.set(`${p}>${q}`, (uses.get(`${p}>${q}`) ?? 0) + 1);
    volume += dot(v.points[a]!, cross(v.points[b]!, v.points[c]!)) / 6;
  }
  let open = 0;
  for (const [k, n] of uses) {
    const [p, q] = k.split('>');
    if (n !== 1 || uses.get(`${q}>${p}`) !== 1) open++;
  }
  return { open, volume };
}

// ---------------------------------------------------------------------------------------------------
// The hash AC7 compares.

/**
 * The welded-position and UV hash: SHA-256 of the sorted set of distinct (welded position, uv0) pairs over
 * every vertex, each rounded to a 1e-6 grid. It doesn't depend on vertex order, triangle order, face IDs or
 * which diagonal splits a face, and a seam's two UVs at one point both count.
 */
export function pointUvHash(positions: V3[], uv: V2[]): string {
  const keys = new Set(positions.map((p, i) => `${weldKey(p)}|${weldKey(uv[i]!)}`));
  return createHash('sha256').update([...keys].sort().join(';')).digest('hex');
}
