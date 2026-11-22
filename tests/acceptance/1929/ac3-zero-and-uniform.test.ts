// AC3 #1929.9ba17166: "With every move 0 the positions equal the input bit for bit, and with every move
// (0.3, −0.2, 0.1) m every point moves by that within 1e-12 m, on grids of 2 × 2 × 2, 3 × 3 × 3 and 4 × 3 × 2
// points. A planted deform that leaves out the last point's weight moves the points by less and fails, naming the
// vertex"
//
// One document: `plain`, the subdivided cube alone (the input), and six copies of it under `mod.box_deform@1` over
// the 2 m box centred on the cube: `still222`, `still333` and `still432` with every move (0, 0, 0), and `shift222`,
// `shift333` and `shift432` with every move (0.3, −0.2, 0.1) m, on grids of 8, 27 and 24 points. The judge holds each
// `still` cube's positions to `plain`'s bit for bit (each coordinate the same f64, −0 apart from 0) and each `shift`
// cube's every vertex to a move of (0.3, −0.2, 0.1) m within 1e-12 m on each axis: the Bernstein polynomials sum to
// 1 on every axis, so the same move at every point moves every vertex by it. The wrong program: scenario `planted:
// box_deform_drops_last_weight` sums every point but the grid's last (the one at the box's +x, +y, +z corner), whose
// weight is above 0 at every point of the cube, so every vertex moves by less on each axis; the same judge must
// fail on each grid, naming every one of the 26 points as `<item> vertex <index>`. This suite's own twin of that
// program moves the points by less and fails the judge the same way first.

import { describe, it } from 'vitest';
import {
  AC, BOX_2M, DOC, TIMEOUT, admitted, boxDeform, cube, cubeOf, failsNaming, geometry, modelCube, moveProblems, movedBy, movesOf, none, rowOf, runShow,
  scenario, sceneDoc, show, useBin, useDir, withinAbs, zeros, type Cube, type JsonObject, type Planted, type Row,
} from './helpers.ts';
import { boxMove, boxMoveDropsLast, fmtV, type Box, type V3 } from './reference.ts';

const bin = useBin();
const dir = useDir();

/** The criterion's uniform move. */
const SHIFT: V3 = [0.3, -0.2, 0.1];
const M = withinAbs(1e-12);
/** The criterion's three grids, by the suffix of their items' IDs. */
const GRIDS: Record<string, [number, number, number]> = { 222: [2, 2, 2], 333: [3, 3, 3], 432: [4, 3, 2] };
const grid = (points: [number, number, number], move: V3): Box => ({ ...BOX_2M, points, moves: zeros(points[0] * points[1] * points[2]).map((): V3 => [...move]) });

/** Where `row`'s positions are not its input's, bit for bit: a failure names its vertex. */
function bitProblems(c: Cube, row: Row): string[] {
  if (row.positions.length !== c.input.length) return [`${row.id}: ${row.positions.length} vertices, its input ${c.input.length}`];
  return row.positions.flatMap((p, i) => ([0, 1, 2].every((k) => Object.is(p[k], c.input[i]![k])) ? [] : [`${row.id} vertex ${c.low[i]} at ${fmtV(c.input[i]!)}: ${fmtV(p)} is not its input bit for bit`]));
}
/** The criterion's judge on one grid: nothing moves under zero moves, bit for bit; everything moves by the uniform move, within 1e-12 m. */
const gridProblems = (c: Cube, still: Row, shift: Row): string[] => [...bitProblems(c, still), ...moveProblems(c, shift, () => SHIFT, M)];
/** The vertices that did not move by less than the uniform move on every axis: what the wrong program gives. */
const notLess = (c: Cube, shift: Row): string[] => movesOf(c, shift).flatMap((m, i) =>
  ([0, 1, 2].every((k) => Math.abs(m[k]!) < Math.abs(SHIFT[k]!) - 1e-12 && Math.sign(m[k]!) === Math.sign(SHIFT[k]!)) ? [] : [`${shift.id} vertex ${c.low[i]} moved ${fmtV(m)} m, which is not less than ${fmtV(SHIFT)} m on every axis`]));
