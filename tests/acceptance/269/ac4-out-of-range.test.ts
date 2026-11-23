// AC4 #269.21d6944d: A value past `roles` draws nothing in its cell and raises `grid.out_of_range`, naming the array,
// the cell, the value and the step
//
// The grid fixture (fixtures.ts `gridDoc`, nearest beside smooth, four roles) sets cell (8, 6), inside a block of role 0,
// to 7 from step 30 (programs.ts BAD). `deep-show run`'s `eval`: at step 29 no `grid.out_of_range`; at step 30 one naming
// `teams.ground`, cell [8, 6], 7 and step 30 (in the issue's own fields, at the top level or under `actual`, as the
// cell grid's logic grid raises it). Its frame at step 30: drawn nearest, every pixel of cell (8, 6) is the ground (what
// lies under the mark); drawn smooth, the 4 × 4 pixels at the cell's centre are, where `none` alone would win. Its
// neighbours still draw role 0 (cells (7, 6) and (9, 6) nearest; cells (6, 6) and (10, 6), two cells off, smooth), so a
// frame that draws nothing can't pass.
import { describe, it } from 'vitest';
import { BAD, teamsProgram } from './programs.ts';
import { CELL, GRID_KEY_TOP, gridDoc, keyCenter, originOf } from './fixtures.ts';
import {
  AC, DOC, TIMEOUT, apart, at, binOf, evalCall, field, issuesOf, keyOf, names, none, pngOf, prebuild, presented, putEvidence, rgbAt,
  runShow, scenario, show, showCall, snapshotOf, useTemp,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const D = { grid: DOC(4) };

describe(`${AC[4]} a value past roles`, () => {
  it(`${AC[4]} draws nothing in its cell and raises grid.out_of_range naming the array, the cell, the value and the step`, () => {
    const ev = temp();
    const program = teamsProgram();
    putEvidence(ev, program.bytes);
    const replies = runShow(binOf(), scenario(ev, [D.grid], [
      showCall(D.grid, gridDoc(program, ['nearest', 'smooth'])), evalCall(D.grid, at(BAD.from - 1), { pixels: false }), evalCall(D.grid, at(BAD.from)),
    ]), 'AC4 the grid fixture');
    presented(replies[0]!, 'the grid fixture, nearest_map beside smooth_map');
    const ranged = (k: number) => issuesOf(replies[k]!).filter((i) => i['code'] === 'grid.out_of_range');
    const failures: string[] = [];
    if (ranged(1).length) failures.push(`step ${BAD.from - 1}: every value is within roles, yet eval raises ${show(ranged(1))}`);
    const naming = ranged(2).filter((i) => names(String(field(i, 'array')), 'teams.ground') && JSON.stringify(field(i, 'cell')) === JSON.stringify([BAD.x, BAD.y])
      && field(i, 'value') === BAD.value && field(i, 'step') === BAD.from);
    if (!naming.length) failures.push(`step ${BAD.from}: eval raises no grid.out_of_range {array: teams.ground, cell: [${BAD.x}, ${BAD.y}], value: ${BAD.value}, step: ${BAD.from}}; its issues: ${show(issuesOf(replies[2]!), 2500)}`);

    const im = pngOf(ev, snapshotOf(replies[2]!, `the grid fixture at step ${BAD.from}`), `the grid fixture at step ${BAD.from}`);
    const key = keyOf(im, GRID_KEY_TOP, keyCenter, 'the grid fixture');
    const role0 = key.teams[0]!;
    const cellPx = (i: number, cx: number, cy: number, dx: number, dy: number): [number, number] => [originOf(i)[0] + CELL * cx + dx, originOf(i)[1] + CELL * cy + dy];
    const expectAt = (what: string, [x, y]: [number, number], want: number[], within: number): void => {
      const got = rgbAt(im, x, y);
      if (apart(got, want) > within) failures.push(`${what}: pixel (${x}, ${y}) draws [${got.join(', ')}], not [${want.join(', ')}]`);
    };
    for (let j = 0; j < CELL; j++) for (let i = 0; i < CELL; i++) expectAt(`nearest_map, cell (${BAD.x}, ${BAD.y}) holding ${BAD.value}, draws nothing`, cellPx(0, BAD.x, BAD.y, i, j), key.ground, 0);
    for (let j = 2; j < 6; j++) for (let i = 2; i < 6; i++) expectAt(`smooth_map, cell (${BAD.x}, ${BAD.y}) holding ${BAD.value}, draws nothing at its centre`, cellPx(1, BAD.x, BAD.y, i, j), key.ground, 1);
    for (const dx of [-1, 1]) expectAt(`nearest_map, cell (${BAD.x + dx}, ${BAD.y}) still draws role 0`, cellPx(0, BAD.x + dx, BAD.y, 4, 4), role0, 0);
    for (const dx of [-2, 2]) expectAt(`smooth_map, cell (${BAD.x + dx}, ${BAD.y}) still draws role 0 at its centre`, cellPx(1, BAD.x + dx, BAD.y, 4, 4), role0, 1);
    none(failures, `the value ${BAD.value} at cell (${BAD.x}, ${BAD.y}) from step ${BAD.from}`);
  }, TIMEOUT);
});
