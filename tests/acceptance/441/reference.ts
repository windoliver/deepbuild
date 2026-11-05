// The reviewed CPU references the #441 criteria are held to, written from the design's definitions alone
// (canvas primitives: Curve `curve@1`, its bspline mode and closed frames, Builder `extrude`: sweep along a
// curve): cubic spans in Bézier form, a uniform cubic B-spline converted to them, arc length by composite
// Gauss-Legendre quadrature, u (a fraction of arc length) solved to a span and its parameter, the second
// derivative in u, rotation-minimizing frames by double reflection on a dense grid, welding, edge topology and
// volume by the divergence theorem. Nothing here reads the program; no vitest import, so it runs on its own.

export type V3 = [number, number, number];
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
/** The signed angle from `a` to `b` about `axis` (right-handed), in (−π, π]. */
export const angleAbout = (a: V3, b: V3, axis: V3): number => Math.atan2(dot(cross(a, b), unit(axis)), dot(a, b));
/** `a` with its part along unit `t` taken out, normalized. */
export const perpendicular = (a: V3, t: V3): V3 => unit(sub(a, scale(t, dot(a, t))));
export const fmt = (x: number): string => String(Number(x.toPrecision(12)));
export const fmtV = (v: V3): string => `(${v.map(fmt).join(', ')})`;

// ---------------------------------------------------------------------------------------------------
// Cubic spans in Bézier form.

export type Bez = [V3, V3, V3, V3];
export function bezPoint(b: Bez, t: number): V3 {
  const s = 1 - t;
  return add(add(scale(b[0], s * s * s), scale(b[1], 3 * s * s * t)), add(scale(b[2], 3 * s * t * t), scale(b[3], t * t * t)));
}
export function bezD1(b: Bez, t: number): V3 {
  const s = 1 - t;
  return add(add(scale(sub(b[1], b[0]), 3 * s * s), scale(sub(b[2], b[1]), 6 * s * t)), scale(sub(b[3], b[2]), 3 * t * t));
}
export function bezD2(b: Bez, t: number): V3 {
  const p = add(sub(b[2], scale(b[1], 2)), b[0]);
  const q = add(sub(b[3], scale(b[2], 2)), b[1]);
  return add(scale(p, 6 * (1 - t)), scale(q, 6 * t));
}

/** curve@1 `mode: bezier`: span k runs from point k by its `out` handle and point k + 1's `in` handle (both relative to their point). */
export function bezierSpans(points: V3[], handlesIn: V3[], handlesOut: V3[]): Bez[] {
  const out: Bez[] = [];
  for (let k = 0; k + 1 < points.length; k++) {
    out.push([points[k]!, add(points[k]!, handlesOut[k]!), add(points[k + 1]!, handlesIn[k + 1]!), points[k + 1]!]);
  }
  return out;
}

/**
 * curve@1 `mode: bspline`, open (Curve `curve@1`: bspline mode): a uniform cubic B-spline whose end points are
 * repeated three times, so it starts and ends on them. Control sequence C = [P0, P0, P0, P1, …, Pn−1, Pn−1, Pn−1];
 * span i uses C[i … i + 3]; n points give n + 1 spans; point k (0 < k < n − 1) is C[k + 2] and touches spans
 * k − 1 … k + 2. Each span in Bézier form: (C0 + 4C1 + C2)/6, (4C1 + 2C2)/6, (2C1 + 4C2)/6, (C1 + 4C2 + C3)/6.
 */
