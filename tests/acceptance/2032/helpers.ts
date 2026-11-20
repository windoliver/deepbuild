// Test-side tools for the #2032 acceptance tests. The documents' envelope, a lit group, a rect, a point light, the
// frames as the app's window and a film show them, the white closed form and the merge base's binaries come from
// ../2031/helpers.ts by import (and through it #467's drivers and #465's five-run judge). This file adds what shadows
// need: closed outlines as `path@1` items, a sun, and the CPU f64 segment test the criteria name, with the distance from
// a point to anything a shadow's edge can lie on. Nothing here stands in for the renderer.
// README: The surface under test.

import { item, seeded, type Image, type JsonObject } from '../467/helpers.ts';
import {
  film as film2031, offBy, px, WHITE, whiteLit, windows as windows2031,
  type Light, type Planted as Planted2031,
} from '../2031/helpers.ts';

export {
  doc, errorsOf, failsNaming, films, framesOf, group, inconclusive, issuesOf, item, judge, keyed, light, LOOK, median, none, num,
  offBy, px, rect, render, requireMetal, shown, str, timingProblem, unlitTwin, useBin, useDir, useMergeBase, WHITE,
  type Image, type Issue, type JsonObject, type JsonValue, type Light,
} from '../2031/helpers.ts';

/** Each criterion's ID: `#2032.` + the first 8 hex digits of SHA-256 of its text (README: Criteria to tests). */
export const AC = {
  1: 'AC1 #2032.9291cae9',
  2: 'AC2 #2032.49695bb6',
  3: 'AC3 #2032.e4dd3ca1',
  4: 'AC4 #2032.8db573d6',
  5: 'AC5 #2032.f2f22b4c',
  6: 'AC6 #2032.94551e97',
  7: 'AC7 #2032.24e13df9',
  8: 'AC8 #2032.1a4ae9f6',
} as const;

/** The wrong programs this suite plants (README: Planted programs); any other name stays `bad_input`. */
export type Planted =
  | 'shadow_bounding_boxes' | 'sun_far_point_light' | 'shadow_inside_outline' | 'shadow_removes_ambient' | 'shadow_edge_aliased'
  | 'occlude_accepts_open_path' | 'occlude_accepts_past_cap';

// ---------------------------------------------------------------------------------------------------
// Outlines and suns in documents (README: Documents)

export type Pt = [number, number];
/** A closed outline: its corners in order, the last joined to the first. n corners are n segments. */
export type Poly = Pt[];

/** `M x y L x y … Z`: a closed sub-path through the corners. */
const closedD = (poly: Poly): string => `${poly.map(([x, y], i) => `${i ? 'L' : 'M'} ${x} ${y}`).join(' ')} Z`;
/**
 * A closed `path@1` through `poly`, filled in `fill` (white unless named), a child of `parent`. `occlude` is written
 * only when given, so a path that leaves it out takes the default.
 */
export function outline(id: string, order: string, poly: Poly, parent: string, o: { occlude?: boolean; fill?: string } = {}, extra: JsonObject = {}): JsonObject {
  return item(id, 'path@1', order, { d: closedD(poly), paint: { fill: { role: o.fill ?? WHITE } }, ...(o.occlude === undefined ? {} : { occlude: o.occlude }) }, { parent, ...extra });
}
/** An axis-aligned box as an outline, clockwise on screen from its top left. */
export const boxPoly = (x: number, y: number, w: number, h: number): Poly => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
/** An outline's axis-aligned bounding box, as an outline. */
export function boundingBox(poly: Poly): Poly {
  const xs = poly.map((p) => p[0]); const ys = poly.map((p) => p[1]);
  return boxPoly(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}
/**
 * A closed outline of `n` corners round (cx, cy): corner k at angle 2πk ÷ n, its radius r × (0.72 + 0.28 sin(lobes ×
 * angle + phase)) with two to four lobes and a phase drawn from `seed`, rounded to 1/8 u, which f32 holds exactly. Its
 * corners turn one way round the centre, so it never crosses itself, and its lobes leave dents a bounding box fills.
 */
export function blob(cx: number, cy: number, n: number, r: number, seed: number): Poly {
  const rand = seeded(seed);
  const lobes = 2 + Math.floor(rand() * 3); const phase = 2 * Math.PI * rand();
  return Array.from({ length: n }, (_, k): Pt => {
    const a = (2 * Math.PI * k) / n; const q = r * (0.72 + 0.28 * Math.sin(lobes * a + phase));
    return [Math.round((cx + q * Math.cos(a)) * 8) / 8, Math.round((cy + q * Math.sin(a)) * 8) / 8];
  });
}
/** The segments of `polys`, counted as the issue counts them: one per corner of each closed outline. */
export const segments = (polys: Poly[]): number => polys.reduce((n, p) => n + p.length, 0);
/** Every outline's consecutive corners differ, so none of its segments has no length. */
export const distinctCorners = (polys: Poly[]): boolean => polys.every((p) => p.every((a, i) => { const b = p[(i + 1) % p.length]!; return a[0] !== b[0] || a[1] !== b[1]; }));

/** A sun as the issue writes it: `{kind: "sun", angle, color, energy}`, with no `at` and no `range`. */
export interface Sun { angle: number; energy: number }
export const sun = (s: Sun, color = WHITE): JsonObject => ({ kind: 'sun', angle: s.angle, color, energy: s.energy });
/**
 * The unit vector a sun's shadows run along, in the document's axes (x right, y down): 0° is +x and 90° is +y
 * (README: Readings, "A sun's angle").
 */
const sunDir = (angle: number): Pt => [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)];

