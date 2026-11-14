// The tests' own f64 geometry (README: Expected values): a camera pose's ray through a pointer position and a point's
// pixel, a ray against a level plane, a triangle, a terrain plate's height-field triangles and a segment, and a point
// in a quad. It follows the design's conventions (canvas primitives: Units and axes; Camera `camera@1`): metres, +Y up,
// right-handed; an orbit's eye at target + distance (cos el sin az, sin el, cos el cos az); screen right and up from
// the forward axis and +Y (straight down keeps +X as right); a perspective field of view across the wider side of the
// frame, an orthographic view width across its width; pixel y down from the top. Nothing here reads the program under
// test: every expected number in this suite comes from these functions, the issue's text and the fixtures' own values.

export type V3 = [number, number, number];
export type V2 = [number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.sqrt(dot(a, a));
export const unit = (a: V3): V3 => mul(a, 1 / len(a));
export const rad = (deg: number): number => (deg * Math.PI) / 180;
/** The largest per-component difference. */
export const off = (a: readonly number[], b: readonly number[]): number => Math.max(...a.map((x, i) => Math.abs(x - (b[i] ?? NaN))));
/** Rounded to 1/1024 m, as the design stores a ground or surface point. */
export const round1024 = (a: V3): V3 => a.map((x) => Math.round(x * 1024) / 1024) as V3;
export const STEP_1024 = 1 / 1024;
export const fmt = (a: readonly number[], d = 4): string => `(${a.map((x) => x.toFixed(d)).join(', ')})`;

/** A camera as a frame of `size` px shows it: perspective with `fov` degrees across the wider side, or orthographic with `viewWidth` m across the width and its ray origins on the plane `near` m ahead of the eye. */
export interface Pose { eye: V3; target: V3; size: V2; fov?: number; viewWidth?: number; near?: number }
export interface Ray { origin: V3; dir: V3 }

export function basis(p: Pose): { right: V3; up: V3; forward: V3 } {
  const forward = unit(sub(p.target, p.eye));
  let right = cross(forward, [0, 1, 0]);
  right = len(right) === 0 ? [1, 0, 0] : unit(right);
  return { right, up: cross(right, forward), forward };
}
const focal = (p: Pose): number => Math.max(p.size[0], p.size[1]) / 2 / Math.tan(rad(p.fov!) / 2);
const perspective = (p: Pose): boolean => (p.fov ?? 0) > 0;

/** The ray through the pointer at frame px (x, y): from the eye, or from the near plane for an orthographic camera, along its unit direction. */
export function rayAt(p: Pose, [x, y]: V2): Ray {
  const { right, up, forward } = basis(p);
  const dx = x - p.size[0] / 2, dy = y - p.size[1] / 2;
  if (perspective(p)) {
    const f = focal(p);
    return { origin: p.eye, dir: unit(add(add(mul(right, dx / f), mul(up, -dy / f)), forward)) };
  }
  const s = p.size[0] / p.viewWidth!;
  return { origin: add(add(add(p.eye, mul(right, dx / s)), mul(up, -dy / s)), mul(forward, p.near ?? 0)), dir: forward };
}
/** Where a world point lands, in frame px, or null at or behind a perspective eye. */
export function project(p: Pose, q: V3): V2 | null {
  const { right, up, forward } = basis(p);
  const d = sub(q, p.eye);
  const [vx, vy, vz] = [dot(d, right), dot(d, up), dot(d, forward)];
  if (perspective(p)) {
    if (vz <= 0) return null;
    const f = focal(p) / vz;
    return [p.size[0] / 2 + vx * f, p.size[1] / 2 - vy * f];
  }
  const s = p.size[0] / p.viewWidth!;
  return [p.size[0] / 2 + vx * s, p.size[1] / 2 - vy * s];
}
/** An orbit's eye: target + distance (cos el sin az, sin el, cos el cos az), degrees. */
export const orbitEye = (target: V3, distance: number, az: number, el: number): V3 =>
  add(target, mul([Math.cos(rad(el)) * Math.sin(rad(az)), Math.sin(rad(el)), Math.cos(rad(el)) * Math.cos(rad(az))], distance));
export const along = (r: Ray, k: number): V3 => add(r.origin, mul(r.dir, k));

/** Where the ray meets the level plane y = h ahead of its origin, or null (parallel, or only behind it). */
export function meetPlane(r: Ray, h: number): V3 | null {
  if (r.dir[1] === 0) return null;
  const k = (h - r.origin[1]) / r.dir[1];
  return k > 0 ? along(r, k) : null;
}
/** Where the whole line through the ray meets the plane y = h, behind its origin too: the planted ray test's answer. */
export function meetLine(r: Ray, h: number): V3 | null {
  if (r.dir[1] === 0) return null;
  return along(r, (h - r.origin[1]) / r.dir[1]);
}

/** The distance along the ray to triangle `t` (either face), Möller–Trumbore in f64, or null. */
export function meetTriangle(r: Ray, t: readonly [V3, V3, V3]): number | null {
  const e1 = sub(t[1], t[0]), e2 = sub(t[2], t[0]);
  const p = cross(r.dir, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-300) return null;
  const inv = 1 / det;
  const s = sub(r.origin, t[0]);
  const u = dot(s, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = cross(s, e1);
  const v = dot(r.dir, q) * inv;
  if (v < 0 || u + v > 1) return null;
  const k = dot(e2, q) * inv;
  return k > 0 ? k : null;
}

/** A terrain plate centred on the origin: `size` m, `spacing` m between samples, its height field `h(x, z)`. */
export interface Plate { size: V2; spacing: number; h: (x: number, z: number) => number }
/** Sample (c, r): c along +x from the −x edge, r along +z from the −z edge. */
export function sample(t: Plate, c: number, r: number): V3 {
  const x = -t.size[0] / 2 + c * t.spacing, z = -t.size[1] / 2 + r * t.spacing;
  return [x, t.h(x, z), z];
}
/**
 * Cell (c, r)'s two triangles as the plate's height-field collision splits it, along the diagonal from its (c, r + 1)
 * sample to its (c + 1, r) one (the base's terrain plate, #2014: deep_canvas::heights).
 */
export function cellTriangles(t: Plate, c: number, r: number): [[V3, V3, V3], [V3, V3, V3]] {
  const p00 = sample(t, c, r), p01 = sample(t, c, r + 1), p10 = sample(t, c + 1, r), p11 = sample(t, c + 1, r + 1);
  return [[p00, p01, p10], [p01, p11, p10]];
}
/** The ray's nearest hit on every height-field triangle of the plate, or null. */
export function meetPlate(t: Plate, r: Ray): V3 | null {
  const [nc, nr] = [Math.round(t.size[0] / t.spacing), Math.round(t.size[1] / t.spacing)];
  let best = Infinity;
  for (let c = 0; c < nc; c++) for (let rr = 0; rr < nr; rr++) for (const tri of cellTriangles(t, c, rr)) {
    const k = meetTriangle(r, tri);
    if (k !== null && k < best) best = k;
  }
  return best < Infinity ? along(r, best) : null;
}

/** The point of segment AB nearest the ray (closest points of a segment and a ray, in f64). */
export function nearestOnSegment(a: V3, b: V3, r: Ray): V3 {
  const ab = sub(b, a);
  const w = sub(a, r.origin);
  const [aa, ad, dd, aw, dw] = [dot(ab, ab), dot(ab, r.dir), dot(r.dir, r.dir), dot(ab, w), dot(r.dir, w)];
  const den = aa * dd - ad * ad;
  let s = den === 0 ? 0 : (ad * dw - dd * aw) / den;
  s = Math.min(1, Math.max(0, s));
  const t = Math.max(0, dot(sub(add(a, mul(ab, s)), r.origin), r.dir) / dd);
  s = Math.min(1, Math.max(0, dot(sub(along(r, t), a), ab) / aa));
  return add(a, mul(ab, s));
}

/** Whether (x, z) lies inside the polygon of `corners`' x and z (the crossing rule). */
export function insideXZ(corners: readonly V3[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const [xi, , zi] = corners[i]!, [xj, , zj] = corners[j]!;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** The distance from (x, z) to the polygon's nearest edge, in x and z. */
export function edgeDistanceXZ(corners: readonly V3[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const a: V3 = [corners[j]![0], 0, corners[j]![2]], b: V3 = [corners[i]![0], 0, corners[i]![2]];
    const ab = sub(b, a), ap = sub([x, 0, z], a);
    const s = Math.min(1, Math.max(0, dot(ap, ab) / dot(ab, ab)));
    best = Math.min(best, len(sub([x, 0, z], add(a, mul(ab, s)))));
  }
  return best;
}
/** The screen rectangle's corners from the press corner, clockwise on screen (y down). */
export function rectCorners(press: V2, release: V2): [V2, V2, V2, V2] {
  const [x0, y0] = press, [x1, y1] = release;
  // Clockwise on a y-down screen: rightward along the top edge, down the right one, back along the bottom.
  const clockwise = (x1 - x0) * (y1 - y0) > 0;
  return clockwise ? [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] : [[x0, y0], [x0, y1], [x1, y1], [x1, y0]];
}
