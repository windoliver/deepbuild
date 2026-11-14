// The #485 suite's CPU references, in f64, from geometry alone: nothing here is taken from the renderer. #378's pinhole
// (position, target, +Y up, fov across the wider side, pixel (x, y)'s centre at (x + 0.5, y + 0.5)); the transform
// order R = Rz·Ry·Rx in degrees (Units and axes), by which a sun shining along its own −Z is aimed; a ray against a
// sphere and against a box. From these: which pixels of AC2's cel sphere lie in the post's shadow, well inside it, and
// how lit they would be without it; and how far the eye's direction turns from AC6's sphere's normal on the pixels
// within 2 px of its outline. No vitest import, so it runs on its own (BASE-FAILURE.txt).

export type V3 = [number, number, number];

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
export const rad = (d: number): number => (d * Math.PI) / 180;

/** R = Rz·Ry·Rx (degrees) applied to `v` (Units and axes). */
export function rotate(rot: V3, v: V3): V3 {
  const [cx, sx] = [Math.cos(rad(rot[0])), Math.sin(rad(rot[0]))];
  const [cy, sy] = [Math.cos(rad(rot[1])), Math.sin(rad(rot[1]))];
  const [cz, sz] = [Math.cos(rad(rot[2])), Math.sin(rad(rot[2]))];
  const x1: V3 = [v[0], cx * v[1] - sx * v[2], sx * v[1] + cx * v[2]];
  const y1: V3 = [cy * x1[0] + sy * x1[2], x1[1], -sy * x1[0] + cy * x1[2]];
  return [cz * y1[0] - sz * y1[1], sz * y1[0] + cz * y1[1], y1[2]];
}
/** The unit direction toward a sun aimed by `rot` (it shines along its own −Z). */
export const towardSun = (rot: V3): V3 => scale(rotate(rot, [0, 0, -1]), -1);

/** #378's pinhole: position, target, +Y up, fov (degrees) across the wider side, the frame `size` in px. */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
/** The camera's frame: forward, right, up, and the focal length in px. */
export function basis(cam: Pinhole): { f: V3; r: V3; u: V3; focal: number } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f), focal: Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2) };
}
/** The unit ray through frame point (sx, sy) in px. */
export function rayAt(cam: Pinhole, sx: number, sy: number): V3 {
  const { f, r, u, focal } = basis(cam);
  return unit(add(add(f, scale(r, (sx - cam.size[0] / 2) / focal)), scale(u, -(sy - cam.size[1] / 2) / focal)));
}
/** A world direction in view space: x right, y up, z toward the eye (the camera looks down −z). */
export function toView(cam: Pinhole, d: V3): V3 {
  const { f, r, u } = basis(cam);
  return [dot(d, r), dot(d, u), -dot(d, f)];
}

/** The nearest positive distance along unit ray (o, d) to the sphere (c, radius), or null. */
export function hitSphere(o: V3, d: V3, c: V3, radius: number): number | null {
  const oc = sub(o, c); const b = dot(oc, d); const q = dot(oc, oc) - radius * radius;
  const disc = b * b - q;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t = -b - s > 1e-9 ? -b - s : -b + s > 1e-9 ? -b + s : null;
  return t;
}
/** Whether ray (o, d) meets the axis-aligned box of `size` centred at `c` at a positive distance. */
export function hitsBox(o: V3, d: V3, c: V3, size: V3): boolean {
  let t0 = -Infinity; let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const h = size[k]! / 2; const lo = o[k]! - c[k]!;
    if (Math.abs(d[k]!) < 1e-12) { if (Math.abs(lo) > h) return false; continue; }
    let a = (-h - lo) / d[k]!; let b = (h - lo) / d[k]!;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
  }
  return t0 <= t1 && t1 > 0;
}

// ---------------------------------------------------------------------------------------------------
// AC2: the cel sphere and the post's shadow.

export interface CelScene { cam: Pinhole; centre: V3; radius: number; toSun: V3; post: { centre: V3; size: V3 } }
/** Per pixel, row-major: whether its centre's ray meets the sphere, n · l there (NaN where it misses), and whether the
 * ray from that point toward the sun meets the post shrunk by `margin` on every side: deep in the post's shadow, past
 * any penumbra, filter or bias. */
export interface CelPixels { width: number; height: number; ndl: Float64Array; umbra: Uint8Array }
export function celPixels(s: CelScene, margin: number): CelPixels {
  const [w, h] = s.cam.size;
  const ndl = new Float64Array(w * h).fill(Number.NaN);
  const umbra = new Uint8Array(w * h);
  const shrunk: V3 = [s.post.size[0] - 2 * margin, s.post.size[1] - 2 * margin, s.post.size[2] - 2 * margin];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = rayAt(s.cam, x + 0.5, y + 0.5);
    const t = hitSphere(s.cam.position, d, s.centre, s.radius);
    if (t === null) continue;
    const p = add(s.cam.position, scale(d, t));
    const n = unit(sub(p, s.centre));
    ndl[y * w + x] = dot(n, s.toSun);
    if (hitsBox(add(p, scale(n, 1e-6)), s.toSun, s.post.centre, shrunk)) umbra[y * w + x] = 1;
  }
  return { width: w, height: h, ndl, umbra };
}

// ---------------------------------------------------------------------------------------------------
// AC5 and AC6: the sphere seen from its orbit.

/** The view-space normal of the sphere at pixel (x, y)'s centre, or null where its ray misses. */
export function viewNormalAt(cam: Pinhole, centre: V3, radius: number, x: number, y: number): V3 | null {
  const d = rayAt(cam, x + 0.5, y + 0.5);
  const t = hitSphere(cam.position, d, centre, radius);
  if (t === null) return null;
  return toView(cam, unit(sub(add(cam.position, scale(d, t)), centre)));
}
/** The standard 4× sample positions (Metal's and Direct3D's), as offsets from a pixel's centre in px. */
export const SAMPLES_4X: [number, number][] = [[-0.125, -0.375], [0.375, -0.125], [-0.375, 0.125], [0.125, 0.375]];
/** Over the pixels the object-ID target gives the sphere (#1173: a pixel takes the item any of its four samples
 * covers) whose 3 × 3 block is all the sphere's and whose 5 × 5 block holds a pixel none of whose samples meets it
 * (interior, within 2 px of the outline), the largest n · v at the pixel's centre, v toward the eye, and how many. */
export function rimReach(cam: Pinhole, centre: V3, radius: number): { max: number; count: number } {
  const [w, h] = cam.size;
  const hit = new Uint8Array(w * h);
  const ndv = new Float64Array(w * h).fill(Number.NaN);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (SAMPLES_4X.some(([ox, oy]) => hitSphere(cam.position, rayAt(cam, x + 0.5 + ox, y + 0.5 + oy), centre, radius) !== null)) hit[y * w + x] = 1;
    const d = rayAt(cam, x + 0.5, y + 0.5);
    const t = hitSphere(cam.position, d, centre, radius);
    if (t !== null) ndv[y * w + x] = dot(unit(sub(add(cam.position, scale(d, t)), centre)), scale(d, -1));
  }
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : hit[y * w + x]!);
  const all = (x: number, y: number, r: number): boolean => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (!at(x + dx, y + dy)) return false; return true; };
  let max = -Infinity; let count = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!all(x, y, 1) || all(x, y, 2)) continue;
    count++;
    max = Math.max(max, ndv[y * w + x]!);
  }
  return { max, count };
}
