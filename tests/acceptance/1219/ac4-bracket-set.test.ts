// AC4 #1219.a68fcbf4: "A two-step bracket set with 0.45 m reach and 0.3 m height a step reaches 0.90 m and rises 0.60 m;
// the eave purlin it carries sits 0.60 m above the column head within 1 mm, and with no `eave_reach` the eave projects
// 0.90 m plus the rafter overhang past the column line"
// and the Proof line's fourth planted wrong program, "a bracket that misses its purlin", which must fail.
//
// Fixture (judges.ts `bracketDoc`), shown by the working agent through deep_show: the seven-bay frame; `brackets`, its
// child, an `arch.bracket@1` that names it, on: column, steps 2, reach 0.45, height 0.3; and `roof`, its child, an
// `arch.roof@1` of type hip_ridge that names it, with overhang 0.75 (the rafter overhang) and no eave_reach.
//
// asserts, from one process (deep_show, geometry, verdict on a claim whose one requirement is `{kind: kind_rules}`):
//   - the bracket set builds a mesh and answers total_reach 0.90 m and total_height 0.60 m (steps × reach and height);
//   - the roof's eave purlin (its purlin 0 m in) sits 0.60 m above the front row's column heads (the frame's column
//     anchors), and the set's top, the highest point of its mesh, meets that purlin: all within 1 mm;
//   - the roof's eave line lies 0.90 + 0.75 = 1.65 m outside the columns' centers on each of its four sides, within 1 mm;
//   - the kind rule arch.bracket_meets ran on the bracket set and holds;
//   - planted `bracket_misses_purlin` (the set stacks one step fewer than it answers for): the same judge fails, the
//     set's top 0.30 m under the eave purlin it carries; and the kind rule fails on the bracket set, naming it.
//
// Wrong programs this fails on (the last planted, the rest not): the merge base, which knows no arch.bracket; totals of
// one step; a roof that leaves its eave purlin on the column heads; an eave that projects by the brackets' reach alone,
// by the overhang alone, or by one step's reach; a bracket set that reports a top it doesn't build to; a rule that
// never runs, or passes the planted set.
import { describe, expect, it } from 'vitest';
import {
  BRACKETS, EAVE_REACH, FRAME, PLANTED, RULE, RULES_CHECK, ROOF, TOTALS, bracketDoc, bracketFailures, bracketReadingOf, builtOf, claimId, claimOf, columnsOf, docId,
  eaveReachFailures, geometry, judgesFailTheirPlants, none, presented, reqId, roofOf, rowOf, ruleBreakFailures, ruleFailures, run, scenarioOf, show, stillShown, useBins,
  useFolders, verdict, type BracketReading, type Column, type JsonObject, type RoofOutputs,
} from './helpers.ts';

/** The criterion's ID: `#1219.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC4 #1219.a68fcbf4';
const bin = useBins(['deep-show']);
const folder = useFolders();
const DOC = docId(41);
const claims = { [claimId(41)]: claimOf(DOC, [[reqId(41), RULES_CHECK]]) };
const calls = [show(DOC, bracketDoc()), geometry(DOC, [FRAME, BRACKETS, ROOF]), verdict(claimId(41))];

/** What the criterion reads of one build: the bracket set against the column heads and the eave purlin, the columns and the roof's outputs. */
function read(built: JsonObject, what: string): { set: BracketReading; columns: Column[]; roof: RoofOutputs } {
  const columns = columnsOf(builtOf(built, FRAME, what));
  const roof = roofOf(builtOf(built, ROOF, what), what);
  return { set: bracketReadingOf(builtOf(built, BRACKETS, what), columns, roof, what), columns, roof };
}

describe(`${ID} a bracket set reaches and rises by its steps, and the roof reads both`, () => {
  it(`${ID} a two-step set of 0.45 m reach and 0.3 m height reaches 0.90 m and rises 0.60 m, the eave purlin it carries sits 0.60 m above the column head within 1 mm, and with no eave_reach the eave projects 0.90 m plus the rafter overhang past the column line`, () => {
    judgesFailTheirPlants();
    const [shown, built, judged] = run(bin('deep-show'), scenarioOf(folder(), [DOC], claims, calls));
    presented(shown!, 'the frame, its bracket set and the roof it carries');
    const { set, columns, roof } = read(built!, 'the bracket set under its roof');
    none(bracketFailures(set, TOTALS), 'the set reaches 0.90 m and rises 0.60 m, the eave purlin sits 0.60 m above the column head, and the set\'s top meets it, within 1 mm');
    none(eaveReachFailures(roof.eave, columns, EAVE_REACH), 'with no eave_reach the eave projects 0.90 m plus the 0.75 m rafter overhang past the column line');
    none(ruleFailures(rowOf(judged!, reqId(41)), [[BRACKETS, RULE.bracket]]), 'the kind rule that a bracket set\'s top meets what it carries ran on the set and holds');
  });

  it(`${ID} the planted bracket set that misses its purlin fails`, () => {
    judgesFailTheirPlants();
    const [shown, built, judged] = run(bin('deep-show'), scenarioOf(folder(), [DOC], claims, calls, PLANTED.bracketMisses));
    stillShown(shown!, `the bracket set under ${PLANTED.bracketMisses}`);
    const failures = bracketFailures(read(built!, 'the planted bracket set').set, TOTALS);
    expect(failures.some((f) => f.includes(`${BRACKETS}'s top is 0.3000 m under the eave purlin it carries`)), `under ${PLANTED.bracketMisses} the set's top is one step, 0.30 m, under the eave purlin it carries; the judge found: ${failures.join(' | ') || 'nothing'}`).toBe(true);
    none(ruleBreakFailures(rowOf(judged!, reqId(41)), RULE.bracket, BRACKETS), `under ${PLANTED.bracketMisses} the kind rule fails on the bracket set, naming it`);
  });
});
