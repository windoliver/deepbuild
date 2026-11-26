// AC5 #1219.643d7509: "`hip_gable`, `overhang_gable`, `flush_gable` and `pyramid` on the same frame each pass every kind
// rule and the geometry audit at rest, with no rafter through a purlin and no tile through a ridge"
//
// Fixture (judges.ts `hallDoc`), shown by the working agent through deep_show, once per type: a whole hall on the
// seven-bay frame: `frame`; `brackets` (on: column) and `between` (on: between), two-step bracket sets that name it;
// and `roof`, an `arch.roof@1` of that type that names it, with raise 1/3, profile folded, corner_rise 0.3,
// corner_reach 3 and overhang 0.75. The brackets and the roof are the frame's children.
//
// asserts, for each of the four types, from one process (deep_show, geometry, verdict on a claim with two requirements,
// `{kind: kind_rules}` and `{kind: geometry.audit, scope: scene, states: [rest], support: {floating: [frame]}}`):
//   - the hall is presented, and its frame, both bracket sets and its roof each build a mesh;
//   - the kind_rules row is PASS and lists the five rules run where they apply, each holding: arch.column_on_grid on
//     the frame, arch.bracket_meets on each bracket set, and arch.purlin_folding, arch.eave_monotonic and
//     arch.rafter_clear (no rafter passes through a purlin) on the roof; no run fails and no rule's issue is raised;
//   - the geometry audit's row is PASS with nothing raised: nothing passes into anything (so no rafter through a purlin
//     and no tile through a ridge) and every part but the frame, which stands on the ground, is held;
//   - and, from a second process, the audit reads the roof at all: the same hall with `probe`, a 0.6 m box centred
//     where the roof's own `ridge_height` puts its ridge over the middle of the frame, FAILs with a geometry.overlap
//     naming the roof and the probe.
//
// Wrong programs this fails on: the merge base, whose roof knows none of the four types and whose geometry audit reads
// no building kind's true shape; a roof type that builds nothing or is refused; a rule that doesn't run on one of the
// four; a rafter built through a purlin or a tile through the ridge, which the rule or the audit's overlap pass
// raises; a roof or a bracket set held by nothing; an audit that passes because it never reads the roof.
import { describe, expect, it } from 'vitest';
import {
  BETWEEN, BRACKETS, FRAME, OTHER_TYPES, PROBE, RULE, RULES_CHECK, ROOF, auditCheck, auditOverlapFailures, auditPassFailures, builtOf, claimId, claimOf, columnsOf, docId,
  geometry, hallDoc, judgesFailTheirPlants, none, num, presented, reqId, rowOf, ruleFailures, run, scenarioOf, show, standsFailures, useBins, useFolders, verdict,
  type V3,
} from './helpers.ts';

/** The criterion's ID: `#1219.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC5 #1219.643d7509';
const bin = useBins(['deep-show']);
const folder = useFolders();
const DOC = docId(51);
const [RULES, AUDIT, PROBED] = [reqId(51), reqId(52), reqId(53)];
/** Every kind rule of the Scope, on the item it holds. */
const EVERY_RULE = [[FRAME, RULE.column], [BRACKETS, RULE.bracket], [BETWEEN, RULE.bracket], [ROOF, RULE.folding], [ROOF, RULE.eave], [ROOF, RULE.rafter]] as const;

describe(`${ID} the four other roof types on the same frame pass every kind rule and the geometry audit at rest`, () => {
  it(`${ID} hip_gable, overhang_gable, flush_gable and pyramid on the same frame each pass every kind rule and the geometry audit at rest, with no rafter through a purlin and no tile through a ridge`, () => {
    judgesFailTheirPlants();
    const failures: string[] = [];
    for (const type of OTHER_TYPES) {
      const what = `the hall under a ${type} roof`;
      const claims = { [claimId(51)]: claimOf(DOC, [[RULES, RULES_CHECK], [AUDIT, auditCheck([FRAME])]]) };
      const [shown, built, judged] = run(bin('deep-show'), scenarioOf(folder(), [DOC], claims, [show(DOC, hallDoc(type)), geometry(DOC, [FRAME, BRACKETS, BETWEEN, ROOF]), verdict(claimId(51))]));
      presented(shown!, what);
      const frame = builtOf(built!, FRAME, what);
      const columns = columnsOf(frame);
      none(standsFailures(frame, columns), `${what}: the frame builds where its column anchors stand`);
      for (const id of [BRACKETS, BETWEEN]) builtOf(built!, id, what);
      const ridge = num(builtOf(built!, ROOF, what).outputs['ridge_height'], `${what}: the roof's output ridge_height`);
      failures.push(...ruleFailures(rowOf(judged!, RULES), EVERY_RULE).map((f) => `${type}: ${f}`));
      failures.push(...auditPassFailures(rowOf(judged!, AUDIT)).map((f) => `${type}: ${f}`));

      // The audit reads the roof: a box in its ridge, over the middle of the frame, is an overlap it names.
      const mid = (v: number[]): number => (Math.min(...v) + Math.max(...v)) / 2;
      const at: V3 = [mid(columns.map((c) => c.center[0])), ridge, mid(columns.map((c) => c.center[1]))];
      const probed = { [claimId(52)]: claimOf(DOC, [[PROBED, auditCheck([FRAME, PROBE])]]) };
      const [shownProbed, judgedProbed] = run(bin('deep-show'), scenarioOf(folder(), [DOC], probed, [show(DOC, hallDoc(type, at)), verdict(claimId(52))]));
      presented(shownProbed!, `${what} with a box in its ridge`);
      failures.push(...auditOverlapFailures(rowOf(judgedProbed!, PROBED), ROOF, PROBE).map((f) => `${type}, with a box in its ridge at (${at.join(', ')}): ${f}`));
    }
    expect(OTHER_TYPES.length, 'the four types').toBe(4);
    none(failures, 'each of the four roof types passes every kind rule and the geometry audit at rest, and the audit reads its roof');
  });
});
