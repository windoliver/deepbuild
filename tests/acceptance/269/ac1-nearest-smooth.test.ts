// AC1 #269.871a5dac: A 64 × 64 grid of three roles drawn `nearest` at 8 px a cell matches its cells pixel for pixel;
// drawn `smooth`, a lone held cell among `none` draws the region where k(x) × k(y) passes 1/2, k being the Catmull-Rom
// kernel and x and y in cells from its centre, whose edge crosses each axis 0.545 cells and each diagonal 0.553 cells
// from the centre, within 0.5 px at 8 px a cell; a planted approximating B-spline, whose share for a lone cell peaks at
// 4/9, draws nothing there, and a planted bilinear rebuild draws a four-pointed star whose diagonal reaches 0.414 cells;
// each fails, naming the mark
//
// The grid fixture (fixtures.ts `gridDoc`, programs.ts `teamsProgram`) drawn by `deep-show run`'s `eval` at step 20, the
// canvas's canonical render of the hub session's frame (README: The surface under test): `nearest_map` on the left and
// `smooth_map` on the right read the same array, over a backdrop in the ground, beside a key that gives each team role's
// color as the canvas draws it. Nearest (judges.ts `nearestFailures`): every pixel of every cell is its value's role
// color, or the ground for `none`, exactly. Smooth (judges.ts `loneJudge`): the lone held cell (48, 16), among `none`
// with nothing else within two cells, is judged against k(x)·k(y) = 1/2 computed here from the kernel (helpers.ts
// `catmullRom`): along both axes both ways and the four diagonals, the pixels through its centre pass from its role to
// the ground where the half level crosses that line, within 0.5 px; and every pixel more than 1 px from the half level
// is wholly its role inside and the ground outside. Each failure names the mark.
import { describe, expect, it } from 'vitest';
import { teamsProgram } from './programs.ts';
import { GRID_KEY_TOP, gridDoc, keyCenter } from './fixtures.ts';
import { loneJudge, nearestFailures, SMOOTH, WITHIN } from './judges.ts';
import {
  AC, DOC, TIMEOUT, at, binOf, evalCall, failsNaming, halfLevel, keyOf, none, pngOf, prebuild, presented, putEvidence, runShow, scenario,
  showCall, snapshotOf, useTemp, type Image, type Key, type ShowPlant,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const D = { grid: DOC(1) };
const STEP_AT = 20;

/** The grid fixture drawn at step 20, and its key. */
function drawn(planted?: ShowPlant): { im: Image; key: Key } {
  const ev = temp();
  const program = teamsProgram();
  putEvidence(ev, program.bytes);
  const doc = gridDoc(program, ['nearest', 'smooth']);
  const sc = scenario(ev, [D.grid], [showCall(D.grid, doc), evalCall(D.grid, at(STEP_AT))]);
  const replies = runShow(binOf(), planted ? { ...sc, planted } : sc, 'AC1 the grid fixture');
  presented(replies[0]!, 'the grid fixture, nearest_map beside smooth_map');
  const im = pngOf(ev, snapshotOf(replies[1]!, `the grid fixture at step ${STEP_AT}`), `the grid fixture at step ${STEP_AT}`);
  expect([im.width, im.height], 'the frame is the document\'s size, 1 px a u').toEqual(doc['size']);
  return { im, key: keyOf(im, GRID_KEY_TOP, keyCenter, 'the grid fixture') };
}

describe(`${AC[1]} the grid fixture: nearest pixel for pixel, and the lone held cell drawn smooth to the half level of the Catmull-Rom kernel`, () => {
  it(`${AC[1]} nearest matches its cells pixel for pixel; smooth draws the lone cell where k(x)·k(y) passes 1/2, its edge 0.545 cells along each axis and 0.553 along each diagonal, within 0.5 px`, () => {
    // The expected values are the kernel's, worked out here, not read from any program.
    expect(halfLevel(1, 0).toFixed(3), 'k(x)·k(0) = 1/2 at 0.545 cells').toBe('0.545');
    expect(halfLevel(Math.SQRT1_2, Math.SQRT1_2).toFixed(3), 'k(d)·k(d) = 1/2 at 0.553 cells along the diagonal').toBe('0.553');
    const { im, key } = drawn();
    none([...nearestFailures(im, key, STEP_AT), ...loneJudge(im, key, STEP_AT).failures], `the grid fixture at step ${STEP_AT}`);
  }, TIMEOUT);

  it(`${AC[1]} planted grid_bspline_rebuild, whose lone-cell share peaks at 4/9, draws nothing at the lone cell and fails, naming the mark`, () => {
    const { im, key } = drawn('grid_bspline_rebuild');
    const lone = loneJudge(im, key, STEP_AT);
    expect(lone.held, 'under the planted B-spline rebuild the lone cell draws nothing: no pixel within 2 cells is nearer its role than the ground').toBe(0);
    failsNaming(lone.failures, [new RegExp(SMOOTH)], 'the lone cell under grid_bspline_rebuild');
  }, TIMEOUT);

  it(`${AC[1]} planted grid_bilinear_rebuild draws a four-pointed star whose diagonal reaches 0.414 cells and fails, naming the mark`, () => {
    const { im, key } = drawn('grid_bilinear_rebuild');
    const lone = loneJudge(im, key, STEP_AT);
    for (const [name, t] of [...lone.crossings].filter(([line]) => line.endsWith('diagonal'))) {
      expect(t !== null && Math.abs(t - (Math.SQRT2 - 1)) <= WITHIN, `under the planted bilinear rebuild the lone cell's edge crosses the ${name} at 0.414 cells: ${String(t)}`).toBe(true);
    }
    failsNaming(lone.failures, [new RegExp(SMOOTH), /diagonal/], 'the lone cell under grid_bilinear_rebuild');
  }, TIMEOUT);
});
