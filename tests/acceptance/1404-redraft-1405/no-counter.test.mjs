// #1404 acceptance, fourth criterion ("a host with no counter still reads INCONCLUSIVE, as it does
// today"), the judge test redrafted blind under #1405's rule (REDRAFT.md). A missing count reads
// INCONCLUSIVE, never PASS, as in tests/acceptance/1404/no-counter.test.mjs; complete pairs are judged by
// their counts on 20 pairs, since one or two pairs can't reach p under 0.01 in a sign-flip test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { benchmark } from '../1404/helpers.mjs';

test('judgeInstructions reads a missing count INCONCLUSIVE, never PASS, and complete pairs by their counts', async () => {
  const { judgeInstructions } = await benchmark('judgeInstructions');
  const whole = { current: 1_000_000, base: 1_000_000 };
  for (const pairs of [[], [{ current: null, base: null }], [whole, { current: null, base: 1_000_000 }, whole], [whole, { current: 1_000_000, base: null }]]) {
    const judged = judgeInstructions(pairs);
    assert.equal(judged.status, 'INCONCLUSIVE', `${JSON.stringify(pairs)} reads ${judged.status}`);
  }
  const twenty = (pair) => Array.from({ length: 20 }, () => ({ ...pair }));
  assert.equal(judgeInstructions(twenty(whole)).status, 'PASS');
  assert.equal(judgeInstructions(twenty({ current: 3_000_000, base: 1_000_000 })).status, 'FAIL');
});
