// AC5: "A picture frame swept along a closed linear 0.40 × 0.30 m rectangle, with a 0.02 × 0.02 m square outline
// centered on the curve, builds watertight with V − E + F = 0 and a volume of 0.0004 m² × 1.40 m = 0.00056 m³
// within 1e-9 relative; a planted sweep that sets each corner's ring square to one side instead of mitering it
// misses the volume and fails, naming the corner"
//
// The parity fixture (parity/geometry/sweep-picture-frame.scene) holds the rectangle, the frame and the expected
// values. The frame's mesh is welded at 1e-6 m: no edge on one triangle or on more than two, none wound the same
// way twice, V − E + F = 0, and the divergence-theorem volume within 1e-9 relative of 0.00056 m³. Each corner's
// ring (found by its u) must hold the mitered outline the fixture's formula gives, within 1e-9 m, as a set of
// points; that is how a failure names the corner, by its address rect#p<id>. The twin (`corner_square`) must miss
// the volume and fail at each corner.

import { describe, it } from 'vitest';
import { AC, DOC, SLOW, admitted, failsNaming, fixture, geometryCall, meshRow, none, num, obj, runShow, scenario, sceneDoc, show, useDir, useShow, type JsonObject, type MeshRow, type ShowPlanted } from './helpers.ts';
import { add, cross, dist, fmt, fmtV, scale, sub, topology, unit, volumeOf, weld, weldedTriangles, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();
const SCENE = fixture('parity', 'geometry', 'sweep-picture-frame.scene');
const ITEMS = obj(SCENE['items'], 'the fixture\'s items') as Record<string, JsonObject>;
const RECT = obj(ITEMS['rect']!['params'], 'the rectangle\'s params');
const POINTS = RECT['points'] as V3[];
const IDS = RECT['ids'] as number[];
const OUTLINE = obj(ITEMS['frame']!['params'], 'the frame\'s params')['outline'] as [number, number][];
const VOLUME = num(SCENE['volume'], 'volume');
const VOLUME_REL = num(SCENE['volume_rel'], 'volume_rel');
const CORNER_TOL = num(SCENE['corner_tolerance_m'], 'corner_tolerance_m');
const TWIN = (SCENE['twins'] as JsonObject[])[0]!;
const N: V3 = [0, 1, 0];

/** Each corner: its address, point, u, and the mitered outline the fixture's formula gives. */
const CORNERS = (() => {
  const n = POINTS.length;
  const sides = POINTS.map((p, k) => dist(POINTS[(k + 1) % n]!, p));
  const perimeter = sides.reduce((a, b) => a + b, 0);
  let s = 0;
  return POINTS.map((p, k) => {
    const u = s / perimeter;
    s += sides[k]!;
    const tIn = unit(sub(p, POINTS[(k + n - 1) % n]!));
    const tOut = unit(sub(POINTS[(k + 1) % n]!, p));
    const miter = add(cross(tIn, N), cross(tOut, N));
    const across = scale(miter, 2 / (miter[0] ** 2 + miter[1] ** 2 + miter[2] ** 2));
    return { name: `rect#p${IDS[k]!}`, point: p, u, expected: OUTLINE.map(([x, y]) => add(add(p, scale(N, x)), scale(across, y))) };
  });
})();

function built(planted?: ShowPlanted): MeshRow {
  const [shown, reply] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, sceneDoc('A picture frame', ITEMS)), geometryCall(DOC.a, ['frame'])], planted));
  admitted(shown!, 'the picture frame document');
  return meshRow(reply!, 'frame', 'geometry of the frame');
}

/** Every check AC5 names; corner failures start with `corner rect#p<id> `. */
function frameProblems(g: MeshRow): string[] {
  const out: string[] = [];
  const w = weld(g.positions);
  const tris = weldedTriangles(g.indices, w.ids);
  const t = topology(tris);
  if (t.open > 0) out.push(`the frame has ${t.open} open edges`);
  if (t.nonManifold > 0) out.push(`the frame has ${t.nonManifold} edges on more than two triangles`);
  if (t.misoriented > 0) out.push(`the frame has ${t.misoriented} edges its two triangles wind the same way`);
  if (t.V - t.E + t.F !== 0) out.push(`the frame's V − E + F = ${t.V} − ${t.E} + ${t.F} = ${t.V - t.E + t.F}, not 0`);
  const v = volumeOf(w.points, tris);
  if (!(Math.abs(v - VOLUME) <= VOLUME_REL * VOLUME)) out.push(`the frame's volume is ${v} m³, not ${VOLUME} m³ within ${VOLUME_REL} relative`);
  for (const c of CORNERS) {
    const at = `corner ${c.name} ${fmtV(c.point)}`;
    const rings = g.rings.filter((r) => Math.abs(r.u - c.u) <= 1e-12 || (c.u === 0 && Math.abs(r.u - 1) <= 1e-12));
    if (rings.length === 0) { out.push(`${at}: no ring at its u = ${fmt(c.u)}`); continue; }
    for (const r of rings) {
      const got = r.vertices.map((i) => g.positions[i]!);
      const missing = c.expected.filter((e) => !got.some((p) => dist(p, e) <= CORNER_TOL));
      if (missing.length || got.length !== c.expected.length) out.push(`${at}: its ring at u = ${fmt(r.u)} is not mitered: it holds ${got.map(fmtV).join(' ')}; the miter is ${c.expected.map(fmtV).join(' ')}`);
    }
  }
  return out;
}

describe(`${AC[5]} a picture frame swept along a closed rectangle`, () => {
  it(`${AC[5]} the frame builds watertight with V − E + F = 0 and 0.00056 m³ within 1e-9 relative, its four corners mitered`, () => {
    none(frameProblems(built()), 'the picture frame');
  }, SLOW);

  it(`${AC[5]} the planted ${String(TWIN['planted'])} (corners set square) misses the volume and fails, naming each corner`, () => {
    failsNaming(frameProblems(built(TWIN['planted'] as ShowPlanted)), TWIN['names'] as string[], `the planted ${String(TWIN['planted'])}`);
  }, SLOW);
});
