// The #1634 suite's CPU references, in f64, from geometry and the design's formulas alone: nothing here is taken from
// the renderer. #378's pinhole (position, target, +Y up, fov across the wider side, pixel (x, y)'s centre at
// (x + 0.5, y + 0.5)) and the orbit rig (eye = target + distance · (cos el · sin az, sin el, cos el · cos az)); a point
// lamp's illuminance (lm ÷ 4π candela, inverse square, the cosine, the window (1 − (d ÷ range)⁴)²) and a matte's
// radiance under it; the light policy's score, its eight buckets a stop, its order (score bucket, then ID), its cut
// and its 10% margin's ramp, per view at 32 and per cluster at `per_cluster`; an automatic range's cut from the
// exposure; and the cluster grid's cells (16 × 9 tiles, 24 slices growing by a fixed ratio from the near plane to the
// farthest reach of the frame's lights). README: The CPU references says where each rule comes from. No vitest import,
// so it runs on its own (BASE-FAILURE.txt).

export type V3 = [number, number, number];

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => scale(a, 1 / len(a));
export const rad = (d: number): number => (d * Math.PI) / 180;

// ---------------------------------------------------------------------------------------------------
// The view

/** #378's pinhole, with the near plane the cluster grid starts at. */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number]; near: number }
/** The camera's frame: forward, right, up, and the focal length in px (the fov spans the wider side). */
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
/** A world point in the view's frame: right, up, and depth along the forward axis. */
export function toView(cam: Pinhole, p: V3): V3 {
  const { f, r, u } = basis(cam);
  const d = sub(p, cam.position);
  return [dot(d, r), dot(d, u), dot(d, f)];
}
/** Where a world point lands in the frame, px, with its view depth. */
export function project(cam: Pinhole, p: V3): [number, number, number] {
  const { focal } = basis(cam);
  const [vx, vy, vz] = toView(cam, p);
  return [cam.size[0] / 2 + (focal * vx) / vz, cam.size[1] / 2 - (focal * vy) / vz, vz];
}
/** Where pixel (x, y)'s centre ray meets the horizontal plane at height `y0`, or null when it never does. */
export function groundAt(cam: Pinhole, x: number, y: number, y0 = 0): V3 | null {
  const d = rayAt(cam, x + 0.5, y + 0.5);
  if (d[1] >= 0) return null;
  const t = (y0 - cam.position[1]) / d[1];
  return [cam.position[0] + d[0] * t, y0, cam.position[2] + d[2] * t];
}
/** An orbit rig's eye (canvas primitives: Camera): azimuth 0 looks at the front (+Z), elevation raises the eye. */
export function orbitEye(target: V3, azimuth: number, elevation: number, distance: number): V3 {
  const [az, el] = [rad(azimuth), rad(elevation)];
  return add(target, scale([Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)], distance));
}

// ---------------------------------------------------------------------------------------------------
// A lamp's light (Light and the light policy: Fields and Semantics)

/** A point lamp as a criterion's reference reads it: lumens over the whole sphere, a finite range in m. */
export interface Lamp { id: string; pos: V3; power: number; range: number; radius?: number; priority?: number }
/** The window that fades a local light's inverse square to 0 at its range: (1 − (d ÷ range)⁴)². */
export const windowAt = (d: number, range: number): number => (d >= range ? 0 : (1 - (d / range) ** 4) ** 2);
/** The illuminance (lx) `lamp` gives a surface point `p` whose unit normal is `n`: lm ÷ 4π cd, the cosine, the
 * inverse square and the window. */
export function illuminance(lamp: Lamp, p: V3, n: V3): number {
  const v = sub(lamp.pos, p);
  const d = len(v);
  const cos = dot(v, n) / d;
  return cos <= 0 ? 0 : ((lamp.power / (4 * Math.PI)) * cos * windowAt(d, lamp.range)) / (d * d);
}
/** The illuminance every lamp in range gives `p`, summed. */
export const illuminanceSum = (lamps: readonly Lamp[], p: V3, n: V3): number => lamps.reduce((e, l) => e + illuminance(l, p, n), 0);
/** A matte's radiance (nits) under an illuminance: ρ E ÷ π. */
export const matteRadiance = (rho: number, lux: number): number => (rho * lux) / Math.PI;

