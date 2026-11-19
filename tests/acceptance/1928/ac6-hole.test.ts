// AC6: "`offset_faces {parts: [top], by: 0.3}` and then `dissolve` give back the plain cube's 8 points, 12 edges
// and 6 faces. With `inner: panel`, the four ring faces around `panel` would merge into a face with a hole, so
// all four stay: 12 points, 20 edges and 10 faces, with the warning `dissolve.hole` naming those four faces. A
// planted dissolve that merges two faces at a time in index order leaves fewer than four ring faces and fails,
// naming the part"
//
// Two 1 m slab cubes, each under `mod.offset_faces@1` and then `mod.dissolve@1`: `flat` with {parts: [top], by:
// 0.3}, and `framed` with {parts: [top], by: 0.3, inner: panel}. Counts are the polygon view's (reference.ts).
// `flat`'s welded points must be the cube's 8 corners. On `framed` the ring faces are the faces of part `top`
// (the ring faces keep the source face's part and the inner face takes `panel`), read from the row's `parts`:
// there must be four, and a failure about them names `part top`. The warning is an issue of the presented
// revision with code `dissolve.hole` and severity `warning`, whose `item` is `framed` and whose `faces` are those
// four faces' IDs, as the row's `faces` numbers them.

import { describe, it } from 'vitest';
import { AC, CUBE, DOC, SLOW, admitted, dissolve, failsNaming, fieldOf, geometryCall, meshRow, none, offsetFaces, partsOfFaces, runShow, scenario, sceneDoc, show, shown, useDir, useShow, type JsonObject, type Planted } from './helpers.ts';
import { boxCorners, countProblems, countsOf, weldKey } from './reference.ts';

const bin = useShow();
const dir = useDir();

const doc = (): JsonObject => sceneDoc('An offset dissolved back, and one kept by a hole', {
  flat: { kind: 'slab@1', params: CUBE, modifiers: [offsetFaces({ parts: ['top'], by: 0.3 }), dissolve()] },
  framed: { kind: 'slab@1', params: CUBE, modifiers: [offsetFaces({ parts: ['top'], by: 0.3, inner: 'panel' }), dissolve()] },
});
const CORNERS = boxCorners([-0.5, 0, -0.5], [0.5, 1, 0.5]);
const sorted = (ids: readonly number[]): number[] => [...ids].sort((a, b) => a - b);

function holeProblems(planted?: Planted): string[] {
  const [shown0, reply] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc()), geometryCall(DOC.a, ['flat', 'framed'])], planted));
  const issues = admitted(shown0, 'the two cubes');

  // Without `inner`, the offset dissolves back into the plain cube.
  const flat = meshRow(reply, 'flat', 'flat').view;
  const out = countProblems('flat', countsOf(flat), { points: 8, edges: 12, faces: 6 });
  const corners = new Set(CORNERS.map(weldKey));
  if (!(flat.points.length === 8 && flat.points.every((p) => corners.has(weldKey(p))))) out.push('flat: its points are not the plain cube\'s 8 corners');

  // With `inner: panel`, the four ring faces stay.
  const framed = meshRow(reply, 'framed', 'framed');
  out.push(...countProblems('framed', countsOf(framed.view), { points: 12, edges: 20, faces: 10 }));
  const parts = partsOfFaces(framed, 'framed');
  const inPart = (name: string): number[] => sorted(framed.view.faces.filter((f) => parts.get(f.id)?.includes(name)).map((f) => f.id));
  const rings = inPart('top');
  if (rings.length !== 4) out.push(`framed: part top holds ${rings.length} faces, not the four ring faces around panel`);
  if (inPart('panel').length !== 1) out.push(`framed: part panel holds ${inPart('panel').length} faces, not the one inner face`);

  // The warning names the item and those four faces.
  const holes = issues.filter((i) => i.code === 'dissolve.hole' && fieldOf(i, 'item') === 'framed');
  if (holes.length === 0) out.push(`framed: no issue dissolve.hole names the item; the issues were ${shown(issues.map((i) => i.raw))}`);
  for (const i of holes) {
    if (i.severity !== 'warning') out.push(`framed: dissolve.hole has severity ${i.severity}, not warning`);
    const faces = fieldOf(i, 'faces');
    const named = Array.isArray(faces) && faces.every((f) => typeof f === 'number') ? sorted(faces as number[]) : null;
    if (named === null || JSON.stringify(named) !== JSON.stringify(rings)) out.push(`framed: dissolve.hole names faces ${shown(faces)}, not the ring faces ${JSON.stringify(rings)} of part top`);
  }
  return out;
}

describe(`${AC[6]} an offset dissolves back, unless merging would leave a hole`, () => {
  it(`${AC[6]} offset by 0.3 and dissolve give back the cube's 8 points, 12 edges and 6 faces; with inner: panel the four ring faces stay (12 points, 20 edges, 10 faces) and dissolve.hole names them`, () => {
    none(holeProblems(), 'offset and dissolve');
  }, SLOW);

  it(`${AC[6]} the planted dissolve_merges_pairs (two faces merged at a time in index order) leaves fewer than four ring faces and fails, naming the part`, () => {
    failsNaming(holeProblems('dissolve_merges_pairs'), [/framed: part top holds [0-3] faces, not the four ring faces around panel/], 'the planted dissolve_merges_pairs');
  }, SLOW);
});
