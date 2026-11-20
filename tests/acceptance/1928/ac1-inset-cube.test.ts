// AC1: "A 1 m slab cube with `offset_faces {parts: [top], by: 0.1}` builds 12 points, 20 edges and 10 faces,
// V − E + F = 2 on welded positions, with an inner face of 0.64 m² and four ring faces of 0.09 m² each in its top
// plane, within 1e-9 relative. A planted offset that moves each corner `by` along its bisector leaves an inner
// face of 0.737157 m² and fails, naming the face"
//
// `cube` is `slab@1 {size: [1, 1, 1]}` (x and z from −0.5 to 0.5 m, y from 0 to 1 m) under `mod.offset_faces@1
// {parts: [top], by: 0.1}`. Its `geometry` row is read as polygons (reference.ts: polygons): welded points,
// boundary edges and faces are counted there, never taken from a count the program reports. In the plane y = 1
// the inner face is the one that touches no corner of the cube and the ring faces are the ones that do; each
// area is its boundary loop's (Newell). A failure about the inner face names it `the inner face (face <id>)`,
// by the row's `faces`.

import { describe, it } from 'vitest';
import { AC, CUBE, DOC, SLOW, admitted, failsNaming, geometryCall, meshRow, none, offsetFaces, runShow, scenario, sceneDoc, show, useDir, useShow, type JsonObject, type Planted } from './helpers.ts';
import { areaProblems, boxCorners, countProblems, countsOf, inPlane, touches } from './reference.ts';

const bin = useShow();
const dir = useDir();

const doc = (): JsonObject => sceneDoc('An inset cube', {
  cube: { kind: 'slab@1', params: CUBE, modifiers: [offsetFaces({ parts: ['top'], by: 0.1 })] },
});
const CORNERS = boxCorners([-0.5, 0, -0.5], [0.5, 1, 0.5]);

function insetProblems(planted?: Planted): string[] {
  const [shown, reply] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, doc()), geometryCall(DOC.a, ['cube'])], planted));
  admitted(shown, 'the inset cube');
  const { view } = meshRow(reply, 'cube', 'the inset cube');
  const got = countsOf(view);
  const out = countProblems('the inset cube', got, { points: 12, edges: 20, faces: 10 });
  const euler = got.points - got.edges + got.faces;
  if (euler !== 2) out.push(`the inset cube: V − E + F = ${euler} on welded positions, not 2`);
  const top = view.faces.filter((f) => inPlane(view, f, 1, 1));
  const inner = top.filter((f) => !touches(view, f, CORNERS));
  const rings = top.filter((f) => touches(view, f, CORNERS));
  if (inner.length !== 1) out.push(`the inset cube: ${inner.length} faces in its top plane touch no corner of the cube, not the one inner face`);
  if (rings.length !== 4) out.push(`the inset cube: ${rings.length} faces in its top plane touch a corner of the cube, not the four ring faces`);
  for (const f of inner) out.push(...areaProblems(view, f, 0.64, 1e-9, `the inset cube: the inner face (face ${f.id})`));
  for (const f of rings) out.push(...areaProblems(view, f, 0.09, 1e-9, `the inset cube: the ring face (face ${f.id})`));
  return out;
}

describe(`${AC[1]} a cube's top inset by 0.1 m`, () => {
  it(`${AC[1]} the cube builds 12 points, 20 edges and 10 faces, V − E + F = 2, an inner face of 0.64 m² and four ring faces of 0.09 m² in its top plane`, () => {
    none(insetProblems(), 'the inset cube');
  }, SLOW);

  it(`${AC[1]} the planted offset_along_bisector (each corner moved by along its bisector) leaves an inner face of 0.737157 m² and fails, naming the face`, () => {
    failsNaming(insetProblems('offset_along_bisector'), [/the inner face \(face \d+\): its area is 0\.737157 m², not 0\.64 m²/], 'the planted offset_along_bisector');
  }, SLOW);
});
