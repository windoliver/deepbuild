// AC4 #1929.2bce5ff8: "A cube vertex 0.01 m outside the box is refused at check with `box_deform.outside`, naming
// the item and the vertex, and `points: [5, 2, 2]`, or 7 moves for 8 points, with `box_deform.params`, each with 0
// builds. A planted check that clamps outside vertices into the box builds and fails"
//
// The cube's points are read first from a document of its own (`plain`), so a vertex an issue names can be placed.
// Then, each in a document of its own, the cube `crate` under `mod.box_deform@1`:
//   - over the 2 m box with its +x side pulled in to 0.49 m from the cube's centre, 2 × 2 × 2 points, every move 0:
//     the nine points of the cube's +x face lie 0.01 m outside and the other 17 inside (an axis-aligned box cannot
//     leave out one point of an axis-aligned cube alone). The revision is refused with an error issue
//     `box_deform.outside` that names the item and exactly those nine vertices, each once (README: Naming a vertex).
//   - the same with the +x side at 0.51 m, the cube 0.01 m inside: the clean twin, presented with no error and built.
//   - over the 2 m box with `points: [5, 2, 2]` and its 20 moves; and with `points: [2, 2, 2]` and 7 moves: each
//     refused with an error issue `box_deform.params` that names the item.
// "0 builds" is read from #420's `geometry` call made for the item after each refusal: it answers the base's
// `no_revision` (a document with no admitted revision has nothing to build) or `builds: 0` with no mesh. The wrong
// program: scenario `planted: box_deform_clamps_outside`, a check that clamps outside vertices into the box instead
// of refusing them: the revision is presented and `geometry` counts a build and answers a mesh, so the same judge
// must fail, naming the missing `box_deform.outside` and the build.

import { describe, expect, it } from 'vitest';
import {
  AC, BOX_2M, CENTRE, DOC, TIMEOUT, admitted, boxDeform, builtVertices, cube, cubeOf, failsNaming, geometry, none, num, outcome, refusalProblems, rowOf, runShow,
  scenario, sceneDoc, show, useBin, useDir, verticesWhere, zeros, type Cube, type JsonObject, type Planted,
} from './helpers.ts';
import { fmtV, type Box, type V3 } from './reference.ts';

const bin = useBin();
const dir = useDir();

/** The 2 m box with its +x side `x` m from the cube's centre, 2 × 2 × 2 points, every move 0. */
const sideAt = (x: number): Box => ({ from: BOX_2M.from, to: [CENTRE[0] + x, BOX_2M.to[1], BOX_2M.to[2]], points: [2, 2, 2], moves: zeros(8) });
/** The criterion's box: the cube's +x face is 0.01 m outside it. */
const SHORT = sideAt(0.49);
const crateDoc = (title: string, box: Box): JsonObject => sceneDoc(title, { crate: cube([boxDeform(box)]) });
const plainDoc = (): JsonObject => sceneDoc('The cube before any deform', { plain: cube() });
const inside = (box: Box, p: V3): boolean => [0, 1, 2].every((k) => p[k]! >= box.from[k]! && p[k]! <= box.to[k]!);

/** The cube read, the short box's revision shown and `geometry` asked for its item, under the shipped program or a planted one. */
function outside(planted?: Planted, more: JsonObject[] = []): { cube: Cube; face: number[]; replies: JsonObject[] } {
  const replies = runShow(bin(), scenario(dir(), more.length ? [DOC.a, DOC.b, DOC.c] : [DOC.a, DOC.b], [
    show(DOC.a, plainDoc()), geometry(DOC.a, ['plain']),
    show(DOC.b, crateDoc('A cube 0.01 m outside its box', SHORT)), geometry(DOC.b, ['crate']),
    ...more,
  ], planted));
  admitted(replies[0]!, 'the cube before any deform');
  const c = cubeOf(rowOf(replies[1]!, 'plain', 'the cube before any deform'));
  // The fixture: the +x face's nine points are 0.01 m outside the box along x, and the other 17 inside it.
  const face = verticesWhere(c, (place) => place[0] === 1);
  expect(face.length, 'the cube\'s +x face has nine points').toBe(9);
  for (const p of c.points) {
    const out = p.at[0] - SHORT.to[0];
    if (p.place[0] === 1) expect(Math.abs(out - 0.01) <= 1e-12, `the fixture's vertex ${p.vertex} at ${fmtV(p.at)} is 0.01 m outside the box, got ${out}`).toBe(true);
    else expect(inside(SHORT, p.at), `the fixture's vertex ${p.vertex} at ${fmtV(p.at)} is inside the box`).toBe(true);
  }
  return { cube: c, face, replies };
}

describe(`${AC[4]} outside vertices and bad params are refused at check`, () => {
  it(`${AC[4]} cube vertices 0.01 m outside the box are refused at check with box_deform.outside, naming the item and each vertex, with 0 builds; 0.01 m inside, the cube is presented`, () => {
    const { cube: c, face, replies } = outside(undefined, [show(DOC.c, crateDoc('A cube 0.01 m inside its box', sideAt(0.51))), geometry(DOC.c, ['crate'])]);
    none(refusalProblems(replies[2]!, replies[3]!, { id: 'crate', code: 'box_deform.outside', vertices: face }, c), 'the cube 0.01 m outside its box');
    // The clean twin, one step inside the rule: nothing is refused.
    admitted(replies[4]!, 'the cube 0.01 m inside its box');
    expect(rowOf(replies[5]!, 'crate', 'the cube 0.01 m inside its box').positions.length, 'the cube inside its box builds every vertex').toBe(c.input.length);
  }, TIMEOUT);

  it(`${AC[4]} points: [5, 2, 2], and 7 moves for 8 points, are each refused at check with box_deform.params, with 0 builds`, () => {
    const fivePoints: Box = { ...BOX_2M, points: [5, 2, 2], moves: zeros(20) };
    const sevenMoves: Box = { ...BOX_2M, points: [2, 2, 2], moves: zeros(7) };
    const replies = runShow(bin(), scenario(dir(), [DOC.b, DOC.c], [
      show(DOC.b, crateDoc('A grid of 5 points along x', fivePoints)), geometry(DOC.b, ['crate']),
      show(DOC.c, crateDoc('7 moves for 8 points', sevenMoves)), geometry(DOC.c, ['crate']),
    ]));
    none(refusalProblems(replies[0]!, replies[1]!, { id: 'crate', code: 'box_deform.params' }), 'points: [5, 2, 2] with its 20 moves');
    none(refusalProblems(replies[2]!, replies[3]!, { id: 'crate', code: 'box_deform.params' }), '7 moves for the 8 points of a 2 × 2 × 2 grid');
  }, TIMEOUT);

  it(`${AC[4]} planted box_deform_clamps_outside, a check that clamps outside vertices into the box, builds and fails`, () => {
    const { cube: c, face, replies } = outside('box_deform_clamps_outside');
    expect(outcome(replies[2]!), 'planted box_deform_clamps_outside presents the revision').toBe('presented');
    expect(num(replies[3]!['builds'], 'planted box_deform_clamps_outside: geometry\'s builds'), 'planted box_deform_clamps_outside builds the item').toBeGreaterThanOrEqual(1);
    expect(builtVertices(replies[3]!, 'crate'), 'planted box_deform_clamps_outside builds every vertex').toBe(c.input.length);
    failsNaming(refusalProblems(replies[2]!, replies[3]!, { id: 'crate', code: 'box_deform.outside', vertices: face }, c),
      ['crate: no error issue box_deform.outside', 'want 0 builds'], 'planted box_deform_clamps_outside');
  }, TIMEOUT);
});
