// The #2034 suite's CPU references, in f64, from the issue's rule and geometry alone: nothing here is taken from the
// renderer. The tile rule (issue #2034, Scope): a shaded key light with shadow on asks for the smallest of 128, 256,
// 512 and 1,024 px at least as large as the diameter in px of its range sphere on screen, or 1,024 px when none is or
// the eye is inside the sphere; while the tiles asked for cover more than the 4,096 px atlas, every light at the
// largest size in use steps down one size; slots fill largest first, ties by ID. The rays AC2 reads: segments from a
// light to floor points against the fixture's boxes. The pinhole, the frustum test and the policy's order are #1634's
// (`../1634/reference.ts`, from the design's Light and the light policy). README: The tile rule, read exactly. No
// vitest import, so it runs on its own.

import { basis, dot, len, ordered, rayAt, sub, unit, windowAt, type Pinhole, type V3 } from '../1634/reference.ts';

export type { Pinhole, V3 };

/** The tile sizes, smallest first, and the atlas's side, in px. */
export const SIZES = [128, 256, 512, 1024] as const;
export const ATLAS = 4096;
/** Key lights the policy shades at most (Light and the light policy). */
export const SHADED = 32;

/** A shadowed local light: a spot takes one tile, a point light six. A spot shines along `aim` (unit) with its cone's
 * half angles `inner` and `outer` in degrees; `power` in lm over the whole sphere, `range` and `radius` in m. */
export interface Lamp {
  id: string; kind: 'spot' | 'point'; pos: V3; range: number; power: number; radius?: number; aim?: V3; inner?: number; outer?: number;
}
export const tilesOf = (l: Lamp): number => (l.kind === 'spot' ? 1 : 6);
const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The diameter in px of a light's range sphere on screen: 2 f r ÷ √(d² − r²), where d is the distance from the eye to
 * the light's position, r its range and f the focal length in px (half the frame's wider side ÷ tan of half the fov).
 * It is the sphere's angular diameter, 2 asin(r ÷ d), carried to the screen at the view's centre, so it reads the eye
 * and the light alone, not where in the frame the sphere lies. Infinity with the eye inside the sphere (d ≤ r).
 */
export function diameterPx(cam: Pinhole, l: Lamp): number {
  const d = len(sub(l.pos, cam.position));
  if (d <= l.range) return Infinity;
  return (2 * basis(cam).focal * l.range) / Math.sqrt(d * d - l.range * l.range);
}
/** The size a light asks for: the smallest at least as large as `diameter`, else 1,024 px. */
export const askedSize = (diameter: number): number => SIZES.find((s) => s >= diameter) ?? 1024;

/** One row of the tile table: the light, its tiles' size in px, and its slots (one per tile), ascending. */
export interface Row { light: string; size: number; slots: number[] }

/** The lights the policy shades at the view: the top 32 by score bucket, then ID, of those whose range meets the
 * frustum. */
export function shaded(cam: Pinhole, lamps: readonly Lamp[]): Lamp[] {
  const of = new Map(lamps.map((l) => [l.id, l]));
  return ordered(cam, lamps).slice(0, SHADED).map((s) => of.get(s.id)!);
}
/** What tiles of the sizes given cover, in px²: each light's tiles times its size squared. */
export const cover = (lamps: readonly Lamp[], size: ReadonlyMap<string, number>): number =>
  lamps.reduce((sum, l) => sum + tilesOf(l) * size.get(l.id)! ** 2, 0);

/**
 * The tile table at the view: every shaded light with its size and slots, in fill order. While the tiles cover more
 * than 4,096² px², every light at the largest size in use steps down one size. Slots count from 0 in fill order,
 * largest first, ties by ID (byte order); a light's tiles take consecutive slots.
 */
export function tileTable(cam: Pinhole, lamps: readonly Lamp[]): Row[] {
  const lit = shaded(cam, lamps);
  const size = new Map(lit.map((l) => [l.id, askedSize(diameterPx(cam, l))]));
  while (cover(lit, size) > ATLAS * ATLAS) {
    const largest = Math.max(...size.values());
    if (largest === SIZES[0]) break;
    for (const [id, s] of size) if (s === largest) size.set(id, s / 2);
  }
  const order = [...lit].sort((a, b) => size.get(b.id)! - size.get(a.id)! || byId(a.id, b.id));
  let next = 0;
  return order.map((l) => {
    const slots = Array.from({ length: tilesOf(l) }, (_, k) => next + k);
    next += tilesOf(l);
    return { light: l.id, size: size.get(l.id)!, slots };
  });
}
/** How far a light's diameter sits from the nearest threshold it could cross (128, 256 or 512 px; past 512 every
 * diameter asks for 1,024), as a share of that threshold; Infinity inside the sphere. A fixture keeps this clear of 0
 * so no rounding moves a light across one. */
export function thresholdMargin(cam: Pinhole, l: Lamp): number {
  const D = diameterPx(cam, l);
  if (!Number.isFinite(D)) return Infinity;
  return Math.min(...[128, 256, 512].map((t) => Math.abs(D - t) / t));
}

// ---------------------------------------------------------------------------------------------------
// Rays (AC2): segments and rays against axis-aligned boxes

