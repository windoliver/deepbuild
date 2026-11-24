// AC3 #1219.ccd3f457: "With `corner_rise: 0.3 m` and `corner_reach: 3 m` the eave line is level more than 3 m from a
// corner and rises to 0.30 m at the corner within 1e-4 m, monotonically at 50 samples. A planted rise that falls back
// before the corner fails, naming the sample."
//
// Fixture (judges.ts `roofDoc`), shown by the working agent through deep_show: the seven-bay frame and `roof`, its
// child, an `arch.roof@1` of type hip_ridge that names it, with raise 1/3, profile folded, corner_rise 0.3,
// corner_reach 3 and overhang 0.75; no bracket set. Its eaves are 31.3 m and 9.5 m long, so each has a level stretch.
//
// asserts, from one process (deep_show, geometry, verdict on a claim whose one requirement is `{kind: kind_rules}`):
//   - the roof answers `eave_line`, the points around its eave edge; read eave by eave toward each of its eight corner
//     ends (judges.ts `eaveApproaches`), the line is at its level height everywhere more than 3 m from the corner, is
//     0.30 m above it at the corner, both within 1e-4 m, and never falls from one of the reach's 50 samples to the next;
//   - the kind rule arch.eave_monotonic ran on the roof and holds;
//   - planted `eave_rise_falls_back` (the rise as shipped for four fifths of the reach, then straight back to level at
//     the corner): the same judge fails toward every corner, naming the first sample lower than the one before it, a
//     sample of the last fifth; and the kind rule fails on the roof, its issue naming that sample (`actual.sample`).
//
// Wrong programs this fails on (the last planted, the rest not): the merge base, whose roof knows no corner_rise; a
// level eave line; a rise of another height, or over another reach; a rise that overshoots and falls back; an eave line
// that leaves an eave or a corner out; a rule that never runs, or passes the planted rise.
import { describe, expect, it } from 'vitest';
import {
  CORNER_REACH, CORNER_RISE, FRAME, PLANTED, RULE, RULES_CHECK, ROOF, builtOf, claimId, claimOf, docId, eaveFailures, fallingSamples, geometry, judgesFailTheirPlants,
  none, presented, reqId, roofDoc, roofOf, rowOf, ruleBreakFailures, ruleFailures, ruleIssue, run, sampleNamed, scenarioOf, show, stillShown, useBins, useFolders, verdict,
} from './helpers.ts';

/** The criterion's ID: `#1219.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC3 #1219.ccd3f457';
const bin = useBins(['deep-show']);
const folder = useFolders();
const DOC = docId(31);
const claims = { [claimId(31)]: claimOf(DOC, [[reqId(31), RULES_CHECK]]) };
const calls = [show(DOC, roofDoc()), geometry(DOC, [FRAME, ROOF]), verdict(claimId(31))];

describe(`${ID} the eave line rises toward each corner`, () => {
  it(`${ID} with corner_rise 0.3 m and corner_reach 3 m the eave line is level more than 3 m from a corner and rises to 0.30 m at the corner within 1e-4 m, monotonically at 50 samples`, () => {
    judgesFailTheirPlants();
    const [shown, built, judged] = run(bin('deep-show'), scenarioOf(folder(), [DOC], claims, calls));
    presented(shown!, 'the frame and its roof with rising corners');
    const roof = roofOf(builtOf(built!, ROOF, 'the roof with rising corners'), 'the roof with rising corners');
    none(eaveFailures(roof.eave, CORNER_RISE, CORNER_REACH), 'toward each corner the eave line is level beyond 3 m, 0.30 m up at the corner, and never falls between samples');
    none(ruleFailures(rowOf(judged!, reqId(31)), [[ROOF, RULE.eave]]), 'the kind rule that the eave line\'s rise is monotonic toward each corner ran on the roof and holds');
  });

  it(`${ID} the planted rise that falls back before the corner fails, naming the sample`, () => {
    judgesFailTheirPlants();
    const [shown, built, judged] = run(bin('deep-show'), scenarioOf(folder(), [DOC], claims, calls, PLANTED.riseFallsBack));
    stillShown(shown!, `the roof under ${PLANTED.riseFallsBack}`);
    const eave = roofOf(builtOf(built!, ROOF, 'the planted roof'), 'the planted roof').eave;
    const falls = fallingSamples(eave, CORNER_REACH);
    expect(falls.length, `under ${PLANTED.riseFallsBack} the eave line's rise falls back toward a corner`).toBeGreaterThan(0);
    const sample = falls[0]!;
    expect(falls.every((k) => k === sample) && sample >= 40, `toward every corner it first falls at one sample of the reach's last fifth, got ${falls.join(', ')}`).toBe(true);
    expect(eaveFailures(eave, CORNER_RISE, CORNER_REACH).some((f) => f.includes(`sample ${sample} of 50`) && f.includes('the rise falls back')), 'the judge\'s failure names the sample').toBe(true);
    const row = rowOf(judged!, reqId(31));
    none(ruleBreakFailures(row, RULE.eave, ROOF), `under ${PLANTED.riseFallsBack} the kind rule fails on the roof`);
    expect(sampleNamed(ruleIssue(row, RULE.eave, ROOF)), `the rule's issue names the sample (actual.sample): ${JSON.stringify(ruleIssue(row, RULE.eave, ROOF)?.raw)}`).toBe(sample);
  });
});
