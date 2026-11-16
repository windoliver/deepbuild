// Test-side tools for the #2516 acceptance tests (README). Reused, unedited, from earlier suites: #418's `deep-gpu`
// build and `view3d` driver, its look, its `solid` item, its room, its f32 / ID-target readers (`../418/helpers.ts`);
// #1637's failure helpers, named-file reader and the perf lane's judge (`../1637/helpers.ts`). Added here: the three
// literal fixtures and their stated cameras, the camera model (scene.rs `posed`/`unproject`, restated), the floor
// reading, the closed forms, the f64 4,096-ray cosine-weighted CPU reference and its uniform twin, the judges that name
// a failing point, height or camera, and the machine's GPU lease (crates/deep-show/src/kit/goldens.rs `GpuLease`, read as
// a file protocol). Nothing here stands in for the prepass, the occlusion loop, the blur or the timings under test.

import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import {
  REPO, answered, frameAt, look, luma, readIds, readTarget, run as run418, solid, texel,
  type F32, type Ids, type JsonObject, type Planted as Planted418, type Rgb,
} from '../418/helpers.ts';
import { failsNaming, inconclusive, judgeLimit, load, median, namedFile, none, p95 } from '../1637/helpers.ts';
import { cubeFaceClosed } from './redraft-ac4/reference.ts';

export { REPO, failsNaming, inconclusive, judgeLimit, load, median, none, p95 };
export {
  AO as AO_DEFAULTS, frameAt, look, readIds, readTarget, requireGpu, room, sha256, useGpuBin, useOut, writeJson,
} from '../418/helpers.ts';
export { namedFile } from '../1637/helpers.ts';
export type { JsonObject, JsonValue } from '../418/helpers.ts';

/** The base commit these tests were drafted on: `main` as the issue reads it. */
export const BASE_SHA = '1c4d1f0e2aaad8c6a6573848823566d04ff73d17';

// ---------------------------------------------------------------------------------------------------
// The settings and the look

export const RADIUS = 0.5;
export const SIZE: [number, number] = [1920, 1080];
export interface Setting { samples: 8 | 16; resolution: 'half' | 'full' }
/** Every setting the criteria name: 8 and 16 samples, half and full resolution. */
export const SETTINGS: Setting[] = [
  { samples: 8, resolution: 'half' }, { samples: 8, resolution: 'full' },
  { samples: 16, resolution: 'half' }, { samples: 16, resolution: 'full' },
];
export const DEFAULT_SETTING: Setting = SETTINGS[0]!;
export const settingName = (s: Setting): string => `${s.samples} samples, ${s.resolution} resolution`;
/** The issue's fixture ao: radius 0.5 m, strength 1 (unless raised), multi_bounce and specular off. */
export const aoOn = (s: Setting, strength = 1): JsonObject =>
  ({ radius: RADIUS, strength, samples: s.samples, resolution: s.resolution, multi_bounce: false, specular: false });
const ROLES: Record<string, Rgb> = { floor: [150, 150, 150], wall: [176, 176, 176], slab: [176, 176, 176], cube: [176, 176, 176] };
/** #418's look (tone map none at scale 1, finish identity, no bloom, no deband) with this `ao`. */
export const fixtureLook = (ao: JsonObject | 'none'): JsonObject => look('ao-2516', ROLES, { ao });

/** The wrong programs the criteria name, reachable only through `deep-gpu run --planted <name>` (README: Planted). */
/** `ao_points_at_radius` is the blind redraft's name for the same full-radius wrong program (redraft-ac4/README.md). */
export type Plant = 'ao_main_loop' | 'ao_uniform_hemisphere' | 'ao_full_radius' | 'ao_points_at_radius';
/** One `deep-gpu run` process over `calls`, every reply answered (not refused). */
export function draw(bin: string, out: string, calls: JsonObject[], plant?: Plant): JsonObject[] {
  const replies = run418(bin, out, calls, plant as unknown as Planted418 | undefined);
  return replies.map((r, i) => answered(r, `${plant ? `--planted ${plant}: ` : ''}call ${i}`));
}

// ---------------------------------------------------------------------------------------------------
// Vectors and the camera model (crates/deep-canvas-scene3d/src/scene.rs `posed`, `project`, `unproject`;
// crates/deep-canvas/src/camera.rs `screen_basis`): fov spans the wider side, the centre is the frame's middle, no roll.