const everyVertex = (c: Cube, id: string): string[] => c.points.map((p) => `${id} vertex ${p.vertex} at `);

/** The document shown and its seven meshes read, under the shipped program or a planted one. */
function grids(planted?: Planted): { cube: Cube; still: Record<string, Row>; shift: Record<string, Row> } {
  const items: Record<string, JsonObject> = { plain: cube() };
  for (const [name, points] of Object.entries(GRIDS)) {
    items[`still${name}`] = cube([boxDeform(grid(points, [0, 0, 0]))]);
    items[`shift${name}`] = cube([boxDeform(grid(points, SHIFT))]);
  }
  const document = sceneDoc('A cube under three grids, still and shifted', items);
  const [shownReply, built] = runShow(bin(), scenario(dir(), [DOC.a], [show(DOC.a, document), geometry(DOC.a, Object.keys(items))], planted));
  admitted(shownReply!, 'the cube under the three grids');
  const rows = (prefix: string): Record<string, Row> => Object.fromEntries(Object.keys(GRIDS).map((name) => [name, rowOf(built!, `${prefix}${name}`, `the ${prefix} cube on the ${GRIDS[name]!.join(' × ')} grid`)]));
  return { cube: cubeOf(rowOf(built!, 'plain', 'the cube before the deform')), still: rows('still'), shift: rows('shift') };
}

describe(`${AC[3]} zero moves and one move at every point, on three grids`, () => {
  it(`${AC[3]} on grids of 2 × 2 × 2, 3 × 3 × 3 and 4 × 3 × 2 points, every move 0 leaves the positions equal to the input bit for bit, and every move (0.3, −0.2, 0.1) m moves every point by that within 1e-12 m`, () => {
    const { cube: c, still, shift } = grids();
    for (const [name, points] of Object.entries(GRIDS)) {
      // The closed form gives the uniform move at every point, before the program is judged.
      none(moveProblems(c, movedBy(c, 'the closed form', (p) => boxMove(grid(points, SHIFT), p)), () => SHIFT, M), `the closed form on the ${points.join(' × ')} grid`);
      none(gridProblems(c, still[name]!, shift[name]!), `the ${points.join(' × ')} grid: zero moves bit for bit, and the uniform move within 1e-12 m`);
    }
  }, TIMEOUT);

  it(`${AC[3]} planted box_deform_drops_last_weight leaves out the last point's weight: the points move by less and the judge fails, naming the vertex`, () => {
    // This suite's own twin of the wrong program, on the 26 points: every point moves by less and the judge fails.
    const model = modelCube();
    for (const [name, points] of Object.entries(GRIDS)) {
      const twin = movedBy(model, `shift${name}`, (p) => boxMoveDropsLast(grid(points, SHIFT), p));
      none(notLess(model, twin), `the suite's own twin on the ${points.join(' × ')} grid moves every point by less`);
      failsNaming(gridProblems(model, movedBy(model, `still${name}`, (p) => boxMoveDropsLast(grid(points, [0, 0, 0]), p)), twin), everyVertex(model, `shift${name}`), `the suite's own twin on the ${points.join(' × ')} grid`);
    }

    // The program's planted deform.
    const { cube: c, still, shift } = grids('box_deform_drops_last_weight');
    for (const [name, points] of Object.entries(GRIDS)) {
      none(notLess(c, shift[name]!), `planted box_deform_drops_last_weight on the ${points.join(' × ')} grid moves every point by less than (0.3, −0.2, 0.1) m`);
      failsNaming(gridProblems(c, still[name]!, shift[name]!), everyVertex(c, `shift${name}`), `planted box_deform_drops_last_weight on the ${points.join(' × ')} grid`);
    }
  }, TIMEOUT);
});
