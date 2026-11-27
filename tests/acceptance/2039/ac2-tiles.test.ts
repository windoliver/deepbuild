// AC2 #2039.18a89663: With `fill: tile` the top edge repeats its 8-texel strip 23 times across 184 u. With `fill:
// tile_fit` and a row 190 u wide it repeats 22 times across 174 u, each tile the same width and none cut. A planted
// draw that cuts the last tile under `tile_fit` fails, naming the edge
//
// The fixtures (fixtures.ts): criterion 1's row, 200 × 96 u in the box [16, 16, 200, 96], in a set `frame` with `fill:
// tile`; and a set `fit` with `fill: tile_fit` whose one row is 190 u wide and as tall, in the box [21, 16, 190, 96].
// Each is over the item `under` on the 232 × 128 u page, and both are shown by one `deep-show run`, each by `deep_show`
// with pixels (the snapshot at zoom 1 and scale factor 1). The top edge is the 8 lines at the top of the box between
// the two corners. Its strip is texels (8..15, 0..7) of the cell: its red climbs 85, 95, … 155 along the strip and its
// green spells the line, so a repeat is read from its pixels and a pixel says how far into the strip it is. Under
// `tile` a repeat is 8 u for 8 texels and is compared exactly. Under `tile_fit` a repeat is 174 ÷ 22 u, so its pixels
// mix texels: judges.ts `tileFitProblems` counts the falls of the red and holds each repeat's pixels to the texel a
// whole repeat of that width shows there. The planted program is test code (planted.ts `tileFitCutsLastTile`): the
// row's parts laid by hand at their own size, 21 whole tiles and the first 6 u of a 22nd.
// README: The surface under test; Planted programs; Readings.
import { describe, expect, it } from 'vitest';
import { FIRST, FIT, PAGE, SIDE, boxOf, film, frames, under, type Item } from './fixtures.ts';
import { cutProblems, tileFitProblems, tileProblems } from './judges.ts';
import { tileFitCutsLastTile } from './planted.ts';
import { AC, DOC, TIMEOUT, atlasPng, failsNaming, none, once, putEvidence, runShow, scenario, showCall, snapshotOf, underPng, useBin, useTemp, type Image } from './helpers.ts';

const ID = AC[2];
const bin = useBin('deep-show');
const temp = useTemp();
const BOX = boxOf(FIRST);
const FIT_BOX = boxOf(FIT);
/** The issue's counts, written out. */
const TILES = 23;
const FITTED = 22;

/** Each set over the item under it on a page of its own, all shown by one `deep-show run`: each page's snapshot. */
function drawn(sets: ((atlas: string) => Item)[], what: string): Image[] {
  const ev = temp();
  const atlas = putEvidence(ev, atlasPng());
  const ground = putEvidence(ev, underPng(PAGE));
  const docs = sets.map((_, i) => DOC(i + 1));
  const calls = sets.map((set, i) => showCall(docs[i]!, film(`top-edge-${i + 1}`, PAGE, [under(ground, PAGE), set(atlas)], { frame_atlas: atlas, under_picture: ground }), true));
  const replies = runShow(bin(), scenario(ev, docs, calls), `AC2 ${what}`);
  return replies.map((reply, i) => snapshotOf(ev, reply, `${what} [${i + 1}]`));
}
/** The criterion's check of the row 190 u wide: each failure names the row and the top edge. */
const fitProblems = (im: Image): string[] => tileFitProblems(im, 'fit#0', FIT_BOX, FITTED);

const shipped = once(() => {
  const [tile, fit] = drawn([
    (atlas) => frames({ id: 'frame', asset: atlas, rows: [FIRST], fill: 'tile' }),
    (atlas) => frames({ id: 'fit', asset: atlas, rows: [FIT], fill: 'tile_fit' }),
  ], 'the rows with fill: tile and fill: tile_fit');
  return { tile: tile!, fit: fit! };
});

describe(`${ID} a nine-part frame's top edge tiles`, () => {
  it(`${ID} with fill: tile the top edge repeats its 8-texel strip 23 times across 184 u; with fill: tile_fit and a row 190 u wide it repeats 22 times across 174 u, each tile the same width and none cut`, () => {
    expect([FIRST.w - 2 * SIDE, TILES * SIDE], 'the fixture: the top edge of the row 200 u wide runs 184 u between its corners, 23 strips of 8 texels').toEqual([184, 184]);
    expect([FIT.w, FIT.w - 2 * SIDE, Math.round((FIT.w - 2 * SIDE) / SIDE)], 'the fixture: the top edge of the row 190 u wide runs 174 u, and the nearest whole number of 8 u tiles in it is 22').toEqual([190, 174, FITTED]);
    const { tile, fit } = shipped();
    expect([[tile.width, tile.height], [fit.width, fit.height]], 'each snapshot is the 232 × 128 u page at zoom 1 and scale factor 1').toEqual([PAGE, PAGE]);
    none(tileProblems(tile, 'frame#0', BOX, TILES), 'with fill: tile the top edge repeats its 8-texel strip 23 times across 184 u');
    none(fitProblems(fit), 'with fill: tile_fit and a row 190 u wide the top edge repeats 22 times across 174 u, each tile the same width and none cut');
  }, TIMEOUT);

  it(`${ID} a planted draw that cuts the last tile under tile_fit (tile_fit_cuts_last_tile) fails the same check, naming the edge`, () => {
    const [twin] = drawn([(atlas) => tileFitCutsLastTile(atlas, FIT, 'fit')], 'the row 190 u wide as tile_fit_cuts_last_tile draws it');
    none(cutProblems(twin!, FIT_BOX, FITTED - 1, 6), 'the planted draw is that draw: 21 tiles of 8 u, then the last cut at 6 u where the right corner starts');
    const failures = fitProblems(twin!);
    console.log(`AC2 tile_fit_cuts_last_tile fails the top edge's check with ${failures.length} lines, the first: ${failures[0] ?? 'none'}`);
    failsNaming(failures, [/row fit#0/, /top edge/], 'the top edge under tile_fit_cuts_last_tile');
    failsNaming(failures, [/top edge: repeat 22 of 22/, /cut/], 'the top edge under tile_fit_cuts_last_tile: its last repeat');
    none(fitProblems(shipped().fit), 'the shipped draw of the same row passes the check the planted draw fails');
  }, TIMEOUT);
});