export type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]); return l > 0 ? mul(a, 1 / l) : a; };

export interface Cam { name: string; position: V3; target: V3; fov: number; near: number }
/** The eye `offset` from `target`, turned `degrees` about the vertical axis through the target (+X at 90°). */
export function around(name: string, target: V3, offset: V3, degrees: number, fov: number, near: number): Cam {
  const a = (degrees * Math.PI) / 180;
  const o: V3 = [offset[0] * Math.cos(a) + offset[2] * Math.sin(a), offset[1], -offset[0] * Math.sin(a) + offset[2] * Math.cos(a)];
  return { name, position: add(target, o), target, fov, near };
}
function frameOf(c: Cam, size: [number, number] = SIZE) {
  const f = norm(sub(c.target, c.position));
  let r = norm(cross(f, [0, 1, 0]));
  if (Math.hypot(...r) === 0) r = [1, 0, 0];
  const u = cross(r, f);
  const s = Math.max(size[0], size[1]) / 2 / Math.tan((c.fov * Math.PI) / 360);
  return { f, r, u, s, cx: size[0] / 2, cy: size[1] / 2 };
}
/** Where a world point lands in px (x right, y down) with its view-axis depth; null behind the eye. */
export function project(c: Cam, p: V3, size: [number, number] = SIZE): V3 | null {
  const { f, r, u, s, cx, cy } = frameOf(c, size);
  const d = sub(p, c.position); const vz = dot(d, f);
  if (vz <= 0) return null;
  return [cx + (dot(d, r) * s) / vz, cy - (dot(d, u) * s) / vz, vz];
}
/** The world point at frame px (sx, sy) and view-axis depth vz. */
export function unproject(c: Cam, sx: number, sy: number, vz: number, size: [number, number] = SIZE): V3 {
  const { f, r, u, s, cx, cy } = frameOf(c, size);
  return add(add(add(c.position, mul(r, ((sx - cx) * vz) / s)), mul(u, (-(sy - cy) * vz) / s)), mul(f, vz));
}
export const cameraItem = (c: Cam): JsonObject =>
  ({ id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', layer: 'main', params: { projection: 'perspective', position: c.position, target: c.target, fov: c.fov, near: c.near } });

// ---------------------------------------------------------------------------------------------------
// The three literal fixtures (README: Fixtures and cameras)

export interface Box { id: string; min: V3; max: V3 }
export interface Fixture { name: string; boxes: Box[]; cams: Cam[] }
/** Wall fixture: a floor (top y = 0) meeting a wall 20 m long and 4 m high whose face is the plane z = 0. */
export const WALL_BOXES: Box[] = [
  { id: 'floor', min: [-10, -0.1, -0.2], max: [10, 0, 12] },
  { id: 'wall', min: [-10, 0, -0.2], max: [10, 4, 0] },
];
const WALL_TARGET: V3 = [0, 0.2, 0.5];
const WALL_OFFSET: V3 = [0, 4, 5.5];
/** Camera A looks square at the wall's foot; camera B is A turned 30° about the vertical through the same target. */
export const WALL_CAMS: Cam[] = [around('A (square on)', WALL_TARGET, WALL_OFFSET, 0, 75, 0.1), around('B (30° around A)', WALL_TARGET, WALL_OFFSET, 30, 75, 0.1)];
/** The wall's read points: distance from the wall in m, averaged over |x| ≤ 2 m (4 m of the wall). */
export const WALL_POINTS = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4] as const;
export const WALL_OPEN = [0.6, 1.0] as const;
export const WALL_HALF_LENGTH = 2;
/** Slab fixture: a floor under a slab 20 m square whose underside is `h` above it. */
export const slabBoxes = (h: number): Box[] => [
  { id: 'floor', min: [-12, -0.1, -12], max: [12, 0, 12] },
  { id: 'slab', min: [-10, h, -10], max: [10, h + 0.1, 10] },
];
/** The slab's camera stands in the gap, halfway up it, 1.5 m from the middle, looking level at it. */
export const slabCam = (h: number): Cam => ({ name: `in the gap (h ${h} m)`, position: [0, h / 2, 1.5], target: [0, h / 2, 0], fov: 100, near: 0.02 });
export const SLAB_HEIGHTS = [0.25, 0.375] as const;
/** The slab's middle: the floor within 0.25 m of the centre in x and z. */
export const SLAB_MIDDLE = 0.25;
/** Cube fixture: a cube 0.2 m on a side standing on a floor, its front face the plane z = 0.1. */
export const CUBE_BOXES: Box[] = [
  { id: 'floor', min: [-6, -0.1, -6], max: [6, 0, 6] },
  { id: 'cube', min: [-0.1, 0, -0.1], max: [0.1, 0.2, 0.1] },
];
const CUBE_TARGET: V3 = [0, 0.05, 0.15];
const CUBE_OFFSET: V3 = [0, 1.15, 2.05];
export const CUBE_CAMS: Cam[] = [around('facing the face', CUBE_TARGET, CUBE_OFFSET, 0, 60, 0.05), around('90° around', CUBE_TARGET, CUBE_OFFSET, 90, 60, 0.05)];
export const CUBE_FACE_Z = 0.1;
export const CUBE_POINTS = [0.05, 0.1] as const;
/** The middle 10 cm of the face: |x| ≤ 0.05 m. */
export const CUBE_HALF_SPAN = 0.05;
/** A reading's band across its distance: ±0.5 cm. */
export const BAND = 0.005;

const sky = (): JsonObject => ({ id: 'sky', kind: 'sky@1', name: 'Sky', order: 'z1', layer: 'main', params: { ambient_top: [0.6, 0.6, 0.6], ambient_low: [0.6, 0.6, 0.6] } });
const floorMaterial = (): JsonObject =>
  ({ id: 'm-floor', kind: 'material@1', name: 'Floor material', order: 'z2', layer: 'main', params: { base_color: { role: 'floor' }, metallic: 0, roughness: 1, specular_level: 0 } });
/** A scene document: the boxes (the floor with its no-specular material), uniform ambient from a sky, no light. */
export function fixtureDoc(id: string, boxes: Box[], cam: Cam): JsonObject {
  const items: JsonObject[] = [cameraItem(cam), sky(), floorMaterial()];
  boxes.forEach((b, i) => {
    const size = sub(b.max, b.min); const pos = mul(add(b.max, b.min), 0.5);
    items.push(solid(b.id, `a${i + 1}`, 'mark.box@1', size, pos, b.id, b.id === 'floor' ? { material: 'm-floor' } : {}));
  });
  return {
    format: 1, id, profile: 'scene', title: `#2516 ${id}`, description: `The #2516 fixture ${id}, under uniform ambient light with no lights.`,
    size: SIZE, camera: 'cam', transport: { span: '2s' }, requires: { modules: { scene3d: '^1', effects: '^1' } },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: Object.fromEntries(items.map((i) => [i['id'] as string, i])),
  };
}

// ---------------------------------------------------------------------------------------------------
// The neighbourhood each camera must keep in the frame

/** Points on every face of every box within `radius` of some read point, on a grid of `step` m. */
export function neighbourhood(boxes: Box[], reads: V3[], radius: number, step = 0.025): V3[] {
  const lo: V3 = [Infinity, Infinity, Infinity]; const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of reads) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, p[k]! - radius); hi[k] = Math.max(hi[k]!, p[k]! + radius); }
  const out: V3[] = [];
  for (const b of boxes) for (let axis = 0; axis < 3; axis++) for (const side of [b.min[axis]!, b.max[axis]!]) {
    if (side < lo[axis]! || side > hi[axis]!) continue;
    const [a1, a2] = [0, 1, 2].filter((k) => k !== axis) as [number, number];
    const from1 = Math.max(b.min[a1]!, lo[a1]!); const to1 = Math.min(b.max[a1]!, hi[a1]!);
    const from2 = Math.max(b.min[a2]!, lo[a2]!); const to2 = Math.min(b.max[a2]!, hi[a2]!);
    for (let s = from1; s <= to1 + 1e-9; s += step) for (let t = from2; t <= to2 + 1e-9; t += step) {
      const q: V3 = [0, 0, 0]; q[axis] = side; q[a1] = s; q[a2] = t;
      if (reads.some((p) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) <= radius)) out.push(q);
    }
  }
  return out;
}
export const wallReads = (): V3[] => [...WALL_POINTS, ...WALL_OPEN].flatMap((d) => grid(-WALL_HALF_LENGTH, WALL_HALF_LENGTH, 0.1).map((x): V3 => [x, 0, d]));
export const slabReads = (): V3[] => grid(-SLAB_MIDDLE, SLAB_MIDDLE, 0.05).flatMap((x) => grid(-SLAB_MIDDLE, SLAB_MIDDLE, 0.05).map((z): V3 => [x, 0, z]));
export const cubeReads = (): V3[] => CUBE_POINTS.flatMap((d) => grid(-CUBE_HALF_SPAN, CUBE_HALF_SPAN, 0.01).map((x): V3 => [x, 0, CUBE_FACE_Z + d]));
function grid(from: number, to: number, step: number): number[] {
  const n = Math.round((to - from) / step); return Array.from({ length: n + 1 }, (_, i) => from + i * step);
}
/** Neighbourhood points the camera leaves out of the frame or in front of its near plane, at most 5 listed. */
export function outOfFrame(c: Cam, points: V3[]): { count: number; listed: string[] } {
  let count = 0; const listed: string[] = [];
  for (const p of points) {
    const q = project(c, p);
    const inside = q !== null && q[2] > c.near && q[0] >= 0 && q[0] <= SIZE[0] && q[1] >= 0 && q[1] <= SIZE[1];
    if (!inside) { count++; if (listed.length < 5) listed.push(`(${p.map((v) => v.toFixed(3)).join(', ')}) → ${q ? q.map((v) => v.toFixed(1)).join(', ') : 'behind the eye'}`); }
  }
  return { count, listed };
}

