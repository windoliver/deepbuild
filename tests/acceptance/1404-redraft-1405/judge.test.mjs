// #1404 acceptance, second criterion, redrafted blind under #1405's rule (REDRAFT.md): a budget whose child
// retires 3 times its merge base's, with the same Node wrapper, reads FAIL from `judgeInstructions`, and an
// unchanged child in the same rounds reads PASS. As tests/acceptance/1404/judge.test.mjs, but on ten
// alternated rounds of `measureOnce` instead of three: a one-sided sign-flip test on n pairs can't go
// below p = 1/2^n, so three pairs (1/8) can never read FAIL or PASS at p under 0.01; ten can (1/1024).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { benchmark, buildSpin, fileScope, macOnly, plantBench, scratch, WRAPPER_COMMAND } from '../1404/helpers.mjs';

const ITERATIONS = 65_000_000;
const ROUNDS = 10;
const scope = fileScope();

test('a child with 3 times the merge base\'s work reads FAIL behind the same wrapper, and an unchanged one reads PASS', { timeout: 1_800_000 }, async () => {
  macOnly();
  const { judgeInstructions, measureOnce } = await benchmark('judgeInstructions', 'measureOnce');
  const box = scratch(scope);
  const spin = buildSpin(box);
  const merged = plantBench(join(box, 'base'), spin, ITERATIONS);
  const same = plantBench(join(box, 'same'), spin, ITERATIONS);
  const tripled = plantBench(join(box, 'tripled'), spin, 3 * ITERATIONS);
  const count = (cwd) => {
    const run = measureOnce(WRAPPER_COMMAND, cwd);
    assert.equal(run.status, 0, run.output);
    return run.instructions;
  };
  const rounds = Array.from({ length: ROUNDS }, () => ({ base: count(merged), same: count(same), tripled: count(tripled) }));
  const heavier = judgeInstructions(rounds.map(({ base, tripled: current }) => ({ current, base })));
  assert.equal(heavier.status, 'FAIL', `3 times the child's work reads ${heavier.status}: ${JSON.stringify(heavier)}`);
  const unchanged = judgeInstructions(rounds.map(({ base, same: current }) => ({ current, base })));
  assert.equal(unchanged.status, 'PASS', `the same child reads ${unchanged.status}: ${JSON.stringify(unchanged)}`);
});
