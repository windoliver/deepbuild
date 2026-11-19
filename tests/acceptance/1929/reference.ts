// The reviewed CPU references the #1929 criteria are held to, written from the issue's Scope and the design's
// Modifier semantics alone (canvas primitives: Modifier): the Bernstein polynomials and the free-form deformation
// of Sederberg and Parry (a vertex at (s, t, u) in the box moves by the sum of B_i(s) B_j(t) B_k(u) move_ijk), mean
// value coordinates for closed triangle meshes as Ju, Schaefer and Warren published them (their Figure 4), the
// control meshes the criteria name (an octahedron, and a bipyramid for the point cap), welding, a closed mesh's
// volume by the divergence theorem and its open edges. The wrong programs the criteria name are here too, as twins a
// judge must fail: (s, t, u) over the item's own bounds, trilinear cells, a sum that leaves out the last point, and
// weights by normalized inverse distance. Nothing here reads the program; no vitest import, so it runs on its own.

export type V3 = [number, number, number];
export type Tri = [number, number, number];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const fmt = (x: number): string => String(x);
export const fmtV = (v: readonly number[]): string => `(${v.map(fmt).join(', ')})`;
/** The same numbers, one for one (0 and −0 alike). */
export const same = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((x, k) => x === b[k]);
const ZERO: V3 = [0, 0, 0];

// ---------------------------------------------------------------------------------------------------
// Welding: positions equal to 1e-6 m are one point (Marks in 3D: mesh edges; #420's suite).

const WELD = 1e-6;
/** One key per welded place. */
const weldKey = (p: readonly number[]): string => p.map((x) => String(Math.round(x / WELD) + 0)).join(',');
/** For each vertex, the lowest index among the vertices at its place: how this suite names a vertex (README). */
export function lowestAtPlace(positions: readonly V3[]): number[] {
  const first = new Map<string, number>();
  return positions.map((p, i) => {
    const key = weldKey(p);
    if (!first.has(key)) first.set(key, i);
    return first.get(key)!;
  });
}

// ---------------------------------------------------------------------------------------------------
// The box deform (Sederberg and Parry): Bernstein polynomials over a box.

const binomial = (n: number, i: number): number => {
  let c = 1;
  for (let k = 0; k < i; k++) c = (c * (n - k)) / (k + 1);
  return c;
};
/** x to a whole power by repeated multiplication, so a power of a binary fraction is exact. */
const power = (x: number, n: number): number => {
  let out = 1;
  for (let k = 0; k < n; k++) out *= x;
  return out;
};
/** B_i of degree n at s: C(n, i) s^i (1 − s)^(n − i). */
const bernstein = (n: number, i: number, s: number): number => binomial(n, i) * power(s, i) * power(1 - s, n - i);

/** A box deform's params: the box, the grid's point counts along x, y and z, and one move per point, x fastest, then y, then z. */
export interface Box { from: V3; to: V3; points: [number, number, number]; moves: V3[] }
/** The index of grid point (i, j, k): x fastest, then y, then z. */
export const gridIndex = (points: readonly number[], i: number, j: number, k: number): number => i + points[0]! * (j + points[1]! * k);
/** One move per grid point, from `move(i, j, k)`, in the grid's order. */
export function gridMoves(points: [number, number, number], move: (i: number, j: number, k: number) => V3): V3[] {
  const out: V3[] = [];
  for (let k = 0; k < points[2]; k++) for (let j = 0; j < points[1]; j++) for (let i = 0; i < points[0]; i++) out.push(move(i, j, k));
  return out;
}
/** p's place in the box, each coordinate 0 at `from` and 1 at `to`. */
const inBox = (from: V3, to: V3, p: V3): V3 => [0, 1, 2].map((a) => (p[a]! - from[a]!) / (to[a]! - from[a]!)) as V3;
/** The sum over the grid's points of weight(i, j, k) × move_ijk. */
function gridSum(box: Box, weight: (i: number, j: number, k: number) => number, skip = -1): V3 {
  let out: V3 = ZERO;
  for (let k = 0; k < box.points[2]; k++) for (let j = 0; j < box.points[1]; j++) for (let i = 0; i < box.points[0]; i++) {
    const n = gridIndex(box.points, i, j, k);
    if (n !== skip) out = add(out, scale(box.moves[n]!, weight(i, j, k)));
  }
  return out;
}
const bernsteinWeight = (box: Box, [s, t, u]: V3) => (i: number, j: number, k: number): number =>
  bernstein(box.points[0] - 1, i, s) * bernstein(box.points[1] - 1, j, t) * bernstein(box.points[2] - 1, k, u);

/** How far the box deform moves a vertex at p: the sum of B_i(s) B_j(t) B_k(u) move_ijk (the issue's Scope). */
export const boxMove = (box: Box, p: V3): V3 => gridSum(box, bernsteinWeight(box, inBox(box.from, box.to, p)));