// ---------------------------------------------------------------------------------------------------
// The reading: the floor's radiance with ao on over the same frame with `ao: none`, on the linear target

export interface Bin { name: string; has: (p: V3) => boolean }
export const wallBin = (d: number): Bin => ({ name: `${Math.round(d * 100)} cm`, has: (p) => Math.abs(p[0]) <= WALL_HALF_LENGTH && Math.abs(p[2] - d) <= BAND });
export const slabBin = (h: number): Bin => ({ name: `the slab ${h} m above the floor`, has: (p) => Math.abs(p[0]) <= SLAB_MIDDLE && Math.abs(p[2]) <= SLAB_MIDDLE });
export const cubeBin = (d: number): Bin => ({ name: `${Math.round(d * 100)} cm`, has: (p) => Math.abs(p[0]) <= CUBE_HALF_SPAN && Math.abs(p[2] - CUBE_FACE_Z - d) <= BAND });

interface Off { lin: F32; ids: Ids; depth: Float32Array }
function readDepth(out: string, hash: unknown, what: string): Float32Array {
  const b = namedFile(out, typeof hash === 'string' ? hash : null, 'f32', `${what}: depth`);
  expect(b.length, `${what}: the depth target holds one f32 a pixel`).toBe(SIZE[0] * SIZE[1] * 4);
  const d = new Float32Array(SIZE[0] * SIZE[1]);
  for (let i = 0; i < d.length; i++) d[i] = b.readFloatLE(i * 4);
  return d;
}
const offCall = (doc: string): JsonObject => ({ call: 'view3d', doc, look: fixtureLook('none'), size: SIZE, frames: 1, targets: ['linear', 'ids', 'depth'], capture: [0] });
const onCall = (doc: string, ao: JsonObject): JsonObject => ({ call: 'view3d', doc, look: fixtureLook(ao), size: SIZE, frames: 1, targets: ['linear'], capture: [0] });

