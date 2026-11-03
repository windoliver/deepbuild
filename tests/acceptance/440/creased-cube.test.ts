// AC2: "A creased cube subdivided twice stays sharp along its creased edges and rounds elsewhere, with its
// vertex, edge and face counts known exactly before the build (Catmull-Clark turns an n-gon into n quads at the
// first level, then each quad into four)"
//
// A 1 m slab@1 box with `mod.subdivide@1 {levels: 2, creases: {top: 1}}`: the slab's `top` part (its upper face)
// creased at 1, so its four edges are sharp at both levels. Before the build (`estimate_only`, nothing built) the
// row declares the welded points, edges and faces the design's formulas give for 8 points, 12 edges, 6 faces and
// C = 24 corners: 98, 192 and 96. The build has exactly those, counted on welded positions with a face's
// diagonals left out, and its points are the creased Catmull-Clark surface's (reference.ts, within 1e-9 m): the
// top stays one flat face whose 25 points sit at y = 1 and whose creased edges stay a sharp rim, while every
// other point has moved off the cube's other faces (the lowest above y = 0).

import { describe, expect, it } from 'vitest';
import { AC, DOC, SLOW, admitted, buildsOf, declaredRow, facesOf, geometryCall, meshRow, none, num, runShow, scenario, sceneDoc, show, useDir, useShow, type JsonObject } from './helpers.ts';
import { catmullClark, ccCounts, dist, edgeKey, fmt, fmtV, meshEdges, slabBox, weld, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();
const TOL = 1e-9;

const cube = (): Record<string, JsonObject> => ({
  cube: { kind: 'slab@1', params: { size: [1, 1, 1] }, modifiers: [{ kind: 'mod.subdivide@1', params: { levels: 2, creases: { top: 1 } } }] },
});

describe(`${AC[2]} a creased cube subdivided twice`, () => {
  it(`${AC[2]} declares 98 points, 192 edges and 96 faces before the build, builds them, and is sharp only along its creased edges`, () => {
    const [shown, estimate, built] = runShow(bin(), scenario(dir(), [DOC.a], [
      show(DOC.a, sceneDoc('A creased cube', cube())), geometryCall(DOC.a, ['cube'], { estimate_only: true }), geometryCall(DOC.a, ['cube']),
    ]));
    admitted(shown!, 'the creased cube');
    const want = ccCounts(8, 12, 6, 24, 2);
    expect(want).toEqual({ V: 98, E: 192, F: 96 });
    const problems: string[] = [];

    // Counted before the build.
    expect(buildsOf(estimate!, 'the estimate'), 'estimate_only builds nothing').toBe(0);
    const d = declaredRow(estimate!, 'cube', 'the estimate').raw;
    const declared = { V: num(d['points'], 'declared.points'), E: num(d['edges'], 'declared.edges'), F: num(d['faces'], 'declared.faces') };
    for (const k of ['V', 'E', 'F'] as const) if (declared[k] !== want[k]) problems.push(`declared ${{ V: 'points', E: 'edges', F: 'faces' }[k]} before the build: ${declared[k]}, not ${want[k]}`);

    // Built.
    const g = meshRow(built!, 'cube', 'the creased cube\'s geometry');
    const faces = facesOf(g, 'the creased cube');
    const w = weld(g.positions);
    const built3 = { V: w.points.length, E: meshEdges(g.positions, g.indices, faces).quads.size, F: new Set(faces).size };
    for (const k of ['V', 'E', 'F'] as const) if (built3[k] !== want[k]) problems.push(`built ${{ V: 'welded points', E: 'edges', F: 'faces' }[k]}: ${built3[k]}, not the ${want[k]} counted before the build`);

    // The creased surface.
    const { mesh, top } = slabBox([1, 1, 1]);
    const crease = new Set(top.map((a, i) => edgeKey(a, top[(i + 1) % top.length]!)));
    const ref = catmullClark(mesh, crease, 2).points;
    const nearest = (p: V3, set: V3[]): number => Math.min(...set.map((q) => dist(p, q)));
    for (const p of w.points) {
      const e = nearest(p, ref);
      if (e > TOL) problems.push(`point ${fmtV(p)} is off the creased Catmull-Clark surface by ${fmt(e)} m`);
    }
    const missing = ref.filter((q) => nearest(q, w.points) > TOL);
    if (missing.length) problems.push(`${missing.length} points of the creased surface are missing, such as ${missing.slice(0, 4).map(fmtV).join(' ')}`);
    const onTop = w.points.filter((p) => Math.abs(p[1] - 1) <= TOL).length;
    if (onTop !== 25) problems.push(`${onTop} points lie on the creased top at y = 1, not 25: the top isn't kept flat and sharp along its creased edges`);
    const above = w.points.filter((p) => p[1] > 1 + TOL).map(fmtV);
    if (above.length) problems.push(`points rise above the creased top: ${above.slice(0, 4).join(' ')}`);
    const low = Math.min(...w.points.map((p) => p[1]));
    if (!(low > TOL)) problems.push(`the lowest point is at y = ${fmt(low)}: the uncreased bottom doesn't round`);
    none(problems, 'the creased cube');
  }, SLOW);
});
