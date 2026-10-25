// #724 acceptance: `judgeInstructions(pairs)` from scripts/benchmark.mjs, on planted pairs. These are
// the fast tests of the rule; the lane tests judge real counts of a real command on a loaded Mac.
import assert from 'node:assert/strict';
import test from 'node:test';
import { api, differences, median, near } from './helpers.mjs';

// Twenty pairs whose differences (current / base - 1) run evenly from center - half to center + half,
// so the median is the center and the spread is 2 x half. Bases differ per round, as real ones do.
const around = (center, half) => Array.from({ length: 20 }, (_, round) => {
  const base = 1_000_000_000 + round * 7919;
  return { current: Math.round(base * (1 + center + half * ((2 * round) / 19 - 1))), base };
});
const FLAT = around(0, 0.003); // unchanged: spread 0.6%, margin 2%
const RISE_1_5 = around(0.015, 0.002); // 1.5% rise, spread 0.4%: within the 2% floor
const RISE_3 = around(0.03, 0.002); // 3% rise, spread 0.4%: over the 2% floor
const RISE_20 = around(0.2, 0.002); // the planted 20% rise
const SPREAD_PASS = around(0.05, 0.05); // 5% rise, spread 10%: within the spread
const SPREAD_FAIL = around(0.13, 0.03); // 13% rise, spread 6%: over the spread

const judgedAs = async (pairs, status) => {
  const { judgeInstructions } = await api('judgeInstructions');
  const result = judgeInstructions(structuredClone(pairs));
  assert.equal(result?.status, status, JSON.stringify(result));
  assert.deepEqual(result.pairs, pairs, 'every pair is attached, in round order');
  if (status !== 'PASS') assert.ok(typeof result.reason === 'string' && result.reason.trim(), `a ${status} says why: ${JSON.stringify(result)}`);
  return result;
};
// change, spread and margin as reported, against what the pairs give.
const reports = (result, pairs) => {
  const d = differences(pairs);
  const spread = Math.max(...d) - Math.min(...d);
  near(result.change, median(d), 'change: the median of the pairs\' differences');
  near(result.spread, spread, 'spread: max minus min of the pairs\' differences');
  near(result.margin, Math.max(0.02, spread), 'margin: the larger of 2% and the spread');
};

test('a 20% rise in instructions retired fails the comparison, with every pair attached', async () => {
  reports(await judgedAs(RISE_20, 'FAIL'), RISE_20);
});

test('an unchanged task passes, with its margin and its pairs\' spread reported', async () => {
  const result = await judgedAs(FLAT, 'PASS');
  reports(result, FLAT);
  near(result.margin, 0.02, 'a 0.6% spread leaves the 2% floor');
});

test('a 1.5% rise passes: the margin is never under 2%', async () => {
  const result = await judgedAs(RISE_1_5, 'PASS');
  reports(result, RISE_1_5);
  near(result.margin, 0.02, 'a 0.4% spread leaves the 2% floor');
});

test('a 3% rise with a 0.4% spread fails: the margin is the larger of 2% and the spread, no wider', async () => {
  const result = await judgedAs(RISE_3, 'FAIL');
  reports(result, RISE_3);
  near(result.margin, 0.02, 'a 0.4% spread leaves the 2% floor');
});

test('the pairs\' spread widens the margin past 2%: a 5% rise within a 10% spread passes, a 13% rise over a 6% spread fails', async () => {
  const within = await judgedAs(SPREAD_PASS, 'PASS');
  reports(within, SPREAD_PASS);
  near(within.margin, 0.1, 'a 10% spread', 1e-6);
  const over = await judgedAs(SPREAD_FAIL, 'FAIL');
  reports(over, SPREAD_FAIL);
  near(over.margin, 0.06, 'a 6% spread', 1e-6);
});

test('a missing count is never zero: pairs with a count the host could not read are INCONCLUSIVE, with the count kept missing', async () => {
  const oneMissing = FLAT.map((pair, round) => (round === 7 ? { ...pair, base: null } : pair));
  const noneRead = FLAT.map(() => ({ current: null, base: null }));
  for (const pairs of [oneMissing, noneRead]) {
    const result = await judgedAs(pairs, 'INCONCLUSIVE');
    assert.equal(result.change, null, `no change is computed from a missing count: ${JSON.stringify(result)}`);
    assert.match(result.reason, /instructions|counter|missing/i);
  }
});

test('a count of 0, or no pairs at all, is not a reading: INCONCLUSIVE, never PASS', async () => {
  await judgedAs(FLAT.map(() => ({ current: 0, base: 0 })), 'INCONCLUSIVE');
  await judgedAs(FLAT.map((pair, round) => (round === 3 ? { ...pair, current: 0 } : pair)), 'INCONCLUSIVE');
  await judgedAs([], 'INCONCLUSIVE');
});
