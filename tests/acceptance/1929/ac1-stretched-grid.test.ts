// AC1 #1929.eabb0101: "A 1 m slab cube under `subdivide {scheme: simple}` at level 1 (26 points), then a
// `box_deform` with `points: [2, 2, 2]` over a 2 m box centred on it whose four points on the box's +x side move
// (1, 0, 0) m, moves its +x face 0.75 m and its −x face 0.25 m along x and nothing along y or z, and holds 1.5 m³,
// within 1e-12 relative. A planted deform that measures (s, t, u) over the item's own bounds instead of the box
// moves the +x face 1 m and fails, naming the vertex"
//
// One document: `plain`, the subdivided cube alone (the stack's mesh before the deform), and `crate`, the same cube
// with `mod.box_deform@1` over the box from the cube's centre − 1 m to its centre + 1 m on each axis, the four grid
// points with i = 1 (x fastest: indices 1, 3, 5, 7) moved (1, 0, 0) m and the other four (0, 0, 0). `geometry`
// answers both meshes in the item's own space. With degree-1 Bernstein polynomials a vertex at s in the box moves
// s × 1 m along x: the cube's +x face sits at s = 0.75 and its −x face at s = 0.25, so they move 0.75 m and 0.25 m
// and the cube becomes 1.5 m × 1 m × 1 m. The judge holds every vertex to the closed form (reference.ts: boxMove;
// 0.75, 0.5 and 0.25 m along x on the three planes of points, 0 along y and z), each within 1e-12 relative (a
// component expected at 0 within 1e-12 m), and the mesh's volume, by the divergence theorem over its own triangles,
// to 1.5 m³ within 1e-12 relative. The wrong program: scenario `planted: box_deform_own_bounds` (README: The planted
// programs) puts the cube's own faces at s = 0 and s = 1, so the +x face moves 1 m; the same judge must fail, naming
// each of the +x face's nine points as `crate vertex <index>`. This suite's own twin of that program, computed on the
// 26 points, gives the issue's 1 m and fails the judge the same way, before the program's is asked.

import { describe, expect, it } from 'vitest';
import {
  AC, BOX_2M, CENTRE, DOC, TIMEOUT, admitted, boxDeform, cube, cubeOf, failsNaming, geometry, modelCube, moveProblems, movedBy, movesOf, none, rowOf,
  runShow, scenario, sceneDoc, show, useBin, useDir, verticesWhere, withinRel, type Cube, type Planted, type Row,
} from './helpers.ts';
import { add, boxMove, boxMoveOwnBounds, fmt, fmtV, gridMoves, same, signedVolume, sub, type Box, type V3 } from './reference.ts';

const bin = useBin();
const dir = useDir();

/** The criterion's grid: 2 × 2 × 2 points over the 2 m box, the four on its +x side moved (1, 0, 0) m. */
const GRID: Box = { ...BOX_2M, points: [2, 2, 2], moves: gridMoves([2, 2, 2], (i): V3 => (i === 1 ? [1, 0, 0] : [0, 0, 0])) };
const REL = withinRel(1e-12);
/** The cube's own bounds: 0.5 m each way from its centre. */
const OWN: [V3, V3] = [sub(CENTRE, [0.5, 0.5, 0.5]), add(CENTRE, [0.5, 0.5, 0.5])];
/** The names of the +x face's points. */
const face = (c: Cube): number[] => verticesWhere(c, (place) => place[0] === 1);

/** The criterion's judge on the vertices: each moved as the box deform's closed form says, within 1e-12 relative. */
const vertexProblems = (c: Cube, crate: Row): string[] => moveProblems(c, crate, (p) => boxMove(GRID, p), REL);
/** The criterion's judge: the vertices, and the 1.5 m³ the stretched cube holds. */
function stretchProblems(c: Cube, crate: Row): string[] {
  const out = vertexProblems(c, crate);
  const volume = signedVolume(crate.positions, crate.indices);
  if (!REL.ok(volume, 1.5)) out.push(`crate: holds ${fmt(volume)} m³, want 1.5 m³ within 1e-12 relative`);
  return out;
}
/** The +x face's vertices that did not move 1 m along x and nothing along y or z: what the wrong program gives. */
const notOneMetre = (c: Cube, crate: Row): string[] => movesOf(c, crate).flatMap((m, i) =>
  (c.input[i]![0] === OWN[1][0] && !(REL.ok(m[0], 1) && REL.ok(m[1], 0) && REL.ok(m[2], 0)) ? [`crate vertex ${c.low[i]} moved ${fmtV(m)} m`] : []));

/** The closed form gives the issue's numbers on the cube's two x faces, before it judges anything. */
function closedFormIsTheIssues(c: Cube): void {
  for (const p of c.points.filter((q) => q.place[0] !== 0)) {
    const want: V3 = [p.place[0] === 1 ? 0.75 : 0.25, 0, 0];
    expect(same(boxMove(GRID, p.at), want), `the closed form at ${fmtV(p.at)} is the issue's ${fmtV(want)} m, got ${fmtV(boxMove(GRID, p.at))}`).toBe(true);
  }
}

/** The document shown and both meshes read, under the shipped program or a planted one. */
function stretched(planted?: Planted): { cube: Cube; crate: Row } {
  const document = sceneDoc('A cube under a stretched grid', { plain: cube(), crate: cube([boxDeform(GRID)]) });
  const [shownReply, built] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, document), geometry(DOC.a, ['plain', 'crate'])], planted));
  admitted(shownReply!, 'the cube under the stretched grid');
  return { cube: cubeOf(rowOf(built!, 'plain', 'the cube before the deform')), crate: rowOf(built!, 'crate', 'the stretched cube') };
}

describe(`${AC[1]} a 2 × 2 × 2 grid stretched along x`, () => {
  it(`${AC[1]} the cube's +x face moves 0.75 m and its −x face 0.25 m along x, nothing moves along y or z, and the cube holds 1.5 m³, within 1e-12 relative`, () => {
    const { cube: c, crate } = stretched();
    closedFormIsTheIssues(c);
    none(stretchProblems(c, crate), 'the stretched cube against the grid\'s closed form and 1.5 m³');
  }, TIMEOUT);

  it(`${AC[1]} planted box_deform_own_bounds measures (s, t, u) over the item's own bounds: the +x face moves 1 m and the judge fails, naming the vertex`, () => {
    // This suite's own twin of the wrong program, on the 26 points: it gives the issue's 1 m and fails the judge.
    const model = modelCube();
    const twin = movedBy(model, 'crate', (p) => boxMoveOwnBounds(GRID, p, OWN));
    closedFormIsTheIssues(model);
    none(notOneMetre(model, twin), 'the suite\'s own twin moves the +x face 1 m along x');
    failsNaming(vertexProblems(model, twin), face(model).map((v) => `crate vertex ${v} at `), 'the suite\'s own twin, (s, t, u) over the cube\'s bounds');

    // The program's planted deform.
    const { cube: c, crate } = stretched('box_deform_own_bounds');
    expect(face(c).length, 'the +x face has nine points').toBe(9);
    none(notOneMetre(c, crate), 'planted box_deform_own_bounds moves every vertex of the +x face 1 m along x');
    failsNaming(stretchProblems(c, crate), face(c).map((v) => `crate vertex ${v} at `), 'planted box_deform_own_bounds');
  }, TIMEOUT);
});