/** An axis-aligned box: its item ID, centre and size, m. */
export interface Box { id: string; centre: V3; size: V3 }
/** The entry and exit parameters of the line o + t d through `b`, or null when it misses (the slab test). */
export function hitBox(o: V3, d: V3, b: Box): [number, number] | null {
  let t0 = -Infinity; let t1 = Infinity;
  for (let k = 0; k < 3; k++) {
    const h = b.size[k]! / 2; const lo = o[k]! - b.centre[k]!;
    if (Math.abs(d[k]!) < 1e-12) { if (Math.abs(lo) > h) return null; continue; }
    let a = (-h - lo) / d[k]!; let c = (h - lo) / d[k]!;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
  }
  return t0 <= t1 ? [t0, t1] : null;
}
/** Whether any of `boxes` blocks the segment from `a` to `b`. */
export function blocked(a: V3, b: V3, boxes: readonly Box[]): boolean {
  const d = sub(b, a);
  return boxes.some((box) => { const h = hitBox(a, d, box); return h !== null && h[1] > 1e-6 && h[0] < 1 - 1e-6; });
}
/** The first of `boxes` the ray from `o` along `d` meets ahead of it, with its parameter; null when none. */
export function firstHit(o: V3, d: V3, boxes: readonly Box[]): { id: string; t: number } | null {
  let best: { id: string; t: number } | null = null;
  for (const b of boxes) {
    const h = hitBox(o, d, b);
    if (h === null || h[1] <= 0) continue;
    const t = Math.max(h[0], 0);
    if (best === null || t < best.t) best = { id: b.id, t };
  }
  return best;
}

/** A light's unshadowed radiance (nits) off a level matte of albedo `rho` at floor point `p` (lm ÷ 4π cd, the cosine,
 * the inverse square and the window (1 − (d ÷ range)⁴)², ρ E ÷ π). A spot counts in full inside its inner cone and,
 * `upTo` 'outer', as full out to its outer cone; past it, 0. Used only to choose pixels where a light matters. */
export function radiance(l: Lamp, p: V3, rho: number, upTo: 'inner' | 'outer'): number {
  const v = sub(l.pos, p); const d = len(v);
  const cos = v[1] / d;
  if (cos <= 0 || d >= l.range) return 0;
  if (l.kind === 'spot') {
    const angle = (Math.acos(Math.min(1, dot(unit(sub(p, l.pos)), l.aim!))) * 180) / Math.PI;
    if (angle > (upTo === 'inner' ? l.inner! : l.outer!)) return 0;
  }
  return (rho * (l.power / (4 * Math.PI)) * cos * windowAt(d, l.range)) / (d * d) / Math.PI;
}
/** An 8-bit sRGB code of a linear value (the transfer function, clamped to 0..1). */
export const srgbCode = (v: number): number => {
  const x = Math.min(Math.max(v, 0), 1);
  return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
};

/** A floor pixel AC2 reads for one light, its floor point, and the code values the light alone would add there. */
export interface CheckPixel { light: string; x: number; y: number; floor: V3; adds: number }
/**
 * For each light, the floor pixel AC2 reads (README: The hall): on a 3 px grid from (20, 20) to 20 px inside the
 * frame's edges, a pixel whose centre ray and those of every pixel within 3 px (a 7 × 7 block) first meet the receiver,
 * so no edge of another item is near it; whose floor point and the eight points 0.3 m around it are all blocked from
 * the light's position by a caster; around which every other light reaching any of those nine points is blocked from
 * all nine or from none (no shadow edge within 0.3 m); inside the light's inner cone and range; where every light
 * unshadowed would sum to at most 0.85 nits. Of those, the one where the light alone would add the most 8-bit code
 * values over the rest; null when there is none.
 */
export function checkPixels(cam: Pinhole, lamps: readonly Lamp[], boxes: readonly Box[], receiver: string, rho: number): Map<string, CheckPixel | null> {
  const casters = boxes.filter((b) => b.id !== receiver);
  const floorAt = (x: number, y: number): V3 | null => {
    const d = rayAt(cam, x + 0.5, y + 0.5);
    const h = firstHit(cam.position, d, boxes);
    return h && h.id === receiver ? [cam.position[0] + d[0] * h.t, cam.position[1] + d[1] * h.t, cam.position[2] + d[2] * h.t] : null;
  };
  const candidates: { x: number; y: number; p: V3; ring: V3[] }[] = [];
  for (let y = 20; y < cam.size[1] - 20; y += 3) for (let x = 20; x < cam.size[0] - 20; x += 3) {
    const p = floorAt(x, y);
    if (!p) continue;
    let all = true;
    for (let dy = -3; dy <= 3 && all; dy++) for (let dx = -3; dx <= 3 && all; dx++) if ((dx || dy) && !floorAt(x + dx, y + dy)) all = false;
    if (!all) continue;
    const ring = [p, ...Array.from({ length: 8 }, (_, k) => [p[0] + 0.3 * Math.cos((k * Math.PI) / 4), p[1], p[2] + 0.3 * Math.sin((k * Math.PI) / 4)] as V3)];
    candidates.push({ x, y, p, ring });
  }
  const out = new Map<string, CheckPixel | null>();
  for (const L of lamps) {
    let best: CheckPixel | null = null;
    for (const c of candidates) {
      const own = radiance(L, c.p, rho, 'inner');
      if (own <= 0) continue;
      if (!c.ring.every((q) => blocked(L.pos, q, casters))) continue;
      const edge = lamps.some((M) => {
        if (M.id === L.id || c.ring.every((q) => radiance(M, q, rho, 'outer') <= 0)) return false;
        const states = c.ring.map((q) => blocked(M.pos, q, casters));
        return states.some((s) => s !== states[0]);
      });
      if (edge) continue;
      const rest = lamps.filter((M) => M.id !== L.id).reduce((s, M) => s + radiance(M, c.p, rho, 'outer'), 0);
      if (rest + own > 0.85) continue;
      const adds = srgbCode(rest + own) - srgbCode(rest);
      if (!best || adds > best.adds) best = { light: L.id, x: c.x, y: c.y, floor: c.p, adds };
    }
    out.set(L.id, best);
  }
  return out;
}
