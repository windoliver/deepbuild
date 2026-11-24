// AC2 #1219.cd3d7125: "A `hip_ridge` roof on an 8 m deep frame with `raise: 1/3`, `profile: folded` and four purlins a
// side has its ridge 2.6667 m above the eave purlin, and the purlins at 1, 2 and 3 m in from the eave at 0.4444, 1.0222
// and 1.7333 m, within 1e-4 m, read from the outputs. A planted straight roof fails the folding rule, naming the purlin
// 3 m in and its 0.2667 m difference."
//
// Fixture (judges.ts `roofDoc`), shown by the working agent through deep_show: the seven-bay frame (8 m deep, two 4 m
// depth bays, purlins_per_bay 4, so a 1 m purlin spacing) and `roof`, its child, an `arch.roof@1` of type hip_ridge
// that names it, with raise 1/3, profile folded, corner_rise 0.3, corner_reach 3 and overhang 0.75; no bracket set.
//
// asserts, from one process (deep_show, geometry, verdict on a claim whose one requirement is `{kind: kind_rules}`):
//   - the roof builds a mesh and answers `ridge_height` and `purlins` (four a side, 0, 1, 2 and 3 m in);
//   - above the purlin 0 m in (the eave purlin), the ridge is raise × depth = 2.6667 m up and the purlins 1, 2 and 3 m
//     in are at the folding rule's closed form (judges.ts `foldedProfile`: 0.4444, 1.0222 and 1.7333 m), within 1e-4 m;
//   - the kind rule arch.purlin_folding ran on the roof and holds;
//   - planted `roof_straight_as_folded` (a folded roof built on the straight line): the same judge fails, its first
//     failure the purlin 3 m in, 0.2667 m off; and the kind rule fails on the roof, its issue naming that purlin and
//     that difference (`actual.in: 3`, `actual.difference: ±0.2667` within 1e-4 m).
//
// Wrong programs this fails on (the last planted, the rest not): the merge base, whose roof knows no hip_ridge, frame,
// raise or profile; a straight roof; a roof that lowers every purlin by the same tenth, or halves nothing; a ridge at
// another height than raise × depth; three purlins a side; a rule that never runs, or passes the straight roof.
import { describe, expect, it } from 'vitest';
import {
  FOLDED, FRAME, PLANTED, RULE, RULES_CHECK, ROOF, builtOf, claimId, claimOf, docId, geometry, judgesFailTheirPlants, namesPurlin, none, presented, profileFailures, reqId,
  roofDoc, roofOf, rowOf, ruleBreakFailures, ruleFailures, ruleIssue, run, scenarioOf, show, stillShown, useBins, useFolders, verdict,
} from './helpers.ts';

/** The criterion's ID: `#1219.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC2 #1219.cd3d7125';
const bin = useBins(['deep-show']);
const folder = useFolders();
const DOC = docId(21);
const claims = { [claimId(21)]: claimOf(DOC, [[reqId(21), RULES_CHECK]]) };
const calls = [show(DOC, roofDoc()), geometry(DOC, [FRAME, ROOF]), verdict(claimId(21))];

describe(`${ID} a folded hip-and-ridge roof's ridge and purlins stand where the folding rule puts them`, () => {
  it(`${ID} on the 8 m deep frame with raise 1/3 and four purlins a side, the ridge is 2.6667 m above the eave purlin and the purlins 1, 2 and 3 m in are at 0.4444, 1.0222 and 1.7333 m, within 1e-4 m, read from the outputs`, () => {
    judgesFailTheirPlants();
    const [shown, built, judged] = run(bin('deep-show'), scenarioOf(folder(), [DOC], claims, calls));
    presented(shown!, 'the frame and its folded hip_ridge roof');
    const roof = roofOf(builtOf(built!, ROOF, 'the folded roof'), 'the folded roof');
    expect(roof.purlins.length, 'the roof answers four purlins a side').toBe(4);
    none(profileFailures(FOLDED, roof), 'the ridge and each purlin stand at the folding rule\'s height above the eave purlin, within 1e-4 m');
    none(ruleFailures(rowOf(judged!, reqId(21)), [[ROOF, RULE.folding]]), 'the kind rule that each purlin\'s height equals the folding rule\'s closed form ran on the roof and holds');
  });

  it(`${ID} the planted straight roof fails the folding rule, naming the purlin 3 m in and its 0.2667 m difference`, () => {
    judgesFailTheirPlants();
    const [shown, built, judged] = run(bin('deep-show'), scenarioOf(folder(), [DOC], claims, calls, PLANTED.straightAsFolded));
    stillShown(shown!, `the folded roof under ${PLANTED.straightAsFolded}`);
    const failures = profileFailures(FOLDED, roofOf(builtOf(built!, ROOF, 'the planted roof'), 'the planted roof'));
    expect(failures.length, `under ${PLANTED.straightAsFolded} the purlins don't stand at the folding rule's heights`).toBeGreaterThan(0);
    expect(failures[0], 'the first purlin off the rule, from the ridge down, is the one 3 m in').toContain('the purlin 3 m in from the eave');
    expect(failures[0], 'and it is 0.2667 m off').toContain('0.2667 m off the folding rule\'s 1.7333 m');
    const row = rowOf(judged!, reqId(21));
    none(ruleBreakFailures(row, RULE.folding, ROOF), `under ${PLANTED.straightAsFolded} the folding rule fails on the roof`);
    expect(namesPurlin(ruleIssue(row, RULE.folding, ROOF), 3, FOLDED.ridge / 10), `the rule's issue names the purlin 3 m in and its 0.2667 m difference (actual.in 3, actual.difference ±0.2667): ${JSON.stringify(ruleIssue(row, RULE.folding, ROOF)?.raw)}`).toBe(true);
  });
});