// ---------------------------------------------------------------------------------------------------
// Exposure and the automatic range (look@1: `exposure: EV100`; issue #1634: Scope)

/** Linear light's scale at an exposure: 1 ÷ (1.2 × 2^EV100). */
export const exposureScale = (ev100: number): number => 1 / (1.2 * 2 ** ev100);
/** The illuminance (lx) an automatic range ends at: the one that lifts a white diffuse surface (radiance E ÷ π) to
 * 1/4,096 of linear 1.0 after exposure. */
export const autoCut = (ev100: number): number => Math.PI / (4096 * exposureScale(ev100));
/** An automatic range (m): √(power ÷ (4π × cut)). */
export const autoRange = (power: number, ev100: number): number => Math.sqrt(power / (4 * Math.PI * autoCut(ev100)));
/** The exposure at which the cut is today's fixed 0.05 lx, so ranges are today's: log2(0.05 × 4,096 ÷ (1.2 π)). */
export const EV_TODAY = Math.log2((0.05 * 4096) / (1.2 * Math.PI));

// ---------------------------------------------------------------------------------------------------
// The policy's score, order, cut and margin (Light and the light policy: Semantics)

/** Whether a lamp's range sphere meets the view's frustum: its four side planes and its near plane (a perspective
 * view has no far plane). */
export function reachesFrustum(cam: Pinhole, lamp: Lamp): boolean {
  const { focal } = basis(cam);
  const [vx, vy, vz] = toView(cam, lamp.pos);
  const kx = (2 * focal) / cam.size[0]; const ky = (2 * focal) / cam.size[1];
  const side = (k: number, v: number): boolean => vz + k * v >= -lamp.range * Math.hypot(1, k);
  return side(kx, vx) && side(-kx, vx) && side(ky, vy) && side(-ky, vy) && vz - cam.near >= -lamp.range;
}
/** A local light's score at the view: its estimated illuminance at the eye, power ÷ max(d², radius²), times
 * 2^priority; 0 when its range misses the frustum. */
export function score(cam: Pinhole, lamp: Lamp): number {
  if (!reachesFrustum(cam, lamp)) return 0;
  const d = sub(lamp.pos, cam.position);
  const r = lamp.radius ?? 0.05;
  return (lamp.power / Math.max(dot(d, d), r * r)) * 2 ** (lamp.priority ?? 0);
}
/** A score's bucket: eight a stop, the brightest first. */
export const bucket = (s: number): number => -Math.floor(Math.log2(s) * 8);
/** How far a score sits from its bucket's nearer edge, in buckets (0 to 0.5): a fixture keeps this clear of 0. */
export const bucketMargin = (s: number): number => { const v = Math.log2(s) * 8; return Math.min(v - Math.floor(v), Math.ceil(v) - v); };

