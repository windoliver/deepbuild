// AC1 #2039.31be1538: A new fixture atlas has a 24 × 24 px cell and `slice` 8 on each side. A free row 200 × 96 u on
// whole units, at angle 0 and scale 1, in a snapshot at zoom 1 and scale factor 1: each corner's 8 × 8 pixels equal the
// source texels exactly, and no pixel holds a texel from a neighbouring cell. A planted draw that scales the whole cell
// to the box fails, naming the row and the first differing pixel
//
// The fixture (fixtures.ts): the set `frame`, one free row of the atlas's middle cell at (116, 64) with `w` 200 and
// `h` 96, so its box is [16, 16, 200, 96] on a 232 × 128 u page, with `slice` 8 on each side and nothing else (no
// `fill`, no `center`, no `angle`, no `scale`), over the item `under`, a picture that covers the page. Through
// `deep-show run`: `deep_show` with pixels, whose snapshot at the document's own size is the page at zoom 1 and scale
// factor 1 (#2386's reading). Every texel of the frame cell is [10x + 5, 10y + 5, 0, 255], so no two are equal; every
// texel of the eight cells around it holds the same red and green with blue 255; the picture under the row holds red
// 240 or more and blue 0. So a corner pixel equals its texel or doesn't, a pixel with any blue holds a neighbour's
// texel however it was sampled, and a pixel of the box with red above 235 isn't the frame's. That the blue is read is
// shown on a second page: the same row showing the cell to the frame's right, every pixel of which is a neighbour's.
// The planted program is test code (planted.ts `wholeCellScaledToBox`): the same row as one quad of the whole cell,
// scaled to the box. README: The surface under test; Planted programs.
import { describe, expect, it } from 'vitest';
import { CELL, FIRST, FRAME_TILE, PAGE, SLICE, boxOf, film, frames, under, type Item } from './fixtures.ts';
import { cornerProblems, coverProblems, neighbourProblems, wholeCellProblems } from './judges.ts';
import { wholeCellScaledToBox } from './planted.ts';
import { AC, DOC, TIMEOUT, atlasPng, failsNaming, none, once, putEvidence, runShow, scenario, showCall, snapshotOf, underPng, useBin, useTemp, type Image } from './helpers.ts';

const ID = AC[1];
const bin = useBin('deep-show');
const temp = useTemp();
const ROW = 'frame#0';
const BOX = boxOf(FIRST);

/** Each set over the item under it on a page of its own, all shown by one `deep-show run`: each page's snapshot. */
function drawn(sets: ((atlas: string) => Item)[], what: string): Image[] {
  const ev = temp();
  const atlas = putEvidence(ev, atlasPng());
  const ground = putEvidence(ev, underPng(PAGE));
  const docs = sets.map((_, i) => DOC(i + 1));
  const calls = sets.map((set, i) => showCall(docs[i]!, film(`first-row-${i + 1}`, PAGE, [under(ground, PAGE), set(atlas)], { frame_atlas: atlas, under_picture: ground }), true));
  return runShow(bin(), scenario(ev, docs, calls), `AC1 ${what}`).map((reply, i) => snapshotOf(ev, reply, `${what} [${i + 1}]`));
}
/** The criterion's check of the corners: each failure names the row and a pixel, the first the first differing pixel. */
const problems = (im: Image): string[] => cornerProblems(im, ROW, BOX);

const shipped = once(() => {
  const [frame, neighbour] = drawn([
    (atlas) => frames({ id: 'frame', asset: atlas, rows: [FIRST] }),
    (atlas) => frames({ id: 'frame', asset: atlas, rows: [FIRST], tile: FRAME_TILE + 1 }),
  ], 'the first row, and the same row showing the cell to its right');
  return { frame: frame!, neighbour: neighbour! };
});

describe(`${ID} a nine-part frame's corners keep their size`, () => {
  it(`${ID} a free row 200 × 96 u on whole units, at angle 0 and scale 1, in a snapshot at zoom 1 and scale factor 1: each corner's 8 × 8 pixels equal the source texels exactly, and no pixel holds a texel from a neighbouring cell`, () => {
    expect([CELL, SLICE, [FIRST.w, FIRST.h], BOX], 'the fixture: a 24 × 24 px cell, slice 8 on each side, a row 200 × 96 u whose box lies on whole units').toEqual([[24, 24], { left: 8, top: 8, right: 8, bottom: 8 }, [200, 96], [16, 16, 200, 96]]);
    const { frame, neighbour } = shipped();
    expect([[frame.width, frame.height], [neighbour.width, neighbour.height]], 'each snapshot is the 232 × 128 u page at zoom 1 and scale factor 1').toEqual([PAGE, PAGE]);
    none(problems(frame), `each corner's 8 × 8 pixels equal the source texels exactly`);
    // Not vacuous: the frame fills its box, so the pixels read are the row's, and a row that shows a neighbouring cell fails.
    none(coverProblems(frame, ROW, BOX), 'the row is drawn: the frame fills its box over the item under it');
    failsNaming(neighbourProblems(neighbour, ROW), [/row frame#0/, /pixel \(\d+, \d+\)/], 'the same row showing the cell to the frame\'s right holds a neighbouring cell\'s texels');
    none(neighbourProblems(frame, ROW), 'no pixel holds a texel from a neighbouring cell');
  }, TIMEOUT);

  it(`${ID} a planted draw that scales the whole cell to the box (whole_cell_scaled_to_box) fails the same check, naming the row and the first differing pixel`, () => {
    const [twin] = drawn([(atlas) => wholeCellScaledToBox(atlas, FIRST, 'frame')], 'the first row as whole_cell_scaled_to_box draws it');
    none(wholeCellProblems(twin!, BOX), 'the planted draw is that draw: the whole cell scaled to the box [16, 16, 200, 96]');
    const failures = problems(twin!);
    console.log(`AC1 whole_cell_scaled_to_box fails the corners' check with ${failures.length} lines, the first: ${failures[0] ?? 'none'}`);
    failsNaming(failures.slice(0, 1), [/row frame#0/, /pixel \(\d+, \d+\)/], 'the corners under whole_cell_scaled_to_box: the first failure, the first differing pixel in reading order');
    none(problems(shipped().frame), 'the shipped draw of the same row passes the check the planted draw fails');
  }, TIMEOUT);
});
