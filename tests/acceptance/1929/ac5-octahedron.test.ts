// AC5 #1929.f933a85f: "A `mesh_deform` whose mesh is the octahedron with its 6 points 2 m out along each axis from
// the cube's centre (8 triangles) moves the subdivided cube by (0.3, −0.2, 0.1) m when every move is that, and puts
// each vertex at twice its offset from the centre when each control point's move equals that point's own offset from
// the centre. With only the +y point moved (0, 1, 0) m, the corner on the +x, +y, +z side moves 7/24 = 0.291667 m
// and the corner on the +x, −y, +z side 1/24 = 0.041667 m along y, all within 1e-9 m. A planted deform that blends
// by normalized inverse distance passes the translation, puts the doubled +x, +y, +z corner 0.647193 m from the
// centre on each axis instead of 1 m, and fails, naming the vertex"
//
// One document: `plain`, the subdivided cube alone, and three copies under `mod.mesh_deform@1` with the octahedron
// (points in the order +x, −x, +y, −y, +z, −z, each 2 m from the cube's centre; one triangle per octant, wound
// outward): `moved`, every move (0.3, −0.2, 0.1) m; `doubled`, each point's move its own offset from the centre;
// `lifted`, only the +y point moved (0, 1, 0) m. The judge holds, within 1e-9 m on each axis: every vertex of
// `moved` to a move of (0.3, −0.2, 0.1) m; every vertex of `doubled` to a move of its own offset from the centre (so
// it stands at twice that offset); the corners of `lifted` to the issue's 7/24 m along y on the +y side and 1/24 m
// on the −y side, and its other points to their +y mean value coordinate (reference.ts: meanValueWeights, Ju,
// Schaefer and Warren's closed form), with nothing along x or z. Before it judges anything, the closed form must
// give weights that sum to 1 and reproduce each vertex's own place at all 26 points (the two properties the
// translation and the doubling rest on) and the issue's 7/24 and 1/24 at the corners. The wrong program: scenario
// `planted: mesh_deform_inverse_distance` weighs each point by 1 ÷ its distance, over their sum: the weights still
// sum to 1, so the translation passes, but the doubled +x, +y, +z corner stands 0.647193 m from the centre on each
// axis; the same judge must fail, naming that corner as `doubled vertex <index>`. This suite's own twin of that
// program gives the issue's 0.647193 m and fails the judge the same way first.

import { describe, expect, it } from 'vitest';
import {
  AC, CENTRE, DOC, TIMEOUT, admitted, cube, cubeOf, failsNaming, geometry, kindOf, meshDeform, modelCube, moveProblems, movedBy, none, placeOf, rowOf,
  runShow, scenario, sceneDoc, show, useBin, useDir, vertexAt, withinAbs, zeros, type Cube, type Planted, type Row,
} from './helpers.ts';
import { OCTA, cageProblems, fmtV, inverseDistanceWeights, length, meanValueWeights, octahedron, sub, weightedMove, type V3 } from './reference.ts';

const bin = useBin();
const dir = useDir();

/** The criterion's control mesh: the octahedron 2 m out along each axis from the cube's centre. */
const CAGE = octahedron(CENTRE, 2);
const SHIFT: V3 = [0.3, -0.2, 0.1];
const M = withinAbs(1e-9);
/** The three sets of moves: one move at every point; each point's own offset from the centre; only the +y point's. */
const MOVES = {
  moved: CAGE.points.map((): V3 => [...SHIFT]),
  doubled: CAGE.points.map((p) => sub(p, CENTRE)),
  lifted: zeros(6).map((m, j): V3 => (j === OCTA.py ? [0, 1, 0] : m)),
} as const;
/** The issue's two numbers, and the 0.647193 m of its wrong program. */
const UP = 7 / 24;
const DOWN = 1 / 24;
const WRONG_DOUBLED = 0.647193;

/** How far `lifted` moves a vertex: a corner the issue's 7/24 or 1/24 m along y, any other point its +y mean value coordinate. */
function liftOf(p: V3): V3 {
  const place = placeOf(p);
  return [0, kindOf(place) === 'corner' ? (place[1] === 1 ? UP : DOWN) : meanValueWeights(p, CAGE)[OCTA.py]!, 0];
}
/** The criterion's judge on the translation. */
const translationProblems = (c: Cube, moved: Row): string[] => moveProblems(c, moved, () => SHIFT, M);
/** The criterion's judge: the translation, the doubling and the +y point's move, each vertex within 1e-9 m. */
const octaProblems = (c: Cube, rows: Record<keyof typeof MOVES, Row>): string[] => [
  ...translationProblems(c, rows.moved),
  ...moveProblems(c, rows.doubled, (p) => sub(p, CENTRE), M),
  ...moveProblems(c, rows.lifted, liftOf, M),
];
/** The corner on the +x, +y, +z side. */
const corner = (c: Cube): number => vertexAt(c, [1, 1, 1]);
/** How far the doubled corner stands from the issue's 0.647193 m from the centre, on its worst axis. */
const offWrong = (c: Cube, doubled: Row): number => Math.max(...sub(doubled.positions[corner(c)]!, CENTRE).map((o) => Math.abs(o - WRONG_DOUBLED)));

