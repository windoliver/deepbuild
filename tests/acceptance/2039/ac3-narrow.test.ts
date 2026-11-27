// AC3 #2039.87a8de22: With `center: false` the middle 184 × 80 u of the first row is not drawn, and an item under it
// shows through by pixel hash. A row 12 u wide with left 8 and right 8 is refused at check, naming the row and the
// smallest width 16. A planted check that takes it draws overlapping corners and fails, naming the row
// (this file carries the second and the third sentence; ac3-center.test.ts the first)
//
// Through `deep-canvas-render check` (the document check, every platform), as #2386's suite reads "refused at check".
// The set `narrow` (fixtures.ts) holds two free rows of the fixture atlas with `slice` 8 on each side, each 40 u tall:
// row 0, 40 u wide, and row 1, 12 u wide, so the row to name is not the set's first. The document that passes differs
// by that row's width alone: 16 u, the smallest width. A refusal names the row when an error issue's own fields hold
// `narrow#1`, or name the set and hold `row` 1; it names the smallest width when such an issue holds 16 as a whole
// number in its message (`what`) or its own fields. No other number of the refused document is 16.
//
// The planted program is test code (planted.ts `checkTakesNarrowRow`): what a check with no smallest size lets
// through, the 12 u row with both 8 u corners at their own size, laid by hand with no `slice`, so the shipped check
// takes it. `raster` at zoom 1 draws it (one px a u, as #2386's suite reads a pixel there): the corners overlap by 4 u.
// The judge that passes the shipped check's refusal fails the planted check's answer, naming the row.
// README: The surface under test; Planted programs; Readings.
import { describe, expect, it } from 'vitest';
import { NARROW, NARROW_PAGE, SIDE, SLICE, WIDE, boxOf, cellTexel, figure, frames } from './fixtures.ts';
import { cornerProblems, pixel, rowRefusalProblems, type Checked } from './judges.ts';
import { checkTakesNarrowRow } from './planted.ts';
import { AC, TIMEOUT, atlasPng, checked, describeErrors, failsNaming, none, once, putAssets, rasterLine, rasterLines, useBin, useTemp } from './helpers.ts';

const ID = AC[3];
const bin = useBin('deep-canvas-render');
const temp = useTemp();
/** The issue's smallest width, written out. */
const SMALLEST = 16;
const NAMED = 'row narrow#1, 12 u wide with left 8 and right 8';
/** The criterion's check of the refusal: each failure names the row. */
const problems = (answer: Checked): string[] => rowRefusalProblems(answer, 'narrow', '1', SMALLEST, 'width', NAMED);

const shipped = once(() => {
  const store = temp();
  const [atlas] = putAssets(store, [atlasPng()]);
  const set = (width: number) => frames({ id: 'narrow', asset: atlas!, rows: [WIDE, { ...NARROW, w: width }] });
  const [taken, refused] = checked(bin(), [figure('smallest', NARROW_PAGE, [set(SMALLEST)]), figure('narrow', NARROW_PAGE, [set(NARROW.w)])], store);
  return { taken: taken!, refused: refused! };
});

describe(`${ID} a nine-part row narrower than its corners is refused`, () => {
  it(`${ID} a row 12 u wide with left 8 and right 8 is refused at check, naming the row and the smallest width 16`, () => {
    expect([NARROW.w, SLICE.left, SLICE.right, SLICE.left + SLICE.right], 'the fixture: a row 12 u wide, left 8 and right 8, whose sum is the smallest width').toEqual([12, 8, 8, SMALLEST]);
    const { taken, refused } = shipped();
    expect(taken.ok, `the same set with that row 16 u wide, the smallest width, passes the check: ${describeErrors(taken.errors)}`).toBe(true);
    none(problems(refused), 'the row 12 u wide is refused at check, naming the row and the smallest width 16');
  }, TIMEOUT);

  it(`${ID} a planted check that takes the row (check_takes_narrow_row) draws overlapping corners and fails the same check, naming the row`, () => {
    const store = temp();
    const [atlas] = putAssets(store, [atlasPng()]);
    const doc = figure('narrow-taken', NARROW_PAGE, [checkTakesNarrowRow(atlas!, NARROW, 'narrow')]);
    const [answer] = checked(bin(), [doc], store);
    expect(answer!.ok, `the planted check takes the row: ${describeErrors(answer!.errors)}`).toBe(true);
    // What it takes is drawn with overlapping corners: the left corner's first 4 columns, then the right corner's 8.
    const im = rasterLines(bin(), [rasterLine(temp(), doc, 0, { store, view: { zoom: 1 } })], 'the row 12 u wide as check_takes_narrow_row lets it draw')[0]!.image;
    expect([im.width, im.height], 'raster at zoom 1 draws the 120 × 80 u page one px a u').toEqual(NARROW_PAGE);
    const box = boxOf(NARROW);
    const off: string[] = [];
    for (let j = 0; j < SIDE; j++) for (let i = 0; i < NARROW.w; i++) {
      const want = i < NARROW.w - SIDE ? cellTexel(i, j) : cellTexel(2 * SIDE + i - (NARROW.w - SIDE), j);
      const got = pixel(im, box[0] + i, box[1] + j);
      if (got.some((v, c) => v !== want[c])) off.push(`pixel (${box[0] + i}, ${box[1] + j}) reads [${got.join(', ')}], not [${want.join(', ')}]`);
    }
    none(off, 'the planted draw is that draw: both 8 u corners in a box 12 u wide, the right one over the left one\'s last 4 u');
    failsNaming(cornerProblems(im, 'narrow#1', box), [/row narrow#1/, /pixel \(88, 20\)/], 'the corners the planted check lets draw: the left corner is drawn over from its fifth column');
    const failures = problems(answer!);
    console.log(`AC3 check_takes_narrow_row fails the refusal's check: ${failures[0] ?? 'none'}`);
    failsNaming(failures, [/row narrow#1/, /takes it/], 'the refusal under check_takes_narrow_row');
    none(problems(shipped().refused), 'the shipped check of the same row passes the check the planted check fails');
  }, TIMEOUT);
});
