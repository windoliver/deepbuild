// AC2, through the surface the issue names for spans: "The `geometry` call's reply for the line gives each span as
// `{edge, from: m, to: m, hidden: bool}`, measured along the edge from its start, in edge order and then `from`
// order", held to AC2's numbers: "A 1 m cube with crease edges and `hidden` set, in a three-quarter view, gives 12
// spans, each a whole edge: 9 visible and the 3 that meet the far corner hidden"
//
// The fixture is cube.ts's, shown to `deep-show run` as an agent's `deep_show` payload (#393) and read with #420's
// `geometry` call at t = 0 s, as #440's suite reads a mesh-edge line's `segments`. Two documents in one scenario:
// the guard, without the line that has `hidden`, and the cube with it.
//
// Fixture guard, which the base answers: the guard document is admitted and the `geometry` row of `twin` gives the
// cube's 12 edges as `segments`, 1 m each between 8 corners, three meeting the corner farthest from the camera.
// Conditions: the cube document is admitted; the `geometry` row of `edges` gives `spans`, a list of exactly
// `{edge, from, to, hidden}`; and those spans pass cube.test.ts's check unchanged: 12 spans in edge order, one per
// edge, each 0 to 1 m within 1e-5 m, hidden for the three edges that meet the far corner and visible for the other
// nine. The wrong program AC2 names is run against that same check in cube.test.ts; the planted names live on
// `deep-gpu` only (README: Planted programs).

import { describe, it } from 'vitest';
import { DOC, admitted, geometryCall, runShow, scenario, sceneDoc, segmentsOf, show, useDir, useShow } from '../440/helpers.ts';
import { AC, geometrySpans, none, type JsonObject } from './helpers.ts';
import { CAMERA, LINE, TWIN, box, cubeItems, cubeProblems } from './cube.ts';
import { rank } from './reference.ts';

const bin = useShow();
const dir = useDir();

/** #440's scene envelope (an agent's payload: no `id`, no `layers`) under this suite's name. */
const doc = (title: string, items: Record<string, JsonObject>): JsonObject =>
  ({ ...sceneDoc(title, items), description: `${title}: a #1782 acceptance fixture.` });

describe(`${AC[2]} the geometry call's reply for a cube's line with hidden set`, () => {
  it(`${AC[2]} gives each span as {edge, from, to, hidden}: 12 spans, each a whole edge, 9 visible and the 3 that meet the far corner hidden (deep-show)`, () => {
    const items = cubeItems();
    const guard = Object.fromEntries(Object.entries(items).filter(([id]) => id !== LINE));
    const [shownGuard, twin, shownCube, reply] = runShow(bin(), scenario(dir(), [DOC.a, DOC.b], [
      show(DOC.a, doc('A cube and its crease line', guard)), geometryCall(DOC.a, [TWIN]),
      show(DOC.b, doc('A cube with hidden crease edges', items)), geometryCall(DOC.b, [LINE]),
    ]));
    admitted(shownGuard!, 'the guard document');
    const b = box(rank(segmentsOf(twin!, TWIN, 'the guard\'s geometry reply')), CAMERA.position, 'the guard\'s geometry reply');
    admitted(shownCube!, 'the cube document, with hidden set');
    const spans = geometrySpans(reply!, LINE, 'the geometry reply for the line with hidden');
    none(cubeProblems(spans, b), 'the geometry reply for the line with hidden: the cube\'s spans');
  }, 900_000);
});