/** The control mesh is the criterion's, and the closed form gives the issue's numbers and the two properties the judge rests on. */
function closedFormIsTheIssues(c: Cube): void {
  expect([CAGE.points.length, CAGE.triangles.length, ...CAGE.points.map((p) => length(sub(p, CENTRE)))], 'the octahedron: 6 points 2 m from the cube\'s centre, 8 triangles').toEqual([6, 8, 2, 2, 2, 2, 2, 2]);
  none(cageProblems(CAGE), 'the octahedron is closed, manifold and wound outward');
  for (const p of c.points) {
    const w = meanValueWeights(p.at, CAGE);
    const sum = w.reduce((a, b) => a + b, 0);
    const back = weightedMove(w, CAGE.points);
    expect(Math.abs(sum - 1) <= 1e-12 && length(sub(back, p.at)) <= 1e-12, `the closed form's weights at ${fmtV(p.at)} sum to 1 and reproduce the place, got ${sum} and ${fmtV(back)}`).toBe(true);
    if (kindOf(p.place) === 'corner') {
      const want = p.place[1] === 1 ? UP : DOWN;
      expect(Math.abs(w[OCTA.py]! - want) <= 1e-12, `the closed form's +y weight at the corner ${fmtV(p.at)} is the issue's ${want}, got ${w[OCTA.py]}`).toBe(true);
    }
  }
}

/** The document shown and its four meshes read, under the shipped program or a planted one. */
function deformed(planted?: Planted): { cube: Cube; rows: Record<keyof typeof MOVES, Row> } {
  const document = sceneDoc('A cube in an octahedron', {
    plain: cube(), moved: cube([meshDeform(CAGE, MOVES.moved)]), doubled: cube([meshDeform(CAGE, MOVES.doubled)]), lifted: cube([meshDeform(CAGE, MOVES.lifted)]),
  });
  const [shownReply, built] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, document), geometry(DOC.a, ['plain', 'moved', 'doubled', 'lifted'])], planted));
  admitted(shownReply!, 'the cube in the octahedron');
  const row = (id: keyof typeof MOVES): Row => rowOf(built!, id, `the ${id} cube`);
  return { cube: cubeOf(rowOf(built!, 'plain', 'the cube before the deform')), rows: { moved: row('moved'), doubled: row('doubled'), lifted: row('lifted') } };
}

describe(`${AC[5]} a mesh deform by an octahedron`, () => {
  it(`${AC[5]} every move (0.3, −0.2, 0.1) m moves the cube by that; each point moved by its own offset puts each vertex at twice its offset; only the +y point moved (0, 1, 0) m moves the +x, +y, +z corner 7/24 m and the +x, −y, +z corner 1/24 m along y, all within 1e-9 m`, () => {
    const { cube: c, rows } = deformed();
    closedFormIsTheIssues(c);
    none(octaProblems(c, rows), 'the cube in the octahedron: the translation, the doubling and the +y point\'s move');
  }, TIMEOUT);

  it(`${AC[5]} planted mesh_deform_inverse_distance blends by normalized inverse distance: it passes the translation, puts the doubled +x, +y, +z corner 0.647193 m from the centre on each axis instead of 1 m, and the judge fails, naming the vertex`, () => {
    // This suite's own twin of the wrong program, on the 26 points: it passes the translation, gives the issue's 0.647193 m and fails the judge.
    const model = modelCube();
    closedFormIsTheIssues(model);
    const twin = (id: keyof typeof MOVES): Row => movedBy(model, id, (p) => weightedMove(inverseDistanceWeights(p, CAGE), MOVES[id]));
    const twins = { moved: twin('moved'), doubled: twin('doubled'), lifted: twin('lifted') };
    none(translationProblems(model, twins.moved), 'the suite\'s own twin passes the translation');
    expect(offWrong(model, twins.doubled), 'the suite\'s own twin puts the doubled +x, +y, +z corner 0.647193 m from the centre on each axis').toBeLessThanOrEqual(5e-7);
    failsNaming(octaProblems(model, twins), [`doubled vertex ${corner(model)} at `], 'the suite\'s own twin, weights by inverse distance');

    // The program's planted deform.
    const { cube: c, rows } = deformed('mesh_deform_inverse_distance');
    none(translationProblems(c, rows.moved), 'planted mesh_deform_inverse_distance passes the translation');
    expect(offWrong(c, rows.doubled), 'planted mesh_deform_inverse_distance puts the doubled +x, +y, +z corner 0.647193 m from the centre on each axis').toBeLessThanOrEqual(5e-7);
    failsNaming(octaProblems(c, rows), [`doubled vertex ${corner(c)} at `], 'planted mesh_deform_inverse_distance');
  }, TIMEOUT);
});
