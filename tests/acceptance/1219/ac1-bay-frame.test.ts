// AC1 #1219.2fd5962d: "A bay frame with bays [4.2, 4.2, 4.2, 4.6, 4.2, 4.2, 4.2] m and depth bays [4, 4] m places 24
// columns, the front row's centers at x = 0, 4.2, 8.4, 12.6, 17.2, 21.4, 25.6 and 29.8 m within 1e-6 m; omitting [3, 0]
// removes that column only. A planted frame that spaces columns evenly fails, naming the column at 17.2 m."
//
// Fixtures (judges.ts `frameDoc`), shown by the working agent through deep_show: `frame`, an `arch.bay_frame@1` with the
// criterion's bays and depth bays (eave_height 3.6 m, columns 0.4 m across, purlins_per_bay 4), alone in its document;
// and the same frame with `omit: [[3, 0]]`.
//
// asserts, from one process (deep_show, geometry, verdict on a claim whose one requirement is `{kind: kind_rules}`):
//   - the frame's build answers a column anchor `column.<i>.<j>` for each of its 24 grid points and no other, each
//     within 1e-6 m of its grid point: across at the sum of the bays before it (the front row at the criterion's eight
//     x), front to back at the sum of the depth bays before it; and its mesh stands where they do;
//   - the kind rule arch.column_on_grid ran on the frame and holds;
//   - with omit, the same 23 columns stand and [3, 0] doesn't, and the rule still ran and holds;
//   - planted `bay_frame_even_columns` (every bay as wide as the first): the same judge fails, its first failure
//     naming column [4, 0], whose grid point is at x 17.2 m; and the kind rule fails on the frame, its issue naming
//     that column (`actual.column: [4, j]`, `actual.at: [17.2, …]`).
//
// Wrong programs this fails on (the last planted, the rest not): the merge base, which knows no arch.bay_frame; a frame
// that spaces its columns evenly, by its first bay or by its mean bay; a column 2e-6 m off; a back row off its depth
// line; a frame that ignores omit, or drops more than omit names; a frame that answers columns it doesn't build; a rule
// that never runs, or passes the planted frame.
import { describe, expect, it } from 'vitest';
import {
  FRAME, FRAME_SPEC, FRONT_X, GRID_TOL, OMIT, PLANTED, RULE, RULES_CHECK, builtOf, claimId, claimOf, columnFailures, columnsOf, docId, frameDoc, geometry,
  judgesFailTheirPlants, namesColumn, none, presented, reqId, rowOf, ruleBreakFailures, ruleFailures, ruleIssue, run, scenarioOf, show, standsFailures, stillShown,
  useBins, useFolders, verdict,
} from './helpers.ts';

/** The criterion's ID: `#1219.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC1 #1219.2fd5962d';
const bin = useBins(['deep-show']);
const folder = useFolders();
const [WHOLE, LESS] = [docId(11), docId(12)];
const claims = { [claimId(11)]: claimOf(WHOLE, [[reqId(11), RULES_CHECK]]), [claimId(12)]: claimOf(LESS, [[reqId(12), RULES_CHECK]]) };

describe(`${ID} a bay frame stands a column on each point of its grid`, () => {
  it(`${ID} the seven-bay frame places 24 columns, the front row's centers at x = 0, 4.2, 8.4, 12.6, 17.2, 21.4, 25.6 and 29.8 m within 1e-6 m, and omitting [3, 0] removes that column only`, () => {
    judgesFailTheirPlants();
    const calls = [show(WHOLE, frameDoc()), show(LESS, frameDoc([OMIT])), geometry(WHOLE, [FRAME]), geometry(LESS, [FRAME]), verdict(claimId(11)), verdict(claimId(12))];
    const [shownWhole, shownLess, builtWhole, builtLess, judgedWhole, judgedLess] = run(bin('deep-show'), scenarioOf(folder(), [WHOLE, LESS], claims, calls));
    presented(shownWhole!, 'the seven-bay frame');
    presented(shownLess!, 'the seven-bay frame with omit: [[3, 0]]');

    const whole = builtOf(builtWhole!, FRAME, 'the seven-bay frame');
    const columns = columnsOf(whole);
    none(standsFailures(whole, columns), 'the frame builds where its column anchors stand');
    expect(columns.length, 'the frame places 24 columns').toBe(24);
    const front = columns.filter((c) => c.at[1] === 0).sort((a, b) => a.at[0] - b.at[0]).map((c) => c.center[0]);
    expect(front.length === FRONT_X.length && front.every((x, i) => Math.abs(x - FRONT_X[i]!) <= GRID_TOL), `the front row's centers are at x = ${FRONT_X.join(', ')} m within 1e-6 m, got ${front.join(', ')}`).toBe(true);
    none(columnFailures(FRAME_SPEC, columns), 'every column stands on its grid point within 1e-6 m');
    none(ruleFailures(rowOf(judgedWhole!, reqId(11)), [[FRAME, RULE.column]]), 'the kind rule that columns sit on their grid points ran on the frame and holds');

    const less = builtOf(builtLess!, FRAME, 'the frame with omit');
    none(standsFailures(less, columnsOf(less)), 'the frame with omit builds where its column anchors stand');
    expect(columnsOf(less).length, 'omitting [3, 0] leaves 23 columns').toBe(23);
    none(columnFailures({ ...FRAME_SPEC, omit: [OMIT] }, columnsOf(less)), 'omitting [3, 0] removes that column only');
    none(ruleFailures(rowOf(judgedLess!, reqId(12)), [[FRAME, RULE.column]]), 'the kind rule ran on the frame with omit and holds');
  });

  it(`${ID} the planted frame that spaces its columns evenly fails, naming the column at 17.2 m`, () => {
    judgesFailTheirPlants();
    const calls = [show(WHOLE, frameDoc()), geometry(WHOLE, [FRAME]), verdict(claimId(11))];
    const [shown, built, judged] = run(bin('deep-show'), scenarioOf(folder(), [WHOLE], claims, calls, PLANTED.evenColumns));
    stillShown(shown!, `the seven-bay frame under ${PLANTED.evenColumns}`);
    const failures = columnFailures(FRAME_SPEC, columnsOf(builtOf(built!, FRAME, 'the planted frame')));
    expect(failures.length, `under ${PLANTED.evenColumns} the columns don't stand on their grid points`).toBeGreaterThan(0);
    expect(failures[0], 'the first column off its grid point, in grid order, is the column at 17.2 m').toContain('column [4, 0], whose grid point is at x 17.2 m');
    const row = rowOf(judged!, reqId(11));
    none(ruleBreakFailures(row, RULE.column, FRAME), `under ${PLANTED.evenColumns} the kind rule fails on the frame`);
    expect(namesColumn(ruleIssue(row, RULE.column, FRAME), 4, 17.2), `the rule's issue names the column at 17.2 m (actual.column [4, j], actual.at [17.2, …]): ${JSON.stringify(ruleIssue(row, RULE.column, FRAME)?.raw)}`).toBe(true);
  });
});