/**
 * Draws the document with `ao: none` and then with each `ao` in `variants`, in one process, and reads each bin.
 * Pixels read: the floor's (object-ID target), with all eight neighbours floor too, whose world point (the depth target
 * unprojected through the stated camera) falls in the bin. Reading = mean linear luminance with ao on ÷ with ao none.
 * Fails if the stated camera doesn't match the renderer (floor pixels that don't unproject onto y = 0) or a bin holds
 * too few pixels, so nothing absent reads as a number.
 */
export function measure(bin: string, out: string, doc: string, cam: Cam, variants: { label: string; ao: JsonObject }[], bins: Bin[], plant?: Plant): Map<string, Map<string, number>> {
  const what = `${cam.name}${plant ? ` (--planted ${plant})` : ''}`;
  const replies = draw(bin, out, [offCall(doc), ...variants.map((v) => onCall(doc, v.ao))], plant);
  const f0 = frameAt(replies[0]!, 0, `${what}, ao none`);
  const off: Off = { lin: readTarget(out, f0, 'linear', SIZE, `${what}, ao none`), ids: readIds(out, f0, `${what}, ao none`), depth: readDepth(out, f0.raw['depth'], `${what}, ao none`) };
  const [w, h] = SIZE;
  // Which pixels are interior floor, and where each lands.
  const where: (V3 | null)[] = new Array(w * h).fill(null);
  let floor = 0; let offPlane = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let interior = true;
    for (let j = -1; j <= 1 && interior; j++) for (let i = -1; i <= 1; i++) if (off.ids.at(x + i, y + j) !== 'floor') { interior = false; break; }
    const z = off.depth[y * w + x]!;
    // Beyond 10 m no bin reads, and a grazing floor's pixel spans more than the check's 5 mm.
    if (!interior || !(z > 0) || !Number.isFinite(z) || z > 10) continue;
    const p = unproject(cam, x + 0.5, y + 0.5, z);
    floor++;
    if (Math.abs(p[1]) > 0.005) { offPlane++; continue; }
    where[y * w + x] = p;
  }
  expect(floor, `${what}: the floor is in view (object-ID and depth targets)`).toBeGreaterThan(10_000);
  expect(offPlane / floor, `${what}: the stated camera matches the renderer: floor pixels unproject onto y = 0 within 5 mm (${offPlane} of ${floor} don't)`).toBeLessThanOrEqual(0.01);
  const result = new Map<string, Map<string, number>>();
  variants.forEach((v, k) => {
    const on = readTarget(out, frameAt(replies[k + 1]!, 0, `${what}, ${v.label}`), 'linear', SIZE, `${what}, ${v.label}`);
    const row = new Map<string, number>();
    for (const b of bins) {
      let n = 0; let sOn = 0; let sOff = 0;
      for (let i = 0; i < where.length; i++) {
        const p = where[i]; if (!p || !b.has(p)) continue;
        const x = i % w; const y = (i - x) / w;
        n++; sOn += luma(texel(on, x, y)); sOff += luma(texel(off.lin, x, y));
      }
      expect(n, `${what}, ${v.label}: ${b.name} holds enough floor pixels to read`).toBeGreaterThanOrEqual(50);
      expect(sOff / n, `${what}: the ambient light reaches ${b.name} with ao none`).toBeGreaterThan(0.01);
      row.set(b.name, sOn / sOff);
    }
    result.set(v.label, row);
  });
  return result;
}