export function bsplineOpenSpans(points: V3[]): Bez[] {
  const n = points.length;
  const c: V3[] = [points[0]!, points[0]!, ...points, points[n - 1]!, points[n - 1]!];
  const out: Bez[] = [];
  for (let i = 0; i + 3 < c.length; i++) {
    const [c0, c1, c2, c3] = [c[i]!, c[i + 1]!, c[i + 2]!, c[i + 3]!];
    out.push([
      scale(add(add(c0, scale(c1, 4)), c2), 1 / 6),
      scale(add(scale(c1, 4), scale(c2, 2)), 1 / 6),
      scale(add(scale(c1, 2), scale(c2, 4)), 1 / 6),
      scale(add(add(c1, scale(c2, 4)), c3), 1 / 6),
    ]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Arc length and u.

const GL_X = [-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664];
const GL_W = [0.23692688505618908, 0.47862867049936647, 0.5688888888888889, 0.47862867049936647, 0.23692688505618908];

/** A piecewise cubic curve and its arc length (composite 5-point Gauss-Legendre: far below 1e-12 m here). */
export class RefCurve {
  readonly spans: Bez[];
  readonly lens: number[];
  readonly starts: number[];
  readonly L: number;
  constructor(spans: Bez[]) {
    this.spans = spans;
    this.lens = spans.map((_, k) => this.arc(k, 0, 1, 512));
    this.starts = [];
    let s = 0;
    for (const l of this.lens) { this.starts.push(s); s += l; }
    this.L = s;
  }
  /** Arc length of span k from t = a to t = b. */
  arc(k: number, a: number, b: number, pieces = 128): number {
    const span = this.spans[k]!;
    let s = 0;
    for (let i = 0; i < pieces; i++) {
      const x0 = a + ((b - a) * i) / pieces;
      const x1 = a + ((b - a) * (i + 1)) / pieces;
      for (let j = 0; j < 5; j++) s += ((GL_W[j]! * (x1 - x0)) / 2) * length(bezD1(span, (x0 + x1) / 2 + ((x1 - x0) / 2) * GL_X[j]!));
    }
    return s;
  }
  /** The span and parameter at arc length s (bisection-guarded Newton on the exact arc length). */
  locateS(s: number): { span: number; t: number } {
    let k = this.spans.length - 1;
    for (let i = 0; i < this.spans.length; i++) if (s < this.starts[i]! + this.lens[i]!) { k = i; break; }
    const want = Math.min(Math.max(s - this.starts[k]!, 0), this.lens[k]!);
    let lo = 0;
    let hi = 1;
    let t = want / this.lens[k]!;
    for (let it = 0; it < 100; it++) {
      const f = this.arc(k, 0, t) - want;
      if (Math.abs(f) <= 1e-15 * this.L) break;
      if (f > 0) hi = t; else lo = t;
      const d = length(bezD1(this.spans[k]!, t));
      const next = d > 1e-12 ? t - f / d : NaN;
      t = next > lo && next < hi ? next : (lo + hi) / 2;
      if (hi - lo < 1e-17) break;
    }
    return { span: k, t };
  }
  locate(u: number): { span: number; t: number } { return this.locateS(u * this.L); }
  point(u: number): V3 { const { span, t } = this.locate(u); return bezPoint(this.spans[span]!, t); }
  tangent(u: number): V3 { const { span, t } = this.locate(u); return unit(bezD1(this.spans[span]!, t)); }
  /** d²P/du² with u the fraction of arc length: L² (P'' − (P''·T)T) / |P'|², the parameter t's derivatives P', P''. */
  accelAt(span: number, t: number): V3 {
    const d1 = bezD1(this.spans[span]!, t);
    const d2 = bezD2(this.spans[span]!, t);
    const T = unit(d1);
    return scale(sub(d2, scale(T, dot(d2, T))), (this.L * this.L) / dot(d1, d1));
  }
  accel(u: number): V3 { const { span, t } = this.locate(u); return this.accelAt(span, t); }
  /** Arc length from the start to span k's start (k = spans.length gives L). */
  knotS(k: number): number { return k >= this.spans.length ? this.L : this.starts[k]!; }
}

/**
 * Rotation-minimizing frames along `curve` by double reflection (Wang, Jüttler, Zheng and Liu, 2008) on a grid of
 * `perSpan` steps per span, started from `normal0` at u = 0. The frame at any u is one more double-reflection step
 * from the grid point before it. With 4,000 steps per span the grid's own error is far below 1e-9 rad here.
 */
export class RefRmf {
  private readonly curve: RefCurve;
  private readonly perSpan: number;
  private readonly P: V3[] = [];
  private readonly T: V3[] = [];
  private readonly R: V3[] = [];
  constructor(curve: RefCurve, normal0: V3, perSpan = 4000) {
    this.curve = curve;
    this.perSpan = perSpan;
    curve.spans.forEach((span) => {
      for (let i = 0; i < perSpan; i++) { const t = i / perSpan; this.P.push(bezPoint(span, t)); this.T.push(unit(bezD1(span, t))); }
    });
    const last = curve.spans[curve.spans.length - 1]!;
    this.P.push(bezPoint(last, 1));
    this.T.push(unit(bezD1(last, 1)));
    let r = perpendicular(normal0, this.T[0]!);
    this.R.push(r);
    for (let i = 0; i + 1 < this.P.length; i++) { r = reflectStep(this.P[i]!, this.T[i]!, r, this.P[i + 1]!, this.T[i + 1]!); this.R.push(r); }
  }
  /** The rotation-minimizing normal and the unit tangent at u. */
  at(u: number): { normal: V3; tangent: V3 } {
    const { span, t } = this.curve.locate(u);
    const g = Math.min(span * this.perSpan + Math.floor(t * this.perSpan), this.P.length - 1);
    const p = bezPoint(this.curve.spans[span]!, t);
    const tan = unit(bezD1(this.curve.spans[span]!, t));
    if (dist(p, this.P[g]!) < 1e-15) return { normal: this.R[g]!, tangent: tan };
    return { normal: reflectStep(this.P[g]!, this.T[g]!, this.R[g]!, p, tan), tangent: tan };
  }
}
function reflectStep(x0: V3, t0: V3, r0: V3, x1: V3, t1: V3): V3 {
  const v1 = sub(x1, x0);
  const c1 = dot(v1, v1);
  const rL = sub(r0, scale(v1, (2 * dot(v1, r0)) / c1));
  const tL = sub(t0, scale(v1, (2 * dot(v1, t0)) / c1));
  const v2 = sub(t1, tL);
  const c2 = dot(v2, v2);
  return c2 < 1e-300 ? rL : sub(rL, scale(v2, (2 * dot(v2, rL)) / c2));
}

// ---------------------------------------------------------------------------------------------------
// Meshes: welding, edges, Euler characteristic and volume (as #420's suite reads them).

/** Welding: positions equal to 1e-6 m (by rounding to a 1e-6 m grid) are one point. */
export const WELD = 1e-6;
export const weldKey = (p: V3): string => p.map((x) => Math.round(x / WELD)).join(',');
export function weld(positions: V3[]): { ids: number[]; points: V3[] } {
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
/** Every triangle of `indices` as welded point IDs, degenerate ones (two equal welded corners) left out. */
export function weldedTriangles(indices: number[], ids: number[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = ids[indices[t]!]!; const b = ids[indices[t + 1]!]!; const c = ids[indices[t + 2]!]!;
    if (a === b || b === c || c === a) continue;
    out.push([a, b, c]);
  }
  return out;
}
export interface Topology { V: number; E: number; F: number; open: number; nonManifold: number; misoriented: number }
/** V, E and F of a triangle set, and its edges used once (open), more than twice, or twice the same way. */
export function topology(tris: [number, number, number][]): Topology {
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
/** The signed volume a closed, outward-wound triangle set encloses (divergence theorem). */
export function volumeOf(points: V3[], tris: [number, number, number][]): number {
  let s = 0;
  for (const [a, b, c] of tris) s += dot(points[a]!, cross(points[b]!, points[c]!)) / 6;
  return s;
}
