// #23.65434b19 with a margin of 1.5 and 60 cases you decided with no breakage (your bound 4.87%, the limit 7.31%):
// the four rules the criterion names, each in a world of its own, judged on evidence made through the real path;
// and the judge held to exact one-sided bounds over generated counts.

import fc from 'fast-check';
import { expect, test } from 'vitest';
import { judge } from '../../../../packages/resolver-decisions/src/index.ts';
import { lower, upper } from './bounds.ts';
import { canWiden40, frozen39, frozenOneIn40, inRuleWorld, NO_BREAKAGE_39, NO_BREAKAGE_40, ONE_IN_40, revoked7In40, SEVEN_IN_40 } from './scenarios.ts';

const LONG = 300_000;

test('#23.65434b19 a rule with 40 cases and no breakage can widen: its upper bound 7.22% is at or below the limit 7.31%', async () => {
  await inRuleWorld(NO_BREAKAGE_40, canWiden40());
}, LONG);

test('#23.65434b19 a rule with 39 cases and no breakage (7.39%) can\'t decide, stays frozen and says 1 more case with no breakage would let it widen', async () => {
  await inRuleWorld(NO_BREAKAGE_39, frozen39());
}, LONG);

test('#23.65434b19 a rule with 1 breakage in 40 cases (0.13% to 11.32%) stays frozen and says 24 more cases with no breakage would let it widen', async () => {
  await inRuleWorld(ONE_IN_40, frozenOneIn40());
}, LONG);

test('#23.65434b19 a rule with 7 breakages in 40 cases (lower bound 8.51%) FAILs and is revoked', async () => {
  await inRuleWorld(SEVEN_IN_40, revoked7In40());
}, LONG);

// Generator: a rule's cases (1 to 150) and breakages (0 to 3), yours (1 to 200 cases, 0 to 3 breakages) and a
// margin. Holds, against the exact one-sided 95% bounds: your rate is taken at its upper bound (never 0), the limit
// is that times the margin, the verdict is FAIL when the rule's lower bound is above the limit, widen when its upper
// bound is at or below it, and undecided otherwise; an undecided rule says the fewest more cases with no breakage
// that would let it widen. Counts within 1e-6 of the limit are left out: there a float decides, not the rule.
const SEED = 0x23_65;
const EPS = 1e-6;
const counts = (most: number) => fc.integer({ min: 1, max: most }).chain((cases) => fc.record({ cases: fc.constant(cases), broke: fc.integer({ min: 0, max: Math.min(3, cases) }) }));

test('#23.65434b19 property: the judge agrees with exact one-sided 95% Clopper-Pearson bounds across generated counts and margins', () => {
  fc.assert(fc.property(counts(150), counts(200), fc.constantFrom(1, 1.25, 1.5, 2, 3), (rule, yours, margin) => {
    const yoursUpper = upper(yours.broke, yours.cases);
    const limit = yoursUpper * margin;
    const [lo, up] = [lower(rule.broke, rule.cases), upper(rule.broke, rule.cases)];
    fc.pre(Math.abs(lo - limit) > EPS && Math.abs(up - limit) > EPS);
    const named = `the rule with ${rule.broke} in ${rule.cases}, against your ${yours.broke} in ${yours.cases}, at a margin of ${margin}`;
    const j = judge(rule, yours, margin);
    expect(j.yours, `${named}: your rate, taken at its upper bound`).toBeCloseTo(yoursUpper, 7);
    expect(j.yours, `${named}: your bound is never 0`).toBeGreaterThan(0);
    expect(j.limit, `${named}: the limit, your bound times the margin`).toBeCloseTo(limit, 7);
    expect(j.rule.lower, `${named}: the rule's lower bound`).toBeCloseTo(lo, 7);
    expect(j.rule.upper, `${named}: the rule's upper bound`).toBeCloseTo(up, 7);
    const verdict = lo > limit ? 'FAIL' : up <= limit ? 'widen' : 'undecided';
    expect(j.verdict, `${named}: the verdict`).toBe(verdict);
    if (verdict !== 'undecided') {
      expect(j.more, `${named}: a rule that decides needs no more evidence`).toBeNull();
      return;
    }
    expect(Number.isInteger(j.more) && j.more! >= 1, `${named}: an undecided rule says how many more cases would let it widen (${j.more})`).toBe(true);
    expect(upper(rule.broke, rule.cases + j.more!), `${named}: ${j.more} more cases with no breakage let it widen`).toBeLessThanOrEqual(limit + EPS);
    expect(upper(rule.broke, rule.cases + j.more! - 1), `${named}: ${j.more! - 1} more cases wouldn't`).toBeGreaterThan(limit - EPS);
  }), { seed: SEED, numRuns: 300 });
}, LONG);
