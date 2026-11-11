// #724 acceptance: `judgeInstructions(pairs)` from scripts/benchmark.mjs, on planted pairs. These are
// the fast tests of the rule; the lane tests judge real counts of a real command on a loaded Mac. The tests of
// the margin #1405 replaced run from tests/acceptance/724-redraft-1405/.
import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from './helpers.mjs';

// Twenty pairs whose differences (current / base - 1) run evenly from center - half to center + half,
// so the median is the center and the spread is 2 x half. Bases differ per round, as real ones do.
const around = (center, half) => Array.from({ length: 20 }, (_, round) => {
  const base = 1_000_000_000 + round * 7919;
  return { current: Math.round(base * (1 + center + half * ((2 * round) / 19 - 1))), base };
});
const FLAT = around(0, 0.003); // unchanged: spread 0.6%, margin 2%

const judgedAs = async (pairs, status) => {
  const { judgeInstructions } = await api('judgeInstructions');
  const result = judgeInstructions(structuredClone(pairs));
  assert.equal(result?.status, status, JSON.stringify(result));
  assert.deepEqual(result.pairs, pairs, 'every pair is attached, in round order');
  if (status !== 'PASS') assert.ok(typeof result.reason === 'string' && result.reason.trim(), `a ${status} says why: ${JSON.stringify(result)}`);
  return result;
};
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
