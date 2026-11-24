// AC5 #290.9e8b88d3: A row that a `seen` column hides on this copy draws no hidden view; a planted pass that ignores
// `seen` draws it and fails, naming the row
//
// The piece is helpers.ts's rows' piece: #552's `sight` writes four rows behind one wall and `seen`, bit p − 1 set
// where player p sees the row (row 0 both, row 1 player 2 alone, row 2 player 1 alone, row 3 neither); the instancer
// `enemies` is fed by it, its `seen` column reading `sight.seen`, and carries `hidden_view: {opacity: 0.4}`: the
// design gives the field to a 3D item, and an instancer is one item whose rows are what it draws (README: Readings).
// Both copies play 120 match steps through `match` over the test relay, and each copy's view is asked for after
// step 100 (#552's `views`).
//
// Each view's frame is read at each row's centre and 10 px to each side of it, against the wall alone 34 px above
// (helpers.ts, `rowFailures`): a row the column hides on that copy reads as the wall alone (every such pixel within 2
// codes of it), and a row that copy's player sees shows through the wall (every such pixel more than 12 codes from
// it), which is what makes the first half more than a wall with nothing behind it.
//
// Wrong programs it fails: the merge base (the check refuses `hidden_view` as no field of an item); a hidden view
// that reads player 1's bit on every copy, or hides a row by its place; the scenario's `planted:
// "hidden_view_ignores_seen"` (the hidden view's pass draws every live row, whatever its `seen` holds), under which
// copy 1 draws a hidden view of row 1 and of row 3, and the judge names the copy and the row.
import { describe, expect, it } from 'vitest';
import { requireMetal } from '../424/helpers.ts';
import { sightProgram } from '../552/fixtures.ts';
import { AC, DOC, TIMEOUT, rowFailures, rowsDoc } from './helpers.ts';
import { FULL, play, useBuilds, useChildren, useTemp, type Played, type ShowPlanted } from './match.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 120;
const ASKS = [1, 2].map((player) => ({ player, step: 100 }));

function rows(planted?: ShowPlanted): Promise<Played> {
  const program = sightProgram();
  return play(builds.show(), temp(), { doc: DOC.rows, document: rowsDoc(program), program, steps: STEPS, views: ASKS, what: 'AC5 the rows\' piece', ...(planted ? { planted } : {}) });
}

describe(`${AC[5]} a row a seen column hides on this copy draws no hidden view`, () => {
  it(`${AC[5]} a row that a seen column hides on this copy draws no hidden view, where a row this copy's player sees shows through the wall`, async () => {
    requireMetal();
    const p = await rows();
    expect(p.blocked, 'the rows\' piece is presented and its match plays (README: The surface under test)').toEqual([]);
    expect(rowFailures(p.views, ASKS), 'each copy draws a hidden view of the rows its player sees, and none of a row its seen column hides').toEqual([]);
  }, TIMEOUT);

  it(`${AC[5]} a planted pass that ignores seen draws it and fails, naming the row`, async () => {
    requireMetal();
    const p = await rows('hidden_view_ignores_seen');
    expect(p.blocked, 'the planted program presents the piece and plays its match').toEqual([]);
    const failures = rowFailures(p.views, ASKS);
    expect(failures.length, 'the planted pass fails the judge of the copies\' views').toBeGreaterThan(0);
    for (const named of [/^copy 1 at step 100 draws a hidden view of row 1 \(enemies#1\.1\), which its seen column hides on this copy/, /^copy 2 at step 100 draws a hidden view of row 2 \(enemies#2\.1\), which its seen column hides on this copy/]) {
      expect(failures.some((f) => named.test(f)), `a failure names the copy and the row (${named.source}); the failures:\n  ${failures.join('\n  ')}`).toBe(true);
    }
  }, TIMEOUT);
});
