// AC1 #224.855c9747: "A unit sphere written as x = cos u sin v, y = sin u sin v, z = cos v, with tolerance 0.001 m, stays
// within 0.001 m of radius 1 at 10,000 seeded (u, v), welds its u seam with no unwelded vertex pair closer than 1e-6 m,
// and its normals across the seam differ by less than 1°"
//
// `ball`, a `surface@1` of the criterion's formula over u ∈ [0, 2π] and v ∈ [0, π] at tolerance 0.001 m, one-sided
// (README: Readings), presented by `deep_show` and read back by `geometry` (positions, normals, indices).
//   - Radius: at 10,000 (u, v) drawn by mulberry32 seeded 224, the ray from the centre through the true point
//     (cos u sin v, sin u sin v, cos v) meets the drawn triangles at a distance within 0.001 m of 1.
//   - Weld: the u seam is where u = 0 and u = 2π meet, the half-plane y = 0, x > 0 (the poles, where a whole row meets
//     in one point, aren't the seam). No two drawn vertices there (used by a triangle) with different indices are closer
//     than 1e-6 m.
//   - Normals: at each seam point, the normal every triangle on the u > 0 side (centroid y > 0) shades with there and the
//     normal every triangle on the u < 2π side (centroid y < 0) shades with there are within 1° of each other, and both
//     sides meet there.
// Fails: no `surface@1`; a mesh that strays from the sphere or has holes; a seam left as two coincident columns; a seam
// welded in place but shaded from each side's own normals.
import { describe, expect, it } from 'vitest';
import {
  AC, PI, TAU, TIMEOUT, UNIT_SPHERE, admitted, angle, ask, cross, dot, geometry, len, meshOf, none, present, sceneDoc, seeded, sub, surface,
  useBins, type Mesh, type V3, DOC,
} from './helpers.ts';

useBins();
const ID = AC[1];

/** Möller–Trumbore from the origin along d: the distance to the triangle, or null. */
function rayHit(d: V3, [a, b, c]: [V3, V3, V3]): number | null {
  const e1 = sub(b, a);
  const e2 = sub(c, a);
  const p = cross(d, e2);
  const det = dot(e1, p);
  if (Math.abs(det) < 1e-300) return null;
  const inv = 1 / det;
  const s: V3 = [-a[0], -a[1], -a[2]];
  const u = dot(s, p) * inv;
  if (u < -1e-9 || u > 1 + 1e-9) return null;
  const q = cross(s, e1);
  const v = dot(d, q) * inv;
  if (v < -1e-9 || u + v > 1 + 1e-9) return null;
  const t = dot(e2, q) * inv;
  return t > 0 ? t : null;
}

/** The radius the drawn sphere has at `count` seeded (u, v), each more than 0.001 m from 1 a failure. */
function radiusFailures(m: Mesh, count: number): string[] {
  const tris: [V3, V3, V3][] = [];
  for (let t = 0; t < m.indices.length; t += 3) tris.push([m.positions[m.indices[t]!]!, m.positions[m.indices[t + 1]!]!, m.positions[m.indices[t + 2]!]!]);
  // Triangles bucketed by their corners' directions (z, then azimuth), so a ray meets only its own bucket's; one whose
  // corners' azimuths spread over more than half a turn (at a pole or across the seam) goes in every azimuth.
  const [SLABS, SECTORS] = [256, 128];
  const slab = (z: number): number => Math.min(SLABS - 1, Math.max(0, Math.floor(((z + 1) / 2) * SLABS)));
  const sector = (a: number): number => ((Math.floor(((a + PI) / TAU) * SECTORS) % SECTORS) + SECTORS) % SECTORS;
  const buckets: number[][] = Array.from({ length: SLABS * SECTORS }, () => []);
  tris.forEach((tri, k) => {
    const zs = tri.map((p) => (len(p) > 0 ? p[2] / len(p) : 0));
    const az = tri.map((p) => Math.atan2(p[1], p[0])).sort((x, y) => x - y);
    const wide = az[2]! - az[0]! > PI;
    const [a0, a1] = wide ? [0, SECTORS - 1] : [sector(az[0]! - 0.01), sector(az[2]! + 0.01)];
    for (let s = slab(Math.min(...zs) - 0.01); s <= slab(Math.max(...zs) + 0.01); s++) {
      for (let a = a0; ; a = (a + 1) % SECTORS) { buckets[s * SECTORS + a]!.push(k); if (a === a1) break; }
    }
  });
  const rand = seeded(224);
  const f: string[] = [];
  for (let i = 0; i < count; i++) {
    const u = rand() * TAU;
    const v = rand() * PI;
    const d: V3 = [Math.cos(u) * Math.sin(v), Math.sin(u) * Math.sin(v), Math.cos(v)];
    let hit: number | null = null;
    for (const k of buckets[slab(d[2]) * SECTORS + sector(Math.atan2(d[1], d[0]))]!) {
      const t = rayHit(d, tris[k]!);
      if (t !== null && (hit === null || Math.abs(t - 1) > Math.abs(hit - 1))) hit = t;
    }
    if (hit === null) f.push(`at (u, v) = (${u.toFixed(6)}, ${v.toFixed(6)}) the ray from the centre meets no triangle: a hole`);
    else if (Math.abs(hit - 1) > 0.001) f.push(`at (u, v) = (${u.toFixed(6)}, ${v.toFixed(6)}) the drawn sphere is at radius ${hit}, ${Math.abs(hit - 1).toExponential(3)} m from 1`);
  }
  return f;
}

