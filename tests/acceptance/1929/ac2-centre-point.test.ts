// AC2 #1929.c629697d: "With `points: [3, 3, 3]` over the same box and only the centre point moved (0, 1, 0) m, each
// of the cube's 8 corners moves 0.375³ = 0.052734 m, each face centre 0.5 × 0.375 × 0.5 = 0.09375 m and each edge
// midpoint 0.375² × 0.5 = 0.0703125 m along y, within 1e-12 m, with x and z unchanged. A planted deform that
// interpolates trilinearly cell by cell moves the corners 0.125 m and the face centres 0.5 m and fails, naming the
// vertex"
//
// One document: `plain`, the subdivided cube alone, and `crate`, the same cube with `mod.box_deform@1` over the 2 m
// box centred on it, 3 × 3 × 3 points, 27 moves of which only the centre point's (i = j = k = 1, index 13 with x
// fastest) is (0, 1, 0) m. The cube's points sit at 0.25, 0.5 or 0.75 along each axis of the box, where the middle
// degree-2 Bernstein polynomial 2s(1 − s) is 0.375, 0.5 and 0.375. The judge holds every vertex, by what it is, to
// the issue's number along y (a corner 0.375³, a face centre 0.375 × 0.5², an edge midpoint 0.375² × 0.5) and to 0
// along x and z, within 1e-12 m; the closed form (reference.ts: boxMove) must give those same numbers at all 26
// points first. The wrong program: scenario `planted: box_deform_trilinear_cells` blends each cell's eight points
// trilinearly, so the centre point weighs 0.5 at a point half a cell away: the corners move 0.5³ = 0.125 m and the
// face centres 0.5 m; the same judge must fail, naming each corner and face centre as `crate vertex <index>`. This
// suite's own twin of that program gives the issue's 0.125 and 0.5 m and fails the judge the same way first.

import { describe, expect, it } from 'vitest';
import {
  AC, BOX_2M, DOC, TIMEOUT, admitted, boxDeform, cube, cubeOf, failsNaming, geometry, kindOf, modelCube, moveProblems, movedBy, movesOf, none, placeOf,
  rowOf, runShow, scenario, sceneDoc, show, useBin, useDir, verticesWhere, withinAbs, zeros, type Cube, type Planted, type Row,
} from './helpers.ts';
import { boxMove, boxMoveTrilinear, fmtV, gridIndex, same, type Box, type V3 } from './reference.ts';

const bin = useBin();
const dir = useDir();

/** The criterion's grid: 3 × 3 × 3 points over the 2 m box, only the centre point moved (0, 1, 0) m. */
const GRID: Box = { ...BOX_2M, points: [3, 3, 3], moves: zeros(27).map((m, n): V3 => (n === gridIndex([3, 3, 3], 1, 1, 1) ? [0, 1, 0] : m)) };
const M = withinAbs(1e-12);
/** The issue's moves along y, by what a point is. */
const LIFT = { 'corner': 0.375 * 0.375 * 0.375, 'face centre': 0.5 * 0.375 * 0.5, 'edge midpoint': 0.375 * 0.375 * 0.5 } as const;
/** The wrong program's moves along y that the issue states. */
const TRILINEAR = { 'corner': 0.125, 'face centre': 0.5 } as const;
const lift = (p: V3): V3 => [0, LIFT[kindOf(placeOf(p))], 0];

/** The criterion's judge: every vertex moved its kind's distance along y and nothing along x or z, within 1e-12 m. */
const liftProblems = (c: Cube, crate: Row): string[] => moveProblems(c, crate, lift, M);
/** The corners and face centres that did not move the wrong program's 0.125 m and 0.5 m along y. */
const notTrilinear = (c: Cube, crate: Row): string[] => movesOf(c, crate).flatMap((m, i) => {
  const kind = kindOf(placeOf(c.input[i]!));
  return kind !== 'edge midpoint' && !(M.ok(m[1], TRILINEAR[kind]) && M.ok(m[0], 0) && M.ok(m[2], 0)) ? [`crate vertex ${c.low[i]} (a ${kind}) moved ${fmtV(m)} m, want ${TRILINEAR[kind]} m along y`] : [];
});
/** The names of the corners and the face centres. */
const cornersAndCentres = (c: Cube): number[] => verticesWhere(c, (place) => kindOf(place) !== 'edge midpoint');

/** The issue's three numbers are their products, and the closed form gives them at every one of the 26 points. */
function closedFormIsTheIssues(c: Cube): void {
  expect([LIFT.corner, LIFT['face centre'], LIFT['edge midpoint']], 'the issue\'s 0.052734 (0.375³), 0.09375 and 0.0703125 m').toEqual([0.052734375, 0.09375, 0.0703125]);
  for (const p of c.points) expect(same(boxMove(GRID, p.at), lift(p.at)), `the closed form at ${fmtV(p.at)} (a ${kindOf(p.place)}) is the issue's ${fmtV(lift(p.at))} m, got ${fmtV(boxMove(GRID, p.at))}`).toBe(true);
}

/** The document shown and both meshes read, under the shipped program or a planted one. */
function lifted(planted?: Planted): { cube: Cube; crate: Row } {
  const document = sceneDoc('A cube under a grid with its centre point moved', { plain: cube(), crate: cube([boxDeform(GRID)]) });
  const [shownReply, built] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, document), geometry(DOC.a, ['plain', 'crate'])], planted));
  admitted(shownReply!, 'the cube under the 3 × 3 × 3 grid');
  return { cube: cubeOf(rowOf(built!, 'plain', 'the cube before the deform')), crate: rowOf(built!, 'crate', 'the lifted cube') };
}

describe(`${AC[2]} a 3 × 3 × 3 grid with only its centre point moved`, () => {
  it(`${AC[2]} each corner moves 0.375³ m, each face centre 0.5 × 0.375 × 0.5 m and each edge midpoint 0.375² × 0.5 m along y, within 1e-12 m, with x and z unchanged`, () => {
    const { cube: c, crate } = lifted();
    closedFormIsTheIssues(c);
    none(liftProblems(c, crate), 'the cube under the centre point\'s move, against the issue\'s three numbers');
  }, TIMEOUT);

  it(`${AC[2]} planted box_deform_trilinear_cells interpolates trilinearly cell by cell: the corners move 0.125 m and the face centres 0.5 m, and the judge fails, naming the vertex`, () => {
    // This suite's own twin of the wrong program, on the 26 points: it gives the issue's 0.125 and 0.5 m and fails the judge.
    const model = modelCube();
    const twin = movedBy(model, 'crate', (p) => boxMoveTrilinear(GRID, p));
    closedFormIsTheIssues(model);
    none(notTrilinear(model, twin), 'the suite\'s own twin moves the corners 0.125 m and the face centres 0.5 m');
    failsNaming(liftProblems(model, twin), cornersAndCentres(model).map((v) => `crate vertex ${v} at `), 'the suite\'s own twin, trilinear cells');

    // The program's planted deform.
    const { cube: c, crate } = lifted('box_deform_trilinear_cells');
    expect(cornersAndCentres(c).length, 'the cube has 8 corners and 6 face centres').toBe(14);
    none(notTrilinear(c, crate), 'planted box_deform_trilinear_cells moves the corners 0.125 m and the face centres 0.5 m along y');
    failsNaming(liftProblems(c, crate), cornersAndCentres(c).map((v) => `crate vertex ${v} at `), 'planted box_deform_trilinear_cells');
  }, TIMEOUT);
});
