// AC8, its first sentence: "Moving the camera or adding an unrelated item changes no edge's ID, and a planted ID
// taken from the order spans draw in changes with the camera and fails, naming the edge"
//
// The fixture is cube.ts's cube, drawn three times on the noop lane with `counts: true`: from #1640's AC4 camera (up,
// right and in front), from the same camera moved to the cube's left, and from the first camera again with an
// unrelated item added, a small box behind the cube that hides none of it. An edge's ID is its rank among the 12
// edges ordered by welded ends (README: An edge's ID and start), which no camera and no other item can change; no
// report carries an edge's ends, so an ID is checked through what it must say: from each camera the three edges
// that meet the corner farthest from it are hidden, and those are different ranks from the two cameras.
//
// Fixture guards, which the base answers, from each document without the `hidden` line: the twin line draws the
// cube's 12 edges, and three meet the far corner; the two cameras' far corners differ. Conditions: in each of the
// three frames `spans` are 12 whole-edge spans in edge order, hidden exactly at the ranks of the edges that meet
// that camera's far corner. Under `--planted edges_id_from_draw_order` (edges numbered in the order the frame draws
// spans: visible ones first, then hidden ones) the check fails, naming the first hidden edge of each camera.

import { describe, expect, it } from 'vitest';
import type { V3 } from '../1640/reference.ts';
import { AC, NOOP, drawHidden, failsNaming, none, spansOf, useDir, useGpuBin, type JsonObject, type Span, type Startup } from './helpers.ts';
import { CAMERA, LINE, TWIN, box, cubeItems, cubeProblems, firstHidden, nameOf, type Box } from './cube.ts';

const bin = useGpuBin();
const dir = useDir();

/** The camera moved to the cube's left: the far corner is another one. */
const MOVED: V3 = [-2.4, 1.9, 3.2];
/** An unrelated item: a 0.5 m box behind the cube from the first camera, in front of none of it. */
const UNRELATED: JsonObject = { kind: 'slab@1', params: { size: [0.5, 0.5, 0.5] }, at: { pos: [-3, 0, -3] } };

interface View { name: string; read: () => Span[]; b: Box }
/** One frame drawn and held to its guard. Its spans are read on demand, after every frame's guard has run. */
function view(name: string, eye: V3, more: Record<string, JsonObject>, startup: Startup): View {
  const { edges, frames, what } = drawHidden(bin(), dir(), { title: `Cube ${name}`, items: { ...cubeItems(eye), ...more } }, LINE, TWIN, startup);
  return { name, read: () => spansOf(frames[0]!, LINE, what), b: box(edges, eye, `${what}, its guard`) };
}
/** The three frames, their guards held, and AC8's check on them: each failure names the view and the edge. */
function ids(startup: Startup): { views: View[]; problems: string[] } {
  const views = [
    view('from the front right', CAMERA.position, {}, startup),
    view('from the front left', MOVED, {}, startup),
    view('from the front right with an unrelated item', CAMERA.position, { other: UNRELATED }, startup),
  ];
  const [right, left] = views;
  expect(firstHidden(left!.b).id, 'the guard: the two cameras\' far corners differ, so their first hidden edges do').not.toBe(firstHidden(right!.b).id);
  return { views, problems: views.flatMap((v) => cubeProblems(v.read(), v.b).map((p) => `${v.name}: ${p}`)) };
}

describe(`${AC[8]} an edge's ID under a moved camera and an added item`, () => {
  it(`${AC[8]} moving the camera or adding an unrelated item changes no edge's ID (noop lane)`, () => {
    none(ids(NOOP).problems, 'the cube\'s edge IDs from two cameras and with an unrelated item');
  }, 600_000);

  it(`${AC[8]} a planted ID taken from the order spans draw in changes with the camera and fails, naming the edge (noop lane)`, () => {
    const { views, problems } = ids({ backend: 'noop', planted: 'edges_id_from_draw_order' });
    const [right, left] = views;
    failsNaming(problems, [`${right!.name}: ${nameOf(right!.b, firstHidden(right!.b))}`, `${left!.name}: ${nameOf(left!.b, firstHidden(left!.b))}`], 'the ID taken from the order spans draw in');
  }, 600_000);
});
