// Re-expressed from an upstream engine's own test file `tests/scene/test_nine_patch_rect.cpp`, lines 156 to 175, its
// case "Patch margins drive minimum size", at commit ed1daf0bf001b61586d9930840f2f1394092c079 (the Oracle map's pin for
// #2039's criterion 3), licensed under the MIT License. No code is copied: the case's inputs and its expected value
// are written here on our documents and judged on what our check answers (#136).
//
// AC3 #2039.87a8de22: With `center: false` the middle 184 × 80 u of the first row is not drawn, and an item under it
// shows through by pixel hash. A row 12 u wide with left 8 and right 8 is refused at check, naming the row and the
// smallest width 16. A planted check that takes it draws overlapping corners and fails, naming the row
// (the Oracle map links the upstream test to this criterion's second sentence, the smallest size behind the refusal;
// the upstream file never reads a pixel, so the first sentence has no upstream test, and neither has the third)
//
// Upstream's case: a nine-part rect whose margins are set to left 10, top 20, right 30 and bottom 40 has the minimum
// size (40, 60): "minimum width is left + right; minimum height is top + bottom". Ours: a nine-part set `plate` with
// `slice: {left: 10, top: 20, right: 30, bottom: 40}` on an atlas whose one cell, 48 × 64 px, leaves texels between
// those sides (upstream sets its margins on no picture; our check refuses a `slice` whose sides leave no texel between
// them, so the cell is ours). Its row 0 is 100 × 100 u in every document. The smallest size is read where our check
// shows it, at the refusal: with row 1 exactly 40 × 60 u the document passes; with row 1 one u narrower, 39 u wide, it
// is refused naming the row and the smallest width 40; with row 1 one u shorter, 59 u tall, naming the row and the
// smallest height 60. Through `deep-canvas-render check`, read as the #2039 suite reads its own refusal
// (../2039/judges.ts `rowRefusalProblems`). The case's second half, right 0 giving (10, 60), is not ported: README.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, checked, describeErrors, figure, frames, none, plainPng, putAssets, rowRefusalProblems, useBin, useTemp, type Pt, type Row, type Sides } from './helpers.ts';

const ID = AC[3];
const bin = useBin('deep-canvas-render');
const temp = useTemp();
/** Upstream's margins and the minimum size it expects of them, written out. */
const MARGINS: Sides = { left: 10, top: 20, right: 30, bottom: 40 };
const MINIMUM: Pt = [40, 60];
/** Ours: a cell that holds those sides with texels between them, and a page for two rows. */
const CELL: Pt = [48, 64];
const PAGE: Pt = [240, 240];
const BIG: Row = { x: 70, y: 120, w: 100, h: 100 };

describe(`${ID} oracle: the smallest size of a nine-part row is left + right by top + bottom`, () => {
  it(`${ID} upstream's margins left 10, top 20, right 30 and bottom 40 give the smallest size (40, 60): a row 40 × 60 u passes the check, a row 39 u wide is refused naming the row and the smallest width 40, and a row 59 u tall naming the row and the smallest height 60`, () => {
    expect([MARGINS.left + MARGINS.right, MARGINS.top + MARGINS.bottom], 'upstream\'s rule on upstream\'s margins: left + right by top + bottom').toEqual(MINIMUM);
    const store = temp();
    const [atlas] = putAssets(store, [plainPng(CELL)]);
    const doc = (id: string, w: number, h: number) => figure(id, PAGE, [frames({ id: 'plate', asset: atlas!, cell: CELL, slice: MARGINS, tile: 0, rows: [BIG, { x: 180, y: 120, w, h }] })]);
    const [smallest, narrow, short] = checked(bin(), [doc('smallest', MINIMUM[0], MINIMUM[1]), doc('narrow', MINIMUM[0] - 1, 100), doc('short', 100, MINIMUM[1] - 1)], store);
    expect(smallest!.ok, `a row of exactly the smallest size, 40 × 60 u, passes the check: ${describeErrors(smallest!.errors)}`).toBe(true);
    none([
      ...rowRefusalProblems(narrow!, 'plate', '1', MINIMUM[0], 'width', 'row plate#1, 39 u wide with left 10 and right 30'),
      ...rowRefusalProblems(short!, 'plate', '1', MINIMUM[1], 'height', 'row plate#1, 59 u tall with top 20 and bottom 40'),
    ], 'a row one u under the smallest size, either way, is refused at check, naming the row and that size');
  }, TIMEOUT);
});
