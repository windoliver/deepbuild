// AC3 #2039.87a8de22: With `center: false` the middle 184 × 80 u of the first row is not drawn, and an item under it
// shows through by pixel hash. A row 12 u wide with left 8 and right 8 is refused at check, naming the row and the
// smallest width 16. A planted check that takes it draws overlapping corners and fails, naming the row
// (this file carries the first sentence; ac3-narrow.test.ts the second and the third)
//
// The fixtures (fixtures.ts): criterion 1's row, 200 × 96 u in the box [16, 16, 200, 96], in a set `frame` over the
// item `under`, an image that covers the 232 × 128 u page with a picture no two neighbouring pixels of which are equal.
// Three pages through one `deep-show run`, each shown by `deep_show` with pixels: the row with `center: false` over
// the item; the row with nothing but its `slice` over the item (the centre draws, the design's default); and the item
// alone. The middle is what the slice leaves between its sides, [24, 24, 184, 80]. "Shows through by pixel hash": the
// SHA-256 of the middle's pixels with the row over the item is that of the same region of the item alone. Not
// vacuous: the item's middle holds many colors, the default row's middle hashes differently, and the row with
// `center: false` is drawn, its four corners texel for texel as criterion 1 reads them.
// README: The surface under test; Readings.
import { describe, expect, it } from 'vitest';
import { FIRST, PAGE, boxOf, film, frames, under, type Item } from './fixtures.ts';
import { colorsIn, cornerProblems, middleOf, regionHash, throughProblems } from './judges.ts';
import { AC, DOC, TIMEOUT, atlasPng, none, once, putEvidence, runShow, scenario, showCall, snapshotOf, underPng, useBin, useTemp } from './helpers.ts';

const ID = AC[3];
const bin = useBin('deep-show');
const temp = useTemp();
const ROW = 'frame#0';
const BOX = boxOf(FIRST);
const MIDDLE = middleOf(BOX);

const shipped = once(() => {
  const ev = temp();
  const atlas = putEvidence(ev, atlasPng());
  const ground = putEvidence(ev, underPng(PAGE));
  const page = (id: string, sets: Item[]) => film(id, PAGE, [under(ground, PAGE), ...sets], { frame_atlas: atlas, under_picture: ground });
  const docs = [DOC(1), DOC(2), DOC(3)];
  const calls = [
    showCall(docs[0]!, page('hollow', [frames({ id: 'frame', asset: atlas, rows: [FIRST], center: false })]), true),
    showCall(docs[1]!, page('filled', [frames({ id: 'frame', asset: atlas, rows: [FIRST] })]), true),
    showCall(docs[2]!, page('under-alone', []), true),
  ];
  const [hollow, filled, alone] = runShow(bin(), scenario(ev, docs, calls), 'AC3 the first row with center: false');
  return {
    hollow: snapshotOf(ev, hollow!, 'the first row with center: false over the item'),
    filled: snapshotOf(ev, filled!, 'the first row with its centre over the item'),
    alone: snapshotOf(ev, alone!, 'the item alone'),
  };
});

describe(`${ID} a nine-part frame with center: false leaves its middle undrawn`, () => {
  it(`${ID} with center: false the middle 184 × 80 u of the first row is not drawn, and an item under it shows through by pixel hash`, () => {
    expect(MIDDLE, 'the fixture: the middle of the first row is 184 × 80 u, what slice 8 on each side leaves of 200 × 96 u').toEqual([24, 24, 184, 80]);
    const { hollow, filled, alone } = shipped();
    expect([hollow, filled, alone].map((im) => [im.width, im.height]), 'each snapshot is the 232 × 128 u page at zoom 1 and scale factor 1').toEqual([PAGE, PAGE, PAGE]);
    // Not vacuous: the item under the row is drawn there, and a row whose centre draws hides it.
    expect(colorsIn(alone, MIDDLE), 'the item under the row is drawn across the middle: its picture holds many colors there').toBeGreaterThan(1000);
    expect(regionHash(filled, MIDDLE), 'with nothing but its slice the row draws its centre over the item, so the middle hashes differently').not.toBe(regionHash(alone, MIDDLE));
    none(throughProblems(hollow, alone, ROW, BOX), 'with center: false the middle 184 × 80 u is not drawn and the item under it shows through by pixel hash');
    none(cornerProblems(hollow, ROW, BOX), 'the row with center: false is drawn: its corners are the source texels');
  }, TIMEOUT);
});