export interface Scored { id: string; score: number; bucket: number }
/** The lamps with a score above 0, in the policy's order: score bucket, then ID. */
export function ordered(cam: Pinhole, lamps: readonly Lamp[]): Scored[] {
  return lamps.map((l) => ({ id: l.id, score: score(cam, l) })).filter((s) => s.score > 0)
    .map((s) => ({ ...s, bucket: bucket(s.score) }))
    .sort((a, b) => a.bucket - b.bucket || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
/** The margin near a cut: lights within 10% of it dim by score. */
export const MARGIN = 0.1;
export interface Cut { kept: { id: string; weight: number }[]; dropped: string[] }
/** The policy's cut at `cap` over lamps already in its order: the first `cap` are kept, each at a weight that ramps
 * with its score from 0 at the cut (the first dropped light's score) to 1 at 10% above it; the rest are dropped. With
 * `cap` or fewer, every weight is 1. */
export function cutAt(inOrder: readonly Scored[], cap: number): Cut {
  const cut = inOrder[cap]?.score;
  const weight = (s: number): number => (cut === undefined ? 1 : Math.min(1, Math.max(0, (s - cut) / (cut * MARGIN))));
  return { kept: inOrder.slice(0, cap).map((s) => ({ id: s.id, weight: weight(s.score) })), dropped: inOrder.slice(cap).map((s) => s.id) };
}
/** Key lights: at most 32 a view. */
export const SHADED = 32;
/** A cluster's lights: at most 64 by default. */
export const PER_CLUSTER = 64;

// ---------------------------------------------------------------------------------------------------
// The cluster grid (Light and the light policy: "culling is by screen tile and depth slice")

export const TILES: [number, number] = [16, 9];
export const SLICES = 24;
/** The grid's far plane: the farthest any shaded light's range reaches ahead of the eye, at least twice the near. */
export function gridFar(cam: Pinhole, lamps: readonly Lamp[]): number {
  return lamps.filter((l) => reachesFrustum(cam, l)).reduce((far, l) => Math.max(far, toView(cam, l.pos)[2] + l.range), cam.near * 2);
}
/** A slice's near depth: slices grow by a fixed ratio from the near plane to the far one. */
export const sliceNear = (s: number, near: number, far: number): number => near * (far / near) ** (s / SLICES);
/** The cluster `[tile column, tile row, slice]` a world point falls in: columns from the frame's left, rows from its
 * top, slices from the near plane. */
export function clusterOf(cam: Pinhole, far: number, p: V3): [number, number, number] {
  const [sx, sy, vz] = project(cam, p);
  const clamp = (v: number, n: number): number => Math.min(n - 1, Math.max(0, Math.floor(v)));
  return [clamp((sx * TILES[0]) / cam.size[0], TILES[0]), clamp((sy * TILES[1]) / cam.size[1], TILES[1]), clamp((SLICES * Math.log(vz / cam.near)) / Math.log(far / cam.near), SLICES)];
}
/** The most lamps any cluster holds when a lamp joins every cluster whose view-space bounding box its range sphere
 * meets (the box around a cell's eight corners): a conservative count a fixture keeps under `per_cluster`. */
export function fullestCluster(cam: Pinhole, lamps: readonly Lamp[]): { count: number; cluster: [number, number, number] } {
  const { focal } = basis(cam);
  const shaded = lamps.filter((l) => reachesFrustum(cam, l));
  const far = gridFar(cam, lamps);
  const counts = new Uint32Array(TILES[0] * TILES[1] * SLICES);
  const tile = [cam.size[0] / TILES[0], cam.size[1] / TILES[1]];
  for (const l of shaded) {
    const v = toView(cam, l.pos);
    for (let s = 0; s < SLICES; s++) {
      const z0 = sliceNear(s, cam.near, far); const z1 = sliceNear(s + 1, cam.near, far);
      const dz = Math.max(z0 - v[2], v[2] - z1, 0);
      if (dz > l.range) continue;
      for (let y = 0; y < TILES[1]; y++) {
        const ys = [(cam.size[1] / 2 - y * tile[1]!) / focal, (cam.size[1] / 2 - (y + 1) * tile[1]!) / focal];
        const yLo = Math.min(ys[0]! * z0, ys[0]! * z1, ys[1]! * z0, ys[1]! * z1); const yHi = Math.max(ys[0]! * z0, ys[0]! * z1, ys[1]! * z0, ys[1]! * z1);
        const dy = Math.max(yLo - v[1], v[1] - yHi, 0);
        if (dy * dy + dz * dz > l.range * l.range) continue;
        for (let x = 0; x < TILES[0]; x++) {
          const xs = [(x * tile[0]! - cam.size[0] / 2) / focal, ((x + 1) * tile[0]! - cam.size[0] / 2) / focal];
          const xLo = Math.min(xs[0]! * z0, xs[0]! * z1, xs[1]! * z0, xs[1]! * z1); const xHi = Math.max(xs[0]! * z0, xs[0]! * z1, xs[1]! * z0, xs[1]! * z1);
          const dx = Math.max(xLo - v[0], v[0] - xHi, 0);
          if (dx * dx + dy * dy + dz * dz <= l.range * l.range) counts[(s * TILES[1] + y) * TILES[0] + x]!++;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < counts.length; i++) if (counts[i]! > counts[best]!) best = i;
  return { count: counts[best]!, cluster: [best % TILES[0], Math.floor(best / TILES[0]) % TILES[1], Math.floor(best / (TILES[0] * TILES[1]))] };
}
