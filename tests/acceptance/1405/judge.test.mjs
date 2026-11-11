// #1405 acceptance: `judgeInstructions(pairs, uncounted, seed)` from scripts/benchmark.mjs on the issue's
// fixture pairs, the first five criteria. Each pair's difference is current / base - 1.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASES, SEED, THRESHOLD, benchmark, judged, pValues, pairsAt, shown } from './helpers.mjs';

const OUTLIER_ROUND = 7;
const twenty = (rise) => Array(20).fill(rise);
// 19 pairs at +15% and one at -5%: a spread of 20%, which today's margin takes in whole.
const RISE_WITH_FALL = pairsAt(twenty(0.15).map((rise, round) => (round === OUTLIER_ROUND ? -0.05 : rise)));
// 20 pairs within ±0.5%, evenly from -0.5% to +0.5%.
const FLAT = pairsAt(Array.from({ length: 20 }, (_, round) => -0.005 + (0.01 * round) / 19));
// 19 pairs at +0.1% and one at +30%.
const ONE_SPIKE = pairsAt(twenty(0.001).map((rise, round) => (round === OUTLIER_ROUND ? 0.3 : rise)));
// 20 pairs at +2%: each within one instruction of 2% over its base, alternately above and below
// (README: Readings, 3).
const AT_TWO = BASES.map((base, round) => ({ current: (base / 50) * 51 + (round % 2 ? 1 : -1), base }));

test('19 pairs at +15% and 1 at -5% read FAIL', async () => {
  const result = await judged(RISE_WITH_FALL);
  assert.equal(result?.status, 'FAIL', `one outlier pair widens no margin: ${shown(result)}`);
  assert.ok(pValues(result).pAbove < THRESHOLD, `FAIL is "above 2%" at p under 0.01: ${shown(result)}`);
});

test('20 pairs within ±0.5% read PASS', async () => {
  const result = await judged(FLAT);
  assert.equal(result?.status, 'PASS', shown(result));
});

test('19 pairs at +0.1% and 1 at +30% don\'t read FAIL', async () => {
  const result = await judged(ONE_SPIKE);
  assert.notEqual(result?.status, 'FAIL', shown(result));
  assert.ok(['PASS', 'INCONCLUSIVE'].includes(result?.status), shown(result));
});

test('20 pairs at +2% read INCONCLUSIVE', async () => {
  const result = await judged(AT_TWO);
  assert.equal(result?.status, 'INCONCLUSIVE', `a change at the 2% line can't be told either way: ${shown(result)}`);
  const { pAbove, pBelow } = pValues(result);
  assert.ok(pAbove >= THRESHOLD && pBelow >= THRESHOLD, `neither test rejects at p under 0.01: ${shown(result)}`);
});

test('the same pairs and seed give the same result and p values twice', async () => {
  const { judgeInstructions } = await benchmark('judgeInstructions');
  for (const pairs of [AT_TWO, ONE_SPIKE]) {
    const first = judgeInstructions(structuredClone(pairs), [], SEED);
    const second = judgeInstructions(structuredClone(pairs), [], SEED);
    assert.equal(first?.seed, SEED, `the seed is in the result: ${shown(first)}`);
    pValues(first);
    assert.deepEqual(second, first, 'the same pairs and seed, judged twice');
    // With no seed given, the one it used is in the result, and judging again with it gives the same.
    const unseeded = judgeInstructions(structuredClone(pairs), []);
    assert.ok(unseeded?.seed !== undefined && unseeded.seed !== null, `the seed it chose is in the result: ${shown(unseeded)}`);
    pValues(unseeded);
    assert.deepEqual(judgeInstructions(structuredClone(pairs), [], unseeded.seed), unseeded, 'judged again with the seed it reported');
  }
});
