// #2516 AC4's CPU reference (README: The CPU reference), written from the issue's text alone: a floor point's
// visibility is the cosine-weighted share of 4,096 directions over the floor's hemisphere whose ray meets no occluder
// within the radius, in f64 (JavaScript numbers). Occluders are axis-aligned boxes in metres, y up, the floor's top at
// y = 0; the floor itself is the receiver and never an occluder. Nothing here reads the renderer or its shader.
//
// The planted twins live here, chosen by argument and never by the environment (design: Wrong programs):
// `uniform_twin` weights its directions evenly over the hemisphere; `uncut_twin` lets rays run past the radius.

export type V3 = [number, number, number];
export interface Box { min: V3; max: V3 }
export type Model = 'reference' | 'uniform_twin' | 'uncut_twin';

/** The issue's count of rays per point. */
export const RAYS = 4096;
/** The issue's radius for every fixture, in metres. */
export const RADIUS = 0.5;

const GOLDEN = (Math.sqrt(5) - 1) / 2;

/**
 * The model's directions, y up. A golden-ratio lattice over the unit square, (i + ½) ÷ N and frac(i × 0.618…), mapped
 * by Malley's method for the reference (a uniform point on the unit disk at radius √s lifted to the hemisphere, so
 * cos θ = √(1 − s), density cos θ ÷ π) or with cos θ = s for the even twin (density 1 ÷ 2π).
 */
export function directions(model: Model): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < RAYS; i++) {
    const s = (i + 0.5) / RAYS;
    const phi = 2 * Math.PI * ((i * GOLDEN) % 1);
    const cos = model === 'uniform_twin' ? s : Math.sqrt(1 - s);
    const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
    out.push([sin * Math.cos(phi), cos, sin * Math.sin(phi)]);
  }
  return out;
}

/** Whether the ray o + t d meets box b for some t in [0, tMax] (the slab method). */
export function hits(o: V3, d: V3, b: Box, tMax: number): boolean {
  let t0 = 0; let t1 = tMax;
  for (const k of [0, 1, 2] as const) {
    if (d[k] === 0) { if (o[k] < b.min[k] || o[k] > b.max[k]) return false; continue; }
    let a = (b.min[k] - o[k]) / d[k]; let c = (b.max[k] - o[k]) / d[k];
    if (a > c) [a, c] = [c, a];
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return false;
  }
  return true;
}

/** The share of the model's directions from floor point `p` that meet no box within `radius` (the uncut twin: any distance). */
export function visibility(p: V3, boxes: Box[], model: Model = 'reference', radius = RADIUS): number {
  const reach = model === 'uncut_twin' ? Infinity : radius;
  let blocked = 0;
  for (const d of directions(model)) if (boxes.some((b) => hits(p, d, b, reach))) blocked++;
  return 1 - blocked / RAYS;
}

// ---------------------------------------------------------------------------------------------------
// The fixtures as the issue states them (README: Fixtures), in the reference's frame

/** The cube: 0.2 m on a side standing on the floor, centred on x = z = 0; the face read is the one at z = +0.1. */
export const CUBE_SIDE = 0.2;
export const CUBE: Box = { min: [-0.1, 0, -0.1], max: [0.1, 0.2, 0.1] };
export const CUBE_FACE_Z = 0.1;
/** The wall: 20 m long and 4 m high, its face at z = 0, the floor in front of it at z > 0. */
export const WALL: Box = { min: [-10, 0, -0.2], max: [10, 4, 0] };
/** The slab: 20 m square, its underside at height h (its thickness, which the issue leaves open, doesn't change a ray cut at the radius). */
export const slab = (h: number): Box => ({ min: [-10, h, -10], max: [10, h + 0.1, 10] });

/** The floor point d metres in front of the middle of the cube's face, x along the face. */
export const cubePoint = (d: number, x = 0): V3 => [x, 0, CUBE_FACE_Z + d];

/**
 * The points the GPU reading averages over (README: The reading): the middle 10 cm of the face along x, and the
 * marker's 1 cm depth about d, as 5 × 3 cell centres.
 */
export const BAND_LENGTH = 0.1;
export const BAND_DEPTH = 0.01;
export function cubeBand(d: number): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++)
    pts.push(cubePoint(d + BAND_DEPTH * ((j + 0.5) / 3 - 0.5), BAND_LENGTH * ((i + 0.5) / 5 - 0.5)));
  return pts;
}
/** The reference's mean visibility over the band at d. */
export const cubeBandReference = (d: number, model: Model = 'reference'): number => {
  const pts = cubeBand(d);
  return pts.reduce((sum, p) => sum + visibility(p, [CUBE], model), 0) / pts.length;
};

// ---------------------------------------------------------------------------------------------------
// Closed forms, each derived independently of the ray cast (README: Qualification)

