// AC4 #2039.2e193c48: 500 such rows from one atlas draw in one instanced draw for their atlas, and a set with `slice`
// on `place: cell` is refused, naming the set. Budgets, on the reference Mac in the local preflight, compared with the
// merge base: the 500 rows add under 0.2 ms a frame (drafted, a target to be measured)
// (this file carries the first clause; ac4-place-cell.test.ts the second and ac4-budget.test.ts the third)
//
// The set `rows` (fixtures.ts `rowsDoc`): 500 free rows of the fixture atlas's frame cell with `slice` 8 on each side
// and nothing else, 25 across and 20 down, their boxes 32, 40 or 48 u wide and 32 or 40 u tall on whole units, the set
// at (4, 4) of a 1304 × 884 u page. Through `deep-show run`: `deep_show` with pixels, whose `batches` hold one entry
// `{batch, items, instances}` per atlas run (#535's and #2386's reading of "one instanced draw"). "Such rows" are
// nine-part rows, so the draw counted must be theirs: in the same snapshot each of the 500 rows' four corners is the
// source texels, pixel for pixel, as criterion 1 reads one row's. One quad of the whole cell a row, which the merge
// base draws in one instanced draw too, shows no row's corners.
import { describe, expect, it } from 'vitest';
import { ROWS, ROWS_PAGE, ROWS_POS, boxOf, moved, rowsDoc, rowsOf } from './fixtures.ts';
import { cornerProblems, oneDrawProblems } from './judges.ts';
import { AC, DOC, TIMEOUT, atlasPng, none, putEvidence, runShow, scenario, showCall, snapshotOf, useBin, useTemp } from './helpers.ts';

const ID = AC[4];
const bin = useBin('deep-show');
const temp = useTemp();
const D = DOC(1);

describe(`${ID} 500 nine-part rows: one instanced draw`, () => {
  it(`${ID} 500 such rows from one atlas draw in one instanced draw for their atlas`, () => {
    const rows = rowsOf();
    expect([ROWS, rows.length], 'the fixture: 500 rows').toEqual([500, 500]);
    const ev = temp();
    const atlas = putEvidence(ev, atlasPng());
    const [reply] = runShow(bin(), scenario(ev, [D], [showCall(D, rowsDoc(atlas), true)], [0, 0, 1304, 884]), 'AC4 the 500 rows');
    const im = snapshotOf(ev, reply!, 'the 500 rows');
    expect([im.width, im.height], 'the snapshot is the 1304 × 884 u page at zoom 1 and scale factor 1').toEqual(ROWS_PAGE);
    // The rows counted are nine-part rows: each one's corners are the source texels.
    const off = rows.map((r, i) => cornerProblems(im, `rows#${i}`, moved(boxOf(r), ROWS_POS))).filter((p) => p.length > 0);
    none(off.slice(0, 12).map((p) => p[0]!), `each of the 500 rows is drawn as a nine-part frame, its corners the source texels (${off.length} rows aren't)`);
    none(oneDrawProblems(reply!['batches'], 'rows', ROWS), 'the 500 rows draw in one instanced draw for their atlas');
  }, TIMEOUT);
});