/** The u seam's vertices: on the half-plane y = 0, x > 0, the poles left out. */
const onSeam = (p: V3): boolean => Math.abs(p[1]) <= 1e-9 && p[0] > 1e-6;

function seamFailures(m: Mesh): { weld: string[]; normals: string[] } {
  const used = new Set(m.indices);
  const seam = m.positions.map((p, i) => [p, i] as const).filter(([p, i]) => used.has(i) && onSeam(p)).sort((x, y) => x[0][2] - y[0][2]);
  const weld: string[] = [];
  const normals: string[] = [];
  if (seam.length < 3) return { weld: [`the u seam (y = 0, x > 0) holds ${seam.length} vertices: the sphere has no seam column`], normals };
  for (let i = 0; i < seam.length; i++) {
    for (let j = i + 1; j < seam.length && seam[j]![0][2] - seam[i]![0][2] < 1e-6; j++) {
      const d = Math.hypot(...sub(seam[i]![0], seam[j]![0]));
      if (d < 1e-6) weld.push(`vertices ${seam[i]![1]} and ${seam[j]![1]} at z = ${seam[i]![0][2].toFixed(9)} are ${d.toExponential(2)} m apart and unwelded`);
    }
  }
  const sides = new Map<string, { z: number; plus: V3[]; minus: V3[] }>();
  for (let t = 0; t < m.indices.length; t += 3) {
    const c = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
    const y = (m.positions[c[0]!]![1] + m.positions[c[1]!]![1] + m.positions[c[2]!]![1]) / 3;
    if (y === 0) continue;
    for (const i of c) {
      const p = m.positions[i]!;
      if (!onSeam(p)) continue;
      const key = p.map((x) => Math.round(x / 1e-9)).join(',');
      let g = sides.get(key);
      if (!g) { g = { z: p[2], plus: [], minus: [] }; sides.set(key, g); }
      (y > 0 ? g.plus : g.minus).push(m.normals[i]!);
    }
  }
  for (const g of sides.values()) {
    if (!g.plus.length || !g.minus.length) { normals.push(`the seam point at z = ${g.z.toFixed(6)} is shaded from one side only`); continue; }
    let worst = 0;
    for (const a of g.plus) for (const b of g.minus) worst = Math.max(worst, angle(a, b));
    if (worst >= 1) normals.push(`at the seam point z = ${g.z.toFixed(6)} the normals on the two sides differ by ${worst.toFixed(3)}°`);
  }
  return { weld, normals };
}

describe(`${ID} the unit sphere from a formula`, () => {
  it(`${ID} within 0.001 m of radius 1 at 10,000 seeded (u, v), its u seam welded with no unwelded vertex pair closer than 1e-6 m, and its normals across the seam within 1°`, () => {
    const [shownReply, geo] = ask([present(DOC(1), sceneDoc('The unit sphere', { ball: surface(UNIT_SPHERE) })), geometry(DOC(1), ['ball'])]);
    admitted(shownReply, 'the unit sphere');
    const m = meshOf(geo, 'ball', 'the unit sphere');
    expect(m.normals.length, 'the unit sphere: one normal per vertex').toBe(m.positions.length);
    none(radiusFailures(m, 10_000), 'the drawn unit sphere stays within 0.001 m of radius 1 at 10,000 seeded (u, v)');
    const seam = seamFailures(m);
    none(seam.weld, 'the u seam is welded: no unwelded vertex pair closer than 1e-6 m');
    none(seam.normals, 'the normals across the u seam differ by less than 1°');
  }, TIMEOUT);
});
