// AC6 #2386.b3f6fe16: 10,000 rows with `draw` from one atlas draw in one instanced draw for their atlas. Each fixture
// of #1653 and #536 keeps its pixel hash. Budgets, on the reference Mac in the local preflight, compared with the merge
// base: the 10,000 rows add under 0.1 ms a frame over the same set without `draw` (drafted, a target to be measured)
// (this file carries the first clause; ac6-hashes.test.ts the second and ac6-budget.test.ts the third)
//
// The set `rows` (fixtures.ts `rowsDoc`): 10,000 rows on a 100 × 100 square grid of 4 u cells, each a 4 × 8 px tile of
// one atlas with `draw: [4, 8]` and `anchor: [0.5, 0.75]`, at (4, 8) of its page. Through `deep-show run`: `deep_show`
// with pixels, whose `batches` hold one entry `{batch, items, instances}` per atlas run (#535's reading of "one
// instanced draw"), and `spatial`, whose bounds for the set show the rows are drawn with their `draw`: the union of
// 10,000 quads of 4 × 8 u, each with its anchor on its cell's center, not of 4 × 4 u cells.
import { describe, expect, it } from 'vitest';
import { ROWS, ROWS_ANCHOR, ROWS_DRAW, ROWS_POS, quadAt, rowsDoc } from './fixtures.ts';
import {
  AC, DOC, TIMEOUT, arr, boundsOf, boxText, moved, num, obj, presented, putEvidence, runShow, sameBox, scenario, showCall, shown, solidAtlas,
  spatialCall, str, useBin, useTemp, type Box, type JsonObject,
} from './helpers.ts';

const ID = AC[6];
const bin = useBin('deep-show');
const temp = useTemp();
const D = DOC(1);

describe(`${ID} 10,000 rows with draw: one instanced draw`, () => {
  it(`${ID} 10,000 rows with draw from one atlas draw in one instanced draw for their atlas`, () => {
    const ev = temp();
    const atlas = putEvidence(ev, solidAtlas([4, 8], [[64, 112, 72], [236, 196, 64]]));
    const [shownReply, spatial] = runShow(bin(), scenario(ev, [{ doc: D, rect: [0, 0, 808, 816] }], [showCall(D, rowsDoc(atlas), true), spatialCall(D, [])]), 'AC6 the 10,000 rows') as [JsonObject, JsonObject];
    presented(shownReply, 'the 10,000 rows');
    // The rows are drawn with their draw: the first and the last row's quads span the set's bounds.
    const [first, last] = [quadAt([0, 0], ROWS_DRAW, ROWS_ANCHOR), quadAt([396, 396], ROWS_DRAW, ROWS_ANCHOR)];
    const want: Box = [first[0], first[1], last[0] + last[2] - first[0], last[1] + last[3] - first[1]];
    const bounds = moved(boundsOf(spatial, 'rows', 'the 10,000 rows'), [-ROWS_POS[0], -ROWS_POS[1]]);
    expect(sameBox(bounds, want), `the set's bounds are its 10,000 drawn quads', ${boxText(want)}; they are ${boxText(bounds)}`).toBe(true);
    const batches = arr(shownReply['batches'], `deep_show's batches (${shown(Object.keys(shownReply))})`).map((b, i) => obj(b, `batches[${i}]`));
    const drawing = batches.filter((b) => arr(b['items'], 'a batch\'s items').map((x) => str(x, 'a batch\'s item')).includes('rows'));
    expect(drawing.length, `one instanced draw draws the set rows: ${shown(batches)}`).toBe(1);
    expect(num(drawing[0]!['instances'], 'the batch\'s instances'), `that draw draws all ${ROWS} rows`).toBe(ROWS);
  }, TIMEOUT);
});
