// CPU references for the #1640 acceptance tests, reviewed test code (design: the parity suite, "CPU references …
// stay reviewed test code"): vector math; welding at 1e-6 m, the rule #420's mesh edges count on; the crease and
// border rule on a triangle mesh, read on welded positions (README: Readings); the 100,000-triangle folded sheet
// AC3 orbits and its glTF; and #378's pinhole projection. Nothing here reads the implementation.

import { createHash } from 'node:crypto';

export type V3 = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => { const l = length(a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** Welding: positions equal to 1e-6 m (by rounding to a 1e-6 m grid) are one point (#420's rule for mesh edges). */
export const WELD = 1e-6;
export const weldKey = (p: V3): string => p.map((x) => Math.round(x / WELD)).join(',');

export interface TriMesh { positions: V3[]; triangles: [number, number, number][] }

/**
 * The edges a crease line draws (README: Readings): on welded positions, each edge of a non-degenerate triangle once;
 * an edge with exactly two triangles is a crease when the angle between their normals is above `angle` degrees, an
 * edge with exactly one is a border, drawn when `border` is true. Returns each edge by its two welded points.
 */
export function creaseReference(m: TriMesh, angle: number, border: boolean): [V3, V3][] {
  const ids = new Map<string, number>();
  const points: V3[] = [];
  const at = m.positions.map((p) => {
    const k = weldKey(p);
    let id = ids.get(k);
    if (id === undefined) { id = points.length; ids.set(k, id); points.push(p); }
    return id;
  });
  const edges = new Map<string, { ends: [number, number]; normals: V3[] }>();
  for (const [a0, b0, c0] of m.triangles) {
    const t = [at[a0]!, at[b0]!, at[c0]!] as const;
    if (t[0] === t[1] || t[1] === t[2] || t[2] === t[0]) continue;
    const n = cross(sub(points[t[1]]!, points[t[0]]!), sub(points[t[2]]!, points[t[0]]!));
    if (length(n) === 0) continue;
    const normal = unit(n);
    for (let j = 0; j < 3; j++) {
      const [u, v] = [t[j]!, t[(j + 1) % 3]!];
      const ends: [number, number] = u < v ? [u, v] : [v, u];
      const key = `${ends[0]}-${ends[1]}`;
      const e = edges.get(key) ?? { ends, normals: [] };
      e.normals.push(normal);
      edges.set(key, e);
    }
  }
  const cos = Math.cos((angle * Math.PI) / 180);
  const out: [V3, V3][] = [];
  for (const e of edges.values()) {
    const keep = e.normals.length === 1 ? border : e.normals.length === 2 && dot(e.normals[0]!, e.normals[1]!) < cos;
    if (keep) out.push([points[e.ends[0]]!, points[e.ends[1]]!]);
  }
  return out;
}

/**
 * AC3's asset: a folded sheet of 250 × 200 quads, 100,000 triangles, 0.02 m apart, x in [−2.5, 2.5] m, z in [−2, 2] m,
 * its height a triangle wave in x at 45°, so it folds at 90° along x = −1.5, −0.5, 0.5 and 1.5 m (ridges at the first
 * and third, valleys at the others) and is flat between. With `crease {angle: 30}` and `border: false` it draws the
 * four fold lines, 200 edges each; every quad is planar, so no diagonal is a crease. Positions are rounded to f32,
 * as the glTF holds them; triangles wind counter-clockwise seen from above.
 */
export const SHEET = { nx: 250, nz: 200, step: 0.02, period: 100, folds: 4 } as const;
export function foldedSheet(): TriMesh {
  const { nx, nz, step, period } = SHEET;
  const positions: V3[] = [];
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const y = step * (period / 2 - Math.abs((i % period) - period / 2));
      positions.push([Math.fround(-2.5 + step * i), Math.fround(y), Math.fround(-2 + step * j)]);
    }
  }
  const at = (i: number, j: number): number => j * (nx + 1) + i;
  const triangles: [number, number, number][] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      triangles.push([at(i, j), at(i, j + 1), at(i + 1, j + 1)]);
      triangles.push([at(i, j), at(i + 1, j + 1), at(i + 1, j)]);
    }
  }
  return { positions, triangles };
}

/** A JSON glTF of `m` (POSITION and u32 indices, one node, no material, no normals), its buffer inline as a data URI,
 * as #420's `mesh.asset@1` reads it; its bytes and their SHA-256. */
export function gltf(m: TriMesh): { bytes: Buffer; sha: string } {
  const pos = Buffer.alloc(m.positions.length * 12);
  const idx = Buffer.alloc(m.triangles.length * 12);
  m.positions.forEach((p, i) => p.forEach((v, k) => pos.writeFloatLE(v, i * 12 + k * 4)));
  m.triangles.forEach((t, i) => t.forEach((v, k) => idx.writeUInt32LE(v, i * 12 + k * 4)));
  const lo = [0, 1, 2].map((k) => m.positions.reduce((s, p) => Math.min(s, p[k]!), Infinity));
  const hi = [0, 1, 2].map((k) => m.positions.reduce((s, p) => Math.max(s, p[k]!), -Infinity));
  const doc = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: m.positions.length, type: 'VEC3', min: lo, max: hi },
      { bufferView: 1, componentType: 5125, count: m.triangles.length * 3, type: 'SCALAR' },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.length }, { buffer: 0, byteOffset: pos.length, byteLength: idx.length }],
    buffers: [{ byteLength: pos.length + idx.length, uri: `data:application/octet-stream;base64,${Buffer.concat([pos, idx]).toString('base64')}` }],
  };
  const bytes = Buffer.from(JSON.stringify(doc));
  return { bytes, sha: createHash('sha256').update(bytes).digest('hex') };
}

/** #378's pinhole: position, target, +Y up, fov across the wider side. A world point to frame px and its depth. */
export interface Pinhole { position: V3; target: V3; fov: number; size: [number, number] }
export function project(cam: Pinhole, p: V3): [number, number, number] {
  const f = unit(sub(cam.target, cam.position));
  const r = unit(cross(f, [0, 1, 0]));
  const u = cross(r, f);
  const d = sub(p, cam.position);
  const z = dot(d, f);
  const focal = Math.max(...cam.size) / 2 / Math.tan((cam.fov * Math.PI) / 360);
  return [cam.size[0] / 2 + (focal * dot(d, r)) / z, cam.size[1] / 2 - (focal * dot(d, u)) / z, z];
}