/** The wrong program of criterion 1: (s, t, u) measured over the item's own bounds instead of the box. */
export const boxMoveOwnBounds = (box: Box, p: V3, bounds: [V3, V3]): V3 => gridSum(box, bernsteinWeight(box, inBox(bounds[0], bounds[1], p)));

/** The wrong program of criterion 2: each grid point's weight is the trilinear hat of its cell (1 at the point, 0 one cell away). */
export function boxMoveTrilinear(box: Box, p: V3): V3 {
  const [s, t, u] = inBox(box.from, box.to, p);
  const hat = (cells: number, i: number, x: number): number => Math.max(0, 1 - Math.abs(x * cells - i));
  return gridSum(box, (i, j, k) => hat(box.points[0] - 1, i, s) * hat(box.points[1] - 1, j, t) * hat(box.points[2] - 1, k, u));
}

/** The wrong program of criterion 3: the Bernstein sum without the grid's last point. */
export const boxMoveDropsLast = (box: Box, p: V3): V3 => gridSum(box, bernsteinWeight(box, inBox(box.from, box.to, p)), box.moves.length - 1);

// ---------------------------------------------------------------------------------------------------
// The mesh deform: mean value coordinates for a closed triangle mesh (Ju, Schaefer and Warren 2005, Figure 4).

/** A control mesh: its points and its triangles, wound counter-clockwise seen from outside. */
export interface Cage { points: V3[]; triangles: Tri[] }

/**
 * x's mean value coordinates in the cage, one weight per point, summing to 1. For each triangle with unit
 * directions u1, u2, u3 from x to its corners: l_i = |u_(i+1) − u_(i−1)|, θ_i = 2 asin(l_i / 2), h = Σθ_i / 2,
 * c_i = 2 sin(h) sin(h − θ_i) / (sin θ_(i+1) sin θ_(i−1)) − 1, s_i = sign(det[u1, u2, u3]) √(1 − c_i²), and the
 * triangle adds (θ_i − c_(i+1) θ_(i−1) − c_(i−1) θ_(i+1)) / (d_i sin θ_(i+1) s_(i−1)) to corner i's weight. This
 * suite's vertices lie strictly inside their cages and off every triangle's plane, so the paper's two special
 * cases (x on a triangle, x in a triangle's plane outside it) never arise; for either this answers NaN weights,
 * which no judge accepts.
 */
export function meanValueWeights(x: V3, cage: Cage): number[] {
  const d = cage.points.map((p) => length(sub(p, x)));
  const u = cage.points.map((p, j) => scale(sub(p, x), 1 / d[j]!));
  const w = cage.points.map(() => 0);
  for (const tri of cage.triangles) {
    const at = (i: number): number => tri[i % 3]!;
    const l = [0, 1, 2].map((i) => length(sub(u[at(i + 1)]!, u[at(i + 2)]!)));
    const theta = l.map((v) => 2 * Math.asin(v / 2));
    const h = (theta[0]! + theta[1]! + theta[2]!) / 2;
    const c = [0, 1, 2].map((i) => (2 * Math.sin(h) * Math.sin(h - theta[i]!)) / (Math.sin(theta[(i + 1) % 3]!) * Math.sin(theta[(i + 2) % 3]!)) - 1);
    const det = dot(u[at(0)]!, cross(u[at(1)]!, u[at(2)]!));
    const s = c.map((ci) => Math.sign(det) * Math.sqrt(Math.max(0, 1 - ci * ci)));
    if (Math.PI - h < 1e-9 || s.some((si) => !(Math.abs(si) > 1e-9))) return cage.points.map(() => Number.NaN);
    for (let i = 0; i < 3; i++) {
      w[at(i)]! += (theta[i]! - c[(i + 1) % 3]! * theta[(i + 2) % 3]! - c[(i + 2) % 3]! * theta[(i + 1) % 3]!) / (d[at(i)]! * Math.sin(theta[(i + 1) % 3]!) * s[(i + 2) % 3]!);
    }
  }
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / total);
}

/** The wrong program of criterion 5: each point's weight is 1 ÷ its distance from x, over their sum. */
export function inverseDistanceWeights(x: V3, cage: Cage): number[] {
  const w = cage.points.map((p) => 1 / length(sub(p, x)));
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / total);
}

/** How far weights and moves carry a vertex: the sum of w_j × move_j. */
export const weightedMove = (weights: readonly number[], moves: readonly V3[]): V3 =>
  weights.reduce<V3>((sum, w, j) => add(sum, scale(moves[j]!, w)), ZERO);

// ---------------------------------------------------------------------------------------------------
// The control meshes.