// ---------------------------------------------------------------------------------------------------
// The CPU f64 segment test (README: Readings, "The CPU f64 segment test")

const side = (o: Pt, a: Pt, b: Pt): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
/** Whether the straight segments pq and ab cross: each one's ends lie on opposite sides of the other's line. */
function crosses(p: Pt, q: Pt, a: Pt, b: Pt): boolean {
  return (side(p, q, a) > 0) !== (side(p, q, b) > 0) && (side(a, b, p) > 0) !== (side(a, b, q) > 0);
}
/** Whether `p` is inside the closed outline, by the crossings of a ray toward +x. */
export function inside(p: Pt, poly: Poly): boolean {
  let within = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!; const [xj, yj] = poly[j]!;
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}
/**
 * The design's test at `p` for a light seen along the straight segment from `p` to `toward`: the segment crosses an
 * occluding outline, and an outline that `p` is inside doesn't shadow it.
 */
export function blocked(p: Pt, toward: Pt, outlines: Poly[]): boolean {
  return outlines.some((poly) => !inside(p, poly) && poly.some((a, i) => crosses(p, toward, a, poly[(i + 1) % poly.length]!)));
}
/** The far end of a sun's segment from `p`: `p` moved `far` u against the angle, past the group's bounds. */
export const sunward = (p: Pt, angle: number, far: number): Pt => { const [dx, dy] = sunDir(angle); return [p[0] - dx * far, p[1] - dy * far]; };
/** The centre of pixel (x, y), at 1 px a unit. */
export const centre = (x: number, y: number): Pt => [x + 0.5, y + 0.5];

/** The distance from `p` to the segment ab. */
function distance(p: Pt, a: Pt, b: Pt): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
/**
 * The least distance from `p` to anything a shadow's edge can lie on: every outline segment, and the ray a corner's
 * shadow runs on, to the point `away` gives, from every corner the outline doesn't cross that ray's line at (where it
 * does, both sides of the ray are behind the outline). A shadow's edges are among these, so a point farther than d
 * from all of them is farther than d from every shadow edge.
 */
export function clearance(p: Pt, outlines: Poly[], away: (corner: Pt) => Pt): number {
  let least = Infinity;
  for (const poly of outlines) {
    poly.forEach((a, i) => {
      const next = poly[(i + 1) % poly.length]!; const before = poly[(i + poly.length - 1) % poly.length]!; const far = away(a);
      least = Math.min(least, distance(p, a, next));
      if (side(a, far, before) * side(a, far, next) >= 0) least = Math.min(least, distance(p, a, far));
    });
  }
  return least;
}
/** `away` for a point light at `at`: from the corner, `far` u straight away from the light. */
export const fromPoint = (at: Pt, far: number) => (c: Pt): Pt => { const d = Math.hypot(c[0] - at[0], c[1] - at[1]); return [c[0] + ((c[0] - at[0]) / d) * far, c[1] + ((c[1] - at[1]) / d) * far]; };
/** `away` for a sun: from the corner, `far` u along the angle. */
export const fromSun = (angle: number, far: number) => (c: Pt): Pt => { const [dx, dy] = sunDir(angle); return [c[0] + dx * far, c[1] + dy * far]; };

/** Seeded pixels of a `w` × `h` frame, in the stream's order: x then y from one generator. */
export function pixels(seed: number, w: number, h: number): () => Pt {
  const rand = seeded(seed);
  return () => [Math.floor(rand() * w), Math.floor(rand() * h)];
}

// ---------------------------------------------------------------------------------------------------
// Reading a frame

/** Whether pixel (x, y) reads `code` within 1 code on each of R, G and B. */
export const reads = (im: Image, x: number, y: number, code: number): boolean => offBy(im, x, y, code) <= 1;
/** `lit`, `shadowed` or `neither`: which of a white pixel's two codes (x, y) reads, within 1 code. */
export function reading(im: Image, x: number, y: number, lit: number, shadowed: number): 'lit' | 'shadowed' | 'neither' {
  return reads(im, x, y, lit) ? 'lit' : reads(im, x, y, shadowed) ? 'shadowed' : 'neither';
}
/** The pixel's R, G and B as text. */
export const rgb = (im: Image, x: number, y: number): string => px(im, x, y).slice(0, 3).join(', ');
/** The code a white pixel shows under `ambient` and the point lights that reach it: #2031's closed form. */
export const white = (ambient: number, lights: Light[], x: number, y: number): number => whiteLit(ambient, lights, x, y);

// ---------------------------------------------------------------------------------------------------
// Frames: `deep-gpu run` (macOS, Metal), through #2031's drivers with this suite's planted names

/** Each of `docs` as the app's window shows it (`window2d`), read back; one `deep-gpu run` process for all. */
export function windows(bin: string, out: string, docs: JsonObject[], planted?: Planted): Image[] {
  return windows2031(bin, out, docs, { planted: planted as unknown as Planted2031 | undefined });
}
/** `film2d` with `from` and `hash`: each frame's pixel hash and GPU time, by absolute frame index. */
export function film(bin: string, out: string, d: JsonObject, o: { fps: number; from: number; frames: number }): Map<number, { hash: string; gpu_ms: number }> {
  return film2031(bin, out, d, o);
}
/** The same document with `occlude` taken off every path, so each takes the default. */
export function withoutOcclude(d: JsonObject): JsonObject {
  const twin = JSON.parse(JSON.stringify(d)) as { items: Record<string, { params: JsonObject }> };
  for (const i of Object.values(twin.items)) delete i.params['occlude'];
  return twin as unknown as JsonObject;
}