/** The issue's wall form: 1 − (acos a − a√(1 − a²)) ÷ π with a = d ÷ radius, and 1 once d reaches the radius. */
export function wallClosed(d: number, radius = RADIUS): number {
  const a = Math.min(d / radius, 1);
  return 1 - (Math.acos(a) - a * Math.sqrt(1 - a * a)) / Math.PI;
}
/** The issue's slab form: (h ÷ radius)². */
export const slabClosed = (h: number, radius = RADIUS): number => (h / radius) ** 2;

/**
 * The cube's face, seen from a floor point d in front of its plane and x0 along it from its middle: 1 minus the
 * form factor of the face (a rectangle 2·half wide and h high standing on the floor) from a horizontal element, by
 * Lambert's contour integral, F = (1 ÷ 2π) Σ βᵢ cos αᵢ. The two vertical edges lie in planes through the floor
 * normal and add nothing; the bottom edge adds its whole angle and the top edge its angle times d ÷ √(d² + h²).
 * Only the face is seen from such a point (the top lies in the floor's plane's half-space above it, the sides face
 * away), and it holds while every corner of the face lies within the radius, so no ray is cut short.
 */
export function cubeFaceClosed(d: number, x0 = 0, half = CUBE_SIDE / 2, h = CUBE_SIDE): number {
  const rho = Math.hypot(d, h);
  const bottom = Math.atan((half - x0) / d) + Math.atan((half + x0) / d);
  const top = (d / rho) * (Math.atan((half - x0) / rho) + Math.atan((half + x0) / rho));
  return 1 - (bottom - top) / (2 * Math.PI);
}
/** The farthest corner of the face from the point, which must lie within the radius for cubeFaceClosed to hold. */
export const cubeFaceReach = (d: number, x0 = 0): number => Math.hypot(d, CUBE_SIDE / 2 + Math.abs(x0), CUBE_SIDE);
/** cubeFaceClosed averaged over the band (100 × 10 cell centres). */
export function cubeBandClosed(d: number): number {
  let sum = 0; const nx = 100; const nz = 10;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++)
    sum += cubeFaceClosed(d + BAND_DEPTH * ((j + 0.5) / nz - 0.5), BAND_LENGTH * ((i + 0.5) / nx - 0.5));
  return sum / (nx * nz);
}

// ---------------------------------------------------------------------------------------------------
// The issue's stated values

/** AC1: the wall at radius 0.5 m, cm from the wall → the closed form as the issue states it. */
export const WALL_STATED: [number, number][] = [[5, 0.564], [10, 0.626], [15, 0.688], [20, 0.748], [30, 0.858], [40, 0.948]];
/** AC2: at 60 cm and 1 m from the wall the reading is 1. */
export const WALL_ONE_CM = [60, 100];
/** AC3: the slab at height m → its form. */
export const SLAB_STATED: [number, number][] = [[0.25, 0.25], [0.375, 0.5625]];
/** AC4: the cube, cm in front of the middle of a face → the reference as the issue states it. */
export const CUBE_STATED: [number, number][] = [[5, 0.68], [10, 0.81]];

/** The qualification's bound (README: Drafting choices): a tenth of the criterion's 0.1. */
export const QUALIFY_TOL = 0.01;

export interface Row { fixture: string; expected: number; got: number; tol: number }
/** Every row the reference must reproduce before a comparison against it counts (design: a CPU reference counts as an oracle only once …). */
export function qualification(model: Model = 'reference'): Row[] {
  const rows: Row[] = [];
  for (const [cm, v] of WALL_STATED) rows.push({ fixture: `wall at ${cm} cm`, expected: v, got: visibility([0, 0, cm / 100], [WALL], model), tol: QUALIFY_TOL });
  for (const cm of WALL_ONE_CM) rows.push({ fixture: `wall at ${cm} cm`, expected: 1, got: visibility([0, 0, cm / 100], [WALL], model), tol: 0 });
  for (const [h, v] of SLAB_STATED) rows.push({ fixture: `slab at ${h} m`, expected: v, got: visibility([0, 0, 0], [slab(h)], model), tol: QUALIFY_TOL });
  for (const [cm, v] of CUBE_STATED) {
    const d = cm / 100;
    rows.push({ fixture: `cube at ${cm} cm (the issue's value)`, expected: v, got: visibility(cubePoint(d), [CUBE], model), tol: QUALIFY_TOL });
    rows.push({ fixture: `cube at ${cm} cm (the face's closed form)`, expected: cubeFaceClosed(d), got: visibility(cubePoint(d), [CUBE], model), tol: QUALIFY_TOL });
    rows.push({ fixture: `cube band at ${cm} cm (the closed form averaged)`, expected: cubeBandClosed(d), got: cubeBandReference(d, model), tol: QUALIFY_TOL });
  }
  return rows;
}
/** The rows a model misses, each naming its fixture, the expected value and the reading. */
export const misses = (rows: Row[]): string[] => rows
  .filter((r) => !(Math.abs(r.got - r.expected) <= r.tol))
  .map((r) => `${r.fixture}: reads ${r.got.toFixed(4)} where ${r.expected.toFixed(4)} is expected within ${r.tol}`);
