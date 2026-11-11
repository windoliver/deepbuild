// #724 acceptance, redrafted blind under #1405's rule (REDRAFT.md): `judgeInstructions(pairs, uncounted,
// seed)` on planted pairs, judged by two seeded one-sided sign-flip tests on the paired differences: FAIL
// when the change is above 2% at p under 0.01, PASS when "at least 2%" is rejected at p under 0.01,
// INCONCLUSIVE otherwise, with the seed and both p values in the result (tests/acceptance/1405/README.md).
import assert from 'node:assert/strict';
import test from 'node:test';
import { api } from '../724/helpers.mjs';

const SEED = 724;
// Twenty pairs whose differences (current / base - 1) run evenly from center - half to center + half.
// Bases differ per round, as real ones do.
const around = (center, half) => Array.from({ length: 20 }, (_, round) => {
  const base = 1_000_000_000 + round * 7919;
  return { current: Math.round(base * (1 + center + half * ((2 * round) / 19 - 1))), base };
});
const FLAT = around(0, 0.003); // unchanged, ±0.3%
const RISE_1_5 = around(0.015, 0.002); // a 1.5% rise, ±0.2%: under the 2% line
const RISE_3 = around(0.03, 0.002); // a 3% rise, ±0.2%: over the 2% line
const RISE_20 = around(0.2, 0.002); // the planted 20% rise

const judgedAs = async (pairs, status) => {
  const { judgeInstructions } = await api('judgeInstructions');
  const result = judgeInstructions(structuredClone(pairs), [], SEED);
  assert.equal(result?.status, status, JSON.stringify({ ...result, pairs: undefined }));
  assert.deepEqual(result.pairs, pairs, 'every pair is attached, in round order');
  assert.equal(result.seed, SEED, 'the seed is in the result');
  for (const field of ['pAbove', 'pBelow']) assert.ok(typeof result[field] === 'number' && result[field] >= 0 && result[field] <= 1, `${field} is in the result: ${result[field]}`);
  if (status !== 'PASS') assert.ok(typeof result.reason === 'string' && result.reason.trim(), `a ${status} says why`);
  return result;
};

test('a 20% rise in instructions retired fails the comparison, with every pair attached', async () => {
  const result = await judgedAs(RISE_20, 'FAIL');
  assert.ok(result.pAbove < 0.01, `"above 2%" at p under 0.01: ${result.pAbove}`);
});

test('an unchanged task passes, with the seed and both p values reported', async () => {
  const result = await judgedAs(FLAT, 'PASS');
  assert.ok(result.pBelow < 0.01, `"at least 2%" rejected at p under 0.01: ${result.pBelow}`);
});

test('a 1.5% rise passes: the line is never under 2%', async () => {
  const result = await judgedAs(RISE_1_5, 'PASS');
  assert.ok(result.pBelow < 0.01, `"at least 2%" rejected at p under 0.01: ${result.pBelow}`);
});

test('a 3% rise with a 0.4% spread fails: the line is 2%, no higher', async () => {
  const result = await judgedAs(RISE_3, 'FAIL');
  assert.ok(result.pAbove < 0.01, `"above 2%" at p under 0.01: ${result.pAbove}`);
});
