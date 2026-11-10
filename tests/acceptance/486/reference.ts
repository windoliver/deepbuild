// The CPU references #486's criteria hold the renderer to, in f64, from published forms; nothing here is taken from
// the renderer. It imports no vitest, so it runs on its own (BASE-FAILURE.txt).
//
// - The camera and the sun as #378 and #421 define them (copied from #428's reference.ts, since suites don't import
//   each other): a pinhole whose fov spans the wider side, +Y up; a sun shining along its own −Z, aimed by `at.rot`
//   (degrees, about X, then Y, then Z).
// - AC4: the analytic normal of a height field, and a Lambertian surface's normal recovered from three suns
//   (photometric stereo: L_k = ρE/π · n·l_k, so n ∝ M⁻¹·L with M's rows the three directions toward the suns).
// - AC5: the two specular lobes of a coated plate under one sun, each by its published form: the base lobe is glTF 2.0
//   Appendix B's GGX with height-correlated Smith visibility and Schlick's Fresnel, α = roughness²; the coat is
//   KHR_materials_clearcoat's layer, the same microfacet lobe at α = coat_roughness² about the coat's own normal, F0
//   0.04, over the base dimmed by 1 − coat · F(v·n_coat). Each lobe's peak is read the same way from the reference and
//   from the frame (`peakRow`), and its place is the half vector's angle at that row (`halfAngle`).

export type V3 = [number, number, number];

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => { const l = length(a); return [a[0] / l, a[1] / l, a[2] / l]; };
export const rad = (d: number): number => (d * Math.PI) / 180;
export const deg = (r: number): number => (r * 180) / Math.PI;
/** The angle between two directions, in degrees. */
export const angleDeg = (a: V3, b: V3): number => deg(Math.acos(Math.min(1, Math.max(-1, dot(unit(a), unit(b))))));

/** `v` turned by `rot` (degrees): about X, then Y, then Z, as an item's `at.rot` turns it (Rz · Ry · Rx). */
export function rotate(rot: V3, v: V3): V3 {
  const [cx, sx] = [Math.cos(rad(rot[0])), Math.sin(rad(rot[0]))];
  const [cy, sy] = [Math.cos(rad(rot[1])), Math.sin(rad(rot[1]))];
  const [cz, sz] = [Math.cos(rad(rot[2])), Math.sin(rad(rot[2]))];
  const x1: V3 = [v[0], cx * v[1] - sx * v[2], sx * v[1] + cx * v[2]];
  const y1: V3 = [cy * x1[0] + sy * x1[2], x1[1], -sy * x1[0] + cy * x1[2]];
  return [cz * y1[0] - sz * y1[1], sz * y1[0] + cz * y1[1], y1[2]];
}
/** The direction toward a sun aimed by `rot` (it shines along its own −Z). */
export const towardSun = (rot: V3): V3 => scale(rotate(rot, [0, 0, -1]), -1);

/** #378's pinhole: position, target, +Y up, fov across the wider side. */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
function basis(cam: Pinhole): { f: V3; r: V3; u: V3; focal: number } {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  return { f, r, u: cross(r, f), focal: Math.max(...cam.size) / 2 / Math.tan(rad(cam.fov) / 2) };
}
/** The unit ray through frame point (px, py), pixel corners at integers (a pixel's centre is x + 0.5). */
export function rayAt(cam: Pinhole, px: number, py: number): V3 {
  const { f, r, u, focal } = basis(cam);
  return unit(add(add(f, scale(r, (px - cam.size[0] / 2) / focal)), scale(u, -(py - cam.size[1] / 2) / focal)));
}
/** Where a world point lands in the frame (pixel corners at integers). */
export function project(cam: Pinhole, p: V3): [number, number] {
  const { f, r, u, focal } = basis(cam);
  const d = sub(p, cam.position); const z = dot(d, f);
  return [cam.size[0] / 2 + (focal * dot(d, r)) / z, cam.size[1] / 2 - (focal * dot(d, u)) / z];
}
/** Where the ray from the camera through frame point (px, py) meets the plane z = `z`. */
export function onPlane(cam: Pinhole, px: number, py: number, z: number): V3 {
  const d = rayAt(cam, px, py);
  const t = (z - cam.position[2]) / d[2];
  return add(cam.position, scale(d, t));
}

// ---------------------------------------------------------------------------------------------------
// AC4: relief from a height graph, and the normal a Lambertian frame shades with.

/** The normal of a plate facing +Z whose +v runs along world +Y, raised by `slope` metres a metre along v: tilted toward
 * −v by atan(slope) (atan 0.2 = 11.31°). */
