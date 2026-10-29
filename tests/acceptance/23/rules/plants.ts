// The wrong programs the criteria name, planted around the real program: three wrong judges, each the real judging
// rule with one part wrong, built on the test's exact bounds (bounds.ts) and handed to the round in place of
// resolver-decisions' `judge`, as the hub would call it; and a resolver that stops deciding from a frozen rule.
// plants.test.ts runs each criterion's scenario against them.

import type { Judgment, Tally } from '../../../../packages/asks/src/index.ts';
import { lower, upper } from './bounds.ts';
import { stateOf, type Judge, type Planting, type World } from './helpers.ts';
import type { Resolver } from '../../../../packages/asks/src/index.ts';

/** The fewest more cases with no breakage whose upper bound is at or below the limit; null past a million. */
function moreUntil(rule: Tally, limit: number, up: (x: number, n: number) => number): number | null {
  for (let k = 1; k <= 1_000_000; k++) if (up(rule.broke, rule.cases + k) <= limit) return k;
  return null;
}
function verdictOf(rule: Tally, lo: number, up: number, limit: number, bound: (x: number, n: number) => number): Judgment {
  const verdict = lo > limit ? 'FAIL' : up <= limit ? 'widen' : 'undecided';
  return { verdict, rule: { lower: lo, upper: up }, yours: Number.NaN, limit, more: verdict === 'undecided' ? moreUntil(rule, limit, bound) : null };
}
const rate = (t: Tally): number => (t.cases > 0 ? t.broke / t.cases : 0);

/** #23.65434b19: a judge that takes your rate as the rate it observed, 0 for no breakage, so the limit is 0. */
export const zeroRate: Judge = (rule, yours, margin) => {
  const limit = rate(yours) * margin;
  // With a limit of 0 no number of cases lets a rule widen: its undecided says nothing more would.
  const j = verdictOf(rule, lower(rule.broke, rule.cases), upper(rule.broke, rule.cases), limit, (x, n) => (limit > 0 ? upper(x, n) : Number.POSITIVE_INFINITY));
  return { ...j, yours: rate(yours) };
};

/** #23.65434b19: a judge that compares point rates: the rule's observed rate against yours times the margin. */
export const pointRates: Judge = (rule, yours, margin) => {
  const limit = rate(yours) * margin;
  const r = rate(rule);
  const verdict = r > limit ? 'FAIL' : 'widen';
  return { verdict, rule: { lower: r, upper: r }, yours: rate(yours), limit, more: null };
};

/** #23.65434b19: a judge with two-sided 95% bounds, 2.5% in each tail, for your rate and the rule's. */
export const twoSided: Judge = (rule, yours, margin) => {
  const up = (x: number, n: number): number => upper(x, n, 0.025);
  const limit = up(yours.broke, yours.cases) * margin;
  const j = verdictOf(rule, lower(rule.broke, rule.cases, 0.025), up(rule.broke, rule.cases), limit, up);
  return { ...j, yours: up(yours.broke, yours.cases) };
};

/** #23.b2a26445: a resolver that stops deciding from a frozen rule, as if frozen were revoked. */
export const frozenStopsDeciding: Planting = {
  resolver: (real: Resolver, world: World): Resolver => async (ask) => {
    const answer = await real(ask);
    if (answer?.because && (await stateOf(world, answer.because)) === 'frozen') return undefined;
    return answer;
  },
};
