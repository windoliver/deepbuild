// AC4: "A flat-shaded low-poly tree builds one normal per face and at most three vertices per triangle, counted
// before it builds"
//
// The tree is a recipe in a test pack (`test/lowpoly@1.0.0`, `lowpoly.tree@1`): a six-sided tapered trunk
// (lathe@1) under a crown that is an icosahedron split once (ball@1, geodesic, detail 1), both `shade: flat`,
// expanded at check into `tree.trunk` and `tree.crown` (#306's derived IDs). Counted before it builds: the
// `geometry` call with `estimate_only` builds nothing and declares each part's count, the crown's 3 × 20 × (1 + 1)²
// = 240 by the design's formula (Builder `ball`: tessellation), and the build then makes exactly that many. One
// normal per face: every triangle's three vertex normals are one unit vector, the triangle's own geometric
// normal, facing out; no vertex is shared by two triangles; so vertices = 3 × triangles. The planted
// `flat_as_smooth` (a mutant: flat builds smooth normals over shared vertices) must fail, naming the part.

import { describe, expect, it } from 'vitest';
import {
  AC, CAMERA, DOC, LOWPOLY, admitted, cross, dot, failsNaming, geometryCall, geometryOf, itemOf, length, none, packAt, runShow, scenario, sceneDoc,
  show, sub, unit, useBins, useDir, type Geometry, type GeometryReply, type JsonObject, type ShowPlanted, type V3,
} from './helpers.ts';

const bins = useBins(['deep-show']);
const dir = useDir();
const PARTS = ['tree.trunk', 'tree.crown'] as const;
/** The design's count for a geodesic icosahedron at detail 1: 3 × faces × (detail + 1)². */
const CROWN_VERTICES = 3 * 20 * 2 ** 2;

const treeDoc = (): JsonObject => sceneDoc('A low-poly tree', {
  cam: CAMERA,
  tree: { kind: 'lowpoly.tree@1', params: { height: 2 }, at: { pos: [0, 0, 0] } },
}, { packs: [packAt(LOWPOLY)] });

function tree(planted?: ShowPlanted): { estimate: GeometryReply; full: GeometryReply } {
  const [shown, estimate, full] = runShow(bins.bin('deep-show'), scenario(dir(), [DOC.a], [
    show(DOC.a, treeDoc()),
    geometryCall(DOC.a, { items: [...PARTS], t: '0s', estimate_only: true }),
    geometryCall(DOC.a, { items: [...PARTS], t: '0s', stage: 'final' }),
  ], { packs: [LOWPOLY], ...(planted ? { planted } : {}) }));
  admitted(shown!, 'the tree');
  return { estimate: geometryOf(estimate!, 'the tree counted before it builds'), full: geometryOf(full!, 'the tree built') };
}

/** One normal per face and at most three vertices per triangle; each failure names the part. */
function flatProblems(name: string, g: Geometry): string[] {
  const out: string[] = [];
  const T = g.indices.length / 3;
  if (T === 0) return [`${name}: builds no triangle`];
  if (g.normals.length !== g.positions.length) return [`${name}: ${g.normals.length} normals for ${g.positions.length} vertices`];
  if (g.positions.length > 3 * T) out.push(`${name}: ${g.positions.length} vertices for ${T} triangles, more than three per triangle`);
  const uses = new Map<number, number>();
  for (const i of g.indices) uses.set(i, (uses.get(i) ?? 0) + 1);
  const shared = [...uses.values()].filter((n) => n > 1).length;
  if (shared > 0) out.push(`${name}: ${shared} vertices are shared by more than one triangle, so a face's normal isn't its own`);
  let centre: V3 = [0, 0, 0];
  for (const p of g.positions) centre = [centre[0] + p[0] / g.positions.length, centre[1] + p[1] / g.positions.length, centre[2] + p[2] / g.positions.length];
  let bent = 0; let inward = 0;
  for (let t = 0; t < T; t++) {
    const ids = [g.indices[3 * t]!, g.indices[3 * t + 1]!, g.indices[3 * t + 2]!];
    const [a, b, c] = ids.map((i) => g.positions[i]!) as [V3, V3, V3];
    const n = cross(sub(b, a), sub(c, a));
    if (length(n) < 1e-12) continue;
    const face = unit(n);
    if (ids.some((i) => { const v = g.normals[i]!; return Math.abs(length(v) - 1) > 1e-5 || dot(unit(v), face) < 1 - 1e-6; })) bent++;
    const mid: V3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    if (dot(face, sub(mid, centre)) < 0) inward++;
  }
  if (bent > 0) out.push(`${name}: ${bent} of ${T} triangles carry a vertex normal that isn't the face's own normal`);
  if (inward > 0) out.push(`${name}: ${inward} of ${T} triangles face inward`);
  return out;
}

describe(`${AC[4]} a flat-shaded low-poly tree`, () => {
  it(`${AC[4]} the tree's trunk and crown are counted before they build (the crown's ${CROWN_VERTICES} by the design's formula), build exactly that many vertices, at most three per triangle, and one normal per face`, () => {
    const { estimate, full } = tree();
    expect(estimate.builds, 'estimate_only builds nothing').toBe(0);
    for (const part of PARTS) {
      const e = itemOf(estimate, part, 'the estimate');
      const g = itemOf(full, part, 'the build');
      expect(e.built, `${part}: counted without a mesh`).toBe(false);
      expect(e.declared, `${part}: the count before the build is the build's`).toBe(g.positions.length);
      expect(g.declared, `${part}: the build declares what it builds`).toBe(g.positions.length);
      expect(g.positions.length, `${part}: flat, so exactly three vertices per triangle`).toBe(g.indices.length);
      none(flatProblems(part, g), `${part}: flat shading`);
    }
    expect(itemOf(estimate, 'tree.crown', 'the estimate').declared, 'the crown: 3 × 20 × (1 + 1)² vertices').toBe(CROWN_VERTICES);
    expect(itemOf(full, 'tree.crown', 'the build').indices.length / 3, 'the crown: 20 × 4 triangles').toBe(80);
  }, 900_000);

  it(`${AC[4]} the planted flat_as_smooth (a mutant: smooth normals over shared vertices) fails the flat check, naming tree.crown`, () => {
    const { full } = tree('flat_as_smooth');
    const problems = PARTS.flatMap((p) => { const g = full.items.get(p); return g ? flatProblems(p, g) : [`${p}: missing`]; });
    failsNaming(problems, ['tree.crown'], 'the planted flat_as_smooth');
  }, 900_000);
});
