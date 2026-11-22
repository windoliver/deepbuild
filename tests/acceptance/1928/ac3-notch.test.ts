// AC3: "An L-shaped slab 1 m thick on the outline (0, 0), (2, 0), (2, 1), (1, 1), (1, 2), (0, 2) m, offset on
// `parts: [top]` by 0.1 m, builds 18 points, 30 edges and 14 faces, an inner L of 1.8² − 1 = 2.24 m² and six ring
// faces of 0.76 m² in all, within 1e-9 relative, with the inner corner at the notch 0.1 m from both notch edges
// inside the face. A planted offset that moves that corner along the sum of its edge directions puts it on the
// notch side, leaves an inner L of 2.44 m² and fails, naming the corner"
//
// `ell` is `slab@1 {outline: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], thickness: 1}` (the outline in
// plan (x, z), y from 0 to 1 m) under `mod.offset_faces@1 {parts: [top], by: 0.1}`. Counts are the polygon
// view's (reference.ts). In the plane y = 1 the inner L is the face that touches none of the slab's 12 corners
// and the ring faces are the rest; areas are their boundary loops' (Newell), so a corner over 180° counts as it
// should. The notch is the slab's corner at plan (1, 1); its two edges lie on x = 1 and z = 1, and the face is
// where x < 1 or z < 1, so the inner L's corner there must sit at (0.9, 1, 0.9), within 1e-9 m. It is read as
// the inner L's corner nearest the notch, and a failure names it `the inner corner at the notch`.

import { describe, it } from 'vitest';
import { AC, DOC, ELL, SLOW, admitted, failsNaming, geometryCall, meshRow, none, offsetFaces, runShow, scenario, sceneDoc, show, useDir, useShow, type JsonObject, type Planted } from './helpers.ts';
import { PLACE, areaProblems, countProblems, countsOf, faceArea, fmt, fmtV, inPlane, length, relative, sub, touches, type V3 } from './reference.ts';

const bin = useShow();
const dir = useDir();

const doc = (): JsonObject => sceneDoc('An inset L', {
  ell: { kind: 'slab@1', params: ELL, modifiers: [offsetFaces({ parts: ['top'], by: 0.1 })] },
});
const OUTLINE: [number, number][] = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
const CORNERS: V3[] = OUTLINE.flatMap(([x, z]): V3[] => [[x, 0, z], [x, 1, z]]);
const NOTCH: V3 = [1, 1, 1];
const INSIDE: V3 = [0.9, 1, 0.9];

function notchProblems(planted?: Planted): string[] {
  const [shown, reply] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc()), geometryCall(DOC.a, ['ell'])], planted));
  admitted(shown, 'the inset L');
  const { view } = meshRow(reply, 'ell', 'the inset L');
  const out = countProblems('the inset L', countsOf(view), { points: 18, edges: 30, faces: 14 });
  const top = view.faces.filter((f) => inPlane(view, f, 1, 1));
  const inner = top.filter((f) => !touches(view, f, CORNERS));
  const rings = top.filter((f) => touches(view, f, CORNERS));
  if (inner.length !== 1) out.push(`the inset L: ${inner.length} faces in its top plane touch no corner of the slab, not the one inner L`);
  if (rings.length !== 6) out.push(`the inset L: ${rings.length} faces in its top plane touch a corner of the slab, not the six ring faces`);
  const ringArea = rings.reduce((sum, f) => sum + faceArea(view, f), 0);
  if (!(relative(ringArea, 0.76) <= 1e-9)) out.push(`the inset L: its ring faces are ${fmt(ringArea)} m² in all, not 0.76 m²`);
  for (const f of inner) {
    out.push(...areaProblems(view, f, 2.24, 1e-9, `the inset L: the inner L (face ${f.id})`));
    const corner = f.points.map((p) => view.points[p]!).reduce((best, p) => (length(sub(p, NOTCH)) < length(sub(best, NOTCH)) ? p : best));
    if (!corner.every((x, k) => Math.abs(x - INSIDE[k]!) <= PLACE)) out.push(`the inset L: the inner corner at the notch is at ${fmtV(corner)}, not at ${fmtV(INSIDE)}, 0.1 m from both notch edges inside the face`);
  }
  return out;
}

describe(`${AC[3]} an L-shaped slab's top inset by 0.1 m`, () => {
  it(`${AC[3]} the L builds 18 points, 30 edges and 14 faces, an inner L of 2.24 m², six ring faces of 0.76 m² in all, and the inner corner at the notch 0.1 m inside both notch edges`, () => {
    none(notchProblems(), 'the inset L');
  }, SLOW);

  it(`${AC[3]} the planted offset_corner_along_edges (a corner moved along the sum of its edge directions) puts the notch's corner on the notch side, leaves an inner L of 2.44 m² and fails, naming the corner`, () => {
    failsNaming(notchProblems('offset_corner_along_edges'), ['the inner corner at the notch is at (1.1, 1, 1.1)', /the inner L \(face \d+\): its area is 2\.44 m², not 2\.24 m²/], 'the planted offset_corner_along_edges');
  }, SLOW);
});