/** Each triangle turned, where it must be, so its normal points away from `centre`. */
const outward = (points: readonly V3[], triangles: readonly Tri[], centre: V3): Tri[] => triangles.map(([a, b, c]) => {
  const n = cross(sub(points[b]!, points[a]!), sub(points[c]!, points[a]!));
  const mid = scale(add(add(points[a]!, points[b]!), points[c]!), 1 / 3);
  return dot(n, sub(mid, centre)) > 0 ? [a, b, c] : [a, c, b];
});

/** The octahedron's points, in this order. */
export const OCTA = { px: 0, nx: 1, py: 2, ny: 3, pz: 4, nz: 5 } as const;
/**
 * The octahedron with its 6 points `r` m out along each axis from `centre` (the +y one `ry` m out), in the order
 * +x, −x, +y, −y, +z, −z, and its 8 triangles, one per octant, wound outward.
 */
export function octahedron(centre: V3, r: number, ry = r): Cage {
  const points: V3[] = [[r, 0, 0], [-r, 0, 0], [0, ry, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]].map((o) => add(centre, o as V3));
  const triangles: Tri[] = [];
  for (const x of [OCTA.px, OCTA.nx]) for (const y of [OCTA.py, OCTA.ny]) for (const z of [OCTA.pz, OCTA.nz]) triangles.push([x, y, z]);
  return { points, triangles: outward(points, triangles, centre) };
}

/**
 * A bipyramid of `ring + 2` points around `centre`: a ring of `ring` points `r` m out in the plane y = centre's,
 * and one point `r` m above and one `r` m below; 2 × ring triangles, wound outward. Closed and manifold.
 */
export function bipyramid(centre: V3, ring: number, r: number): Cage {
  const points: V3[] = Array.from({ length: ring }, (_, k) => {
    const a = (2 * Math.PI * k) / ring;
    return add(centre, [r * Math.cos(a), 0, r * Math.sin(a)]);
  });
  points.push(add(centre, [0, r, 0]), add(centre, [0, -r, 0]));
  const triangles: Tri[] = [];
  for (let k = 0; k < ring; k++) triangles.push([k, (k + 1) % ring, ring], [k, (k + 1) % ring, ring + 1]);
  return { points, triangles: outward(points, triangles, centre) };
}

/**
 * How deep p lies inside a convex control mesh, in m: its distance to the nearest triangle's plane, negative when p is
 * outside that plane and 0 when it is on it. Every control mesh of this suite is convex.
 */
export function depthInside(cage: Cage, p: V3): number {
  return Math.min(...cage.triangles.map(([a, b, c]) => {
    const n = cross(sub(cage.points[b]!, cage.points[a]!), sub(cage.points[c]!, cage.points[a]!));
    return -dot(n, sub(p, cage.points[a]!)) / length(n);
  }));
}

// ---------------------------------------------------------------------------------------------------
// Meshes: volume and edges.

/** The volume a closed mesh holds, positive when it is wound outward (the divergence theorem). */
export function signedVolume(positions: readonly V3[], indices: readonly number[]): number {
  let six = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) six += dot(positions[indices[t]!]!, cross(positions[indices[t + 1]!]!, positions[indices[t + 2]!]!));
  return six / 6;
}

/** An edge by its two point indices, the lower first. */
export const edgeKey = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`);
/** How many triangles use each undirected edge of a control mesh, and how often each directed edge appears. */
function edgeUse(triangles: readonly Tri[]): { undirected: Map<string, number>; directed: Map<string, number> } {
  const undirected = new Map<string, number>();
  const directed = new Map<string, number>();
  for (const tri of triangles) for (let i = 0; i < 3; i++) {
    const [a, b] = [tri[i]!, tri[(i + 1) % 3]!];
    undirected.set(edgeKey(a, b), (undirected.get(edgeKey(a, b)) ?? 0) + 1);
    directed.set(`${a}>${b}`, (directed.get(`${a}>${b}`) ?? 0) + 1);
  }
  return { undirected, directed };
}
/** The open edges of a control mesh: those only one triangle uses, as sorted keys. */
export const openEdges = (triangles: readonly Tri[]): string[] => [...edgeUse(triangles).undirected].filter(([, n]) => n === 1).map(([k]) => k).sort();
/** What keeps a control mesh from being closed, manifold and wound one way round, holding `volume` > 0; empty when nothing does. */
export function cageProblems(cage: Cage): string[] {
  const { undirected, directed } = edgeUse(cage.triangles);
  const out = [...undirected].filter(([, n]) => n !== 2).map(([k, n]) => `edge ${k} is used by ${n} triangle(s), want 2`);
  out.push(...[...directed].filter(([, n]) => n !== 1).map(([k, n]) => `edge ${k} runs the same way in ${n} triangles`));
  const used = new Set(cage.triangles.flat());
  if (used.size !== cage.points.length) out.push(`${cage.points.length - used.size} point(s) are in no triangle`);
  if (!(signedVolume(cage.points, cage.triangles.flat()) > 0)) out.push('the mesh is not wound outward (its signed volume is not positive)');
  return out;
}
