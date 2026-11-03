// AC4: "Analytic uv1 on every builder with known charts has no overlapping charts, checked on fixtures"
//
// The parity fixture (parity/geometry/uv1-charts.scene) holds one item per builder with known charts: slab,
// lathe, extrude, plate, ball and tube. Each built item carries `uv1`, one per vertex, from the builder itself.
// Every triangle's uv1 has positive area (so no chart collapses to a point or a line, which would overlap
// nothing), and no two triangles' uv1 interiors overlap (reference.ts: uvOverlap, touching allowed), so no two
// charts overlap and no chart folds onto itself.

import { describe, it } from 'vitest';
import { AC, DOC, SLOW, admitted, fixture, geometryCall, meshRow, none, num, obj, runShow, scenario, sceneDoc, show, useDir, useShow, uvOf, type JsonObject } from './helpers.ts';
import { fmt, triAt, uvArea, uvOverlap, type V2 } from './reference.ts';

const bin = useShow();
const dir = useDir();
const SCENE = fixture('parity', 'geometry', 'uv1-charts.scene');
const ITEMS = obj(SCENE['items'], 'the fixture\'s items') as Record<string, JsonObject>;
const MIN_AREA = num(SCENE['min_area_rel'], 'min_area_rel');
const EPS = num(SCENE['overlap_eps_rel'], 'overlap_eps_rel');
const IDS = Object.keys(ITEMS);

type UvTri = [V2, V2, V2];

/** The uv1 problems of one item: collapsed triangles and overlapping pairs. */
function chartProblems(id: string, tris: UvTri[]): string[] {
  const out: string[] = [];
  const us = tris.flatMap((t) => t.map((p) => p[0])); const vs = tris.flatMap((t) => t.map((p) => p[1]));
  const extent = Math.max(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs));
  if (!(extent > 0)) return [`${id}: its uv1 spans nothing`];
  const flat = tris.map((t, k) => [k, Math.abs(uvArea(t))] as const).filter(([, a]) => !(a > MIN_AREA * extent * extent));
  if (flat.length) out.push(`${id}: ${flat.length} triangles have no uv1 area, such as triangle ${flat[0]![0]} (${fmt(flat[0]![1])})`);
  const box = tris.map((t) => [Math.min(...t.map((p) => p[0])), Math.min(...t.map((p) => p[1])), Math.max(...t.map((p) => p[0])), Math.max(...t.map((p) => p[1]))] as const);
  const eps = EPS * extent;
  let overlaps = 0; let first = '';
  for (let i = 0; i < tris.length; i++) {
    for (let j = i + 1; j < tris.length; j++) {
      const a = box[i]!; const b = box[j]!;
      if (a[2] <= b[0] + eps || b[2] <= a[0] + eps || a[3] <= b[1] + eps || b[3] <= a[1] + eps) continue;
      if (uvOverlap(tris[i]!, tris[j]!, eps)) { overlaps++; if (!first) first = `triangles ${i} and ${j}`; }
    }
  }
  if (overlaps) out.push(`${id}: ${overlaps} pairs of triangles overlap in uv1, such as ${first}`);
  return out;
}

describe(`${AC[4]} analytic uv1 on the builders with known charts`, () => {
  it(`${AC[4]} slab, lathe, extrude, plate, ball and tube each emit a uv1 whose charts don't overlap`, () => {
    const [shown, reply] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, sceneDoc('Analytic uv1', ITEMS)), geometryCall(DOC.a, IDS)]));
    admitted(shown!, 'the uv1 fixture');
    const problems: string[] = [];
    for (const id of IDS) {
      const g = meshRow(reply!, id, 'the fixture\'s geometry');
      const uv = uvOf(g, 'uv1', 'the fixture');
      const tris: UvTri[] = [];
      for (let t = 0; 3 * t < g.indices.length; t++) tris.push(triAt(g.indices, t).map((i) => uv[i]!) as UvTri);
      problems.push(...chartProblems(id, tris));
    }
    none(problems, 'analytic uv1');
  }, SLOW);
});