export const reliefNormal = (slope: number): V3 => unit([0, -slope, 1]);

/** The solution of the 3 × 3 system M·x = b (rows of M given), by Cramer's rule. */
export function solve3(m: [V3, V3, V3], b: V3): V3 {
  const det = (a: [V3, V3, V3]): number => dot(a[0], cross(a[1], a[2]));
  const d = det(m);
  const col = (k: number): [V3, V3, V3] => m.map((row, i) => row.map((x, j) => (j === k ? b[i]! : x)) as V3) as [V3, V3, V3];
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}
/** A Lambertian surface's normal from its radiance under three suns (photometric stereo): `toward` the directions to
 * the suns, `radiance` what it reads under each alone. The albedo and the illuminance cancel when it's made unit. */
export const lambertNormal = (toward: [V3, V3, V3], radiance: V3): V3 => unit(solve3(toward, radiance));

// ---------------------------------------------------------------------------------------------------
// AC5: a coated plate's two specular lobes under one sun.

/** GGX's distribution at n·h for α (glTF 2.0 Appendix B). */
export function ggxD(nh: number, a: number): number { const a2 = a * a; const d = nh * nh * (a2 - 1) + 1; return a2 / (Math.PI * d * d); }
/** Height-correlated Smith visibility V = G ÷ (4 n·l n·v) (glTF 2.0 Appendix B). */
export function smithV(nl: number, nv: number, a: number): number {
  const a2 = a * a;
  return 0.5 / (nl * Math.sqrt(nv * nv * (1 - a2) + a2) + nv * Math.sqrt(nl * nl * (1 - a2) + a2));
}
export const schlick = (f0: number, f90: number, c: number): number => f0 + (f90 - f0) * Math.pow(Math.max(0, 1 - c), 5);

/** A coated plate: its base lobe a metal of `baseF0` per channel at `roughness` about `n`, under a coat of weight
 * `coat` at `coatRoughness` about `coatN`. */
export interface Coated { n: V3; coatN: V3; roughness: number; coatRoughness: number; coat: number; baseF0: V3 }
/** Each lobe's radiance (per unit illuminance) toward the eye along `v` from a sun toward `l`: the coat's (no color),
 * and the base lobe's red minus green (the coat cancels there; a red metal's lobe doesn't). */
export function lobes(m: Coated, v: V3, l: V3): { coat: number; baseRedMinusGreen: number } {
  const h = unit(add(v, l)); const vh = Math.max(dot(v, h), 0);
  const ac = m.coatRoughness * m.coatRoughness; const ab = m.roughness * m.roughness;
  const cnl = Math.max(dot(m.coatN, l), 1e-4); const cnv = Math.max(dot(m.coatN, v), 1e-4);
  const coat = m.coat * ggxD(Math.max(dot(m.coatN, h), 0), ac) * smithV(cnl, cnv, ac) * schlick(0.04, 1, vh) * cnl;
  const nl = Math.max(dot(m.n, l), 1e-4); const nv = Math.max(dot(m.n, v), 1e-4);
  const under = 1 - m.coat * schlick(0.04, 1, cnv);
  const lobe = ggxD(Math.max(dot(m.n, h), 0), ab) * smithV(nl, nv, ab) * nl * under;
  return { coat, baseRedMinusGreen: lobe * (schlick(m.baseF0[0], 1, vh) - schlick(m.baseF0[1], 1, vh)) };
}
/** The signed angle of the half vector between the eye (from the plate point under frame point (px, py)) and the sun,
 * from the plate's normal +Z, in the Y–Z plane, positive toward +Y: where a lobe peaks, its own normal's tilt. */
export function halfAngle(cam: Pinhole, px: number, py: number, z: number, l: V3): number {
  const p = onPlane(cam, px, py, z);
  const h = unit(add(unit(sub(cam.position, p)), l));
  return deg(Math.atan2(h[1], h[2]));
}

/** A profile's peak, as a fractional row: the centroid of the run of rows around its largest value that hold at least
 * 90% of it, each weighted by its value. The same reader for the frame and the reference. */
export function peakRow(values: readonly number[]): number {
  let at = 0;
  for (let i = 1; i < values.length; i++) if (values[i]! > values[at]!) at = i;
  const top = values[at]!; const floor = 0.9 * top;
  let lo = at; let hi = at;
  while (lo > 0 && values[lo - 1]! >= floor) lo--;
  while (hi < values.length - 1 && values[hi + 1]! >= floor) hi++;
  let w = 0; let s = 0;
  for (let i = lo; i <= hi; i++) { w += values[i]!; s += values[i]! * i; }
  return s / w;
}