// ---------------------------------------------------------------------------------------------------
// Closed forms, the f64 CPU reference and its twin

/** A floor point at distance d from a long wall: 1 − (acos a − a√(1 − a²)) ÷ π, a = d ÷ radius; 1 past the radius. */
export function wallClosed(d: number, radius = RADIUS): number {
  const a = d / radius;
  return a >= 1 ? 1 : 1 - (Math.acos(a) - a * Math.sqrt(1 - a * a)) / Math.PI;
}
/** A floor point under a wide slab at height h: (h ÷ radius)², 1 past the radius. */
export const slabClosed = (h: number, radius = RADIUS): number => Math.min(1, (h / radius) ** 2);

/** 4,096 directions about +Y on a 64 × 64 stratified grid: cosine-weighted (Malley's method) or, for the twin, uniform over the hemisphere. */
export function rays(weighting: 'cosine' | 'uniform', n = 64): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const u = (i + 0.5) / n; const phi = (2 * Math.PI * (j + 0.5)) / n;
    const cos = weighting === 'cosine' ? Math.sqrt(1 - u) : 1 - u;
    const sin = Math.sqrt(1 - cos * cos);
    out.push([sin * Math.cos(phi), cos, sin * Math.sin(phi)]);
  }
  return out;
}
/** Whether the ray o + t·d meets the box for 0 < t ≤ tmax (slab test, in f64). */
export function hits(o: V3, d: V3, b: Box, tmax: number): boolean {
  let near = 1e-9; let far = tmax;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(d[k]!) < 1e-15) { if (o[k]! < b.min[k]! || o[k]! > b.max[k]!) return false; continue; }
    let t0 = (b.min[k]! - o[k]!) / d[k]!; let t1 = (b.max[k]! - o[k]!) / d[k]!;
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0); far = Math.min(far, t1);
    if (near > far) return false;
  }
  return true;
}
/** The share of `dirs` from p that no occluder meets within the radius. */
export function visibility(p: V3, occluders: Box[], dirs: V3[], radius = RADIUS): number {
  let open = 0;
  for (const d of dirs) if (!occluders.some((b) => hits(p, d, b, radius))) open++;
  return open / dirs.length;
}
/** The cube's CPU reference at d in front of the face, averaged over the middle 10 cm (11 points), in f64. */
export function cubeReference(d: number, weighting: 'cosine' | 'uniform' = 'cosine'): number {
  const dirs = rays(weighting); const occ = CUBE_BOXES.filter((b) => b.id !== 'floor');
  const xs = grid(-CUBE_HALF_SPAN, CUBE_HALF_SPAN, 0.01);
  return xs.reduce((s, x) => s + visibility([x, 0, CUBE_FACE_Z + d], occ, dirs), 0) / xs.length;
}
/**
 * The same reference at one point, d in front of the middle of the face: what the issue's 0.68 and 0.81 state
 * (APPROVED.md, A). The GPU is still compared with `cubeReference`, the average over the band it reads.
 */
export function cubePointReference(d: number): number {
  return visibility([0, 0, CUBE_FACE_Z + d], CUBE_BOXES.filter((b) => b.id !== 'floor'), rays('cosine'));
}
/** The redraft's f64 closed form of the face (redraft-ac4/reference.ts `cubeFaceClosed`) averaged over the same 11 points as `cubeReference`. */
export function cubeBandClosedForm(d: number): number {
  const xs = grid(-CUBE_HALF_SPAN, CUBE_HALF_SPAN, 0.01);
  return xs.reduce((s, x) => s + cubeFaceClosed(d, x), 0) / xs.length;
}
/** The issue's stated numbers. */
export const ISSUE = {
  wall: [0.564, 0.626, 0.688, 0.748, 0.858, 0.948] as const,
  slab: [0.25, 0.5625] as const,
  cube: [0.68, 0.81] as const,
};

// ---------------------------------------------------------------------------------------------------
// Judges: each failure names where (fixture, camera, setting), the point or height, and the reading

export interface Row { point: string; reading: number; expected: number; tol: number; against: string }
export function judge(where: string, rows: Row[]): string[] {
  return rows.filter((r) => !(Math.abs(r.reading - r.expected) <= r.tol))
    .map((r) => `${where}: at ${r.point} the reading is ${r.reading.toFixed(3)}, outside ${r.against} ${r.expected.toFixed(4)} ± ${r.tol}`);
}
export const fmt = (m: Map<string, number>): string => [...m].map(([k, v]) => `${k} ${v.toFixed(3)}`).join(', ');

// ---------------------------------------------------------------------------------------------------
// The machine's GPU lease: crates/deep-show/src/kit/goldens.rs `GpuLease` holds `$HOME/.cache/deepbuild-gpu/lease`
// (created exclusively, holding its PID) while a kit or export draws; a file whose holder is gone is stale.

export const GPU_LEASE = join(process.env['HOME'] ?? tmpdir(), '.cache', 'deepbuild-gpu', 'lease');
export type Lease = { ok: true; ours: () => boolean; release: () => void } | { ok: false; reason: string };
/** Probes a PID with signal 0 (sends nothing); a process we may not signal still counts as alive. */
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}
export function takeGpuLease(file = GPU_LEASE): Lease {
  mkdirSync(dirname(file), { recursive: true });
  for (let tries = 0; tries < 3; tries++) {
    try {
      const fd = openSync(file, 'wx'); writeSync(fd, String(process.pid)); closeSync(fd);
      const ours = (): boolean => { try { return readFileSync(file, 'utf8').trim() === String(process.pid); } catch { return false; } };
      return { ok: true, ours, release: () => { if (ours()) unlinkSync(file); } };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let holder = NaN;
      try { holder = Number(readFileSync(file, 'utf8').trim()); } catch { /* removed meanwhile */ }
      if (Number.isInteger(holder) && holder > 0 && alive(holder)) return { ok: false, reason: `another GPU job holds the machine's GPU lease (${file}, process ${holder})` };
      try { unlinkSync(file); } catch { /* another taker removed it */ }
    }
  }
  return { ok: false, reason: `the machine's GPU lease (${file}) could not be taken` };
}

// ---------------------------------------------------------------------------------------------------
// git, for the unedited-#418 guard and main's own build

export function git(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
