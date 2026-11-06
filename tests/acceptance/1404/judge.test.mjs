// #1404 acceptance, second criterion: a budget whose child retires 3 times its merge base's, with the
// same Node wrapper, reads FAIL from `judgeInstructions`. Three alternated rounds of `measureOnce` on
// the real counter; the issue's Proof, on `measure`'s 20 rounds, is proof.test.mjs. A child that didn't
// change reads PASS from the same rounds, so a comparison that fails everything doesn't get through.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { benchmark, buildSpin, fileScope, macOnly, plantBench, scratch, WRAPPER_COMMAND } from './helpers.mjs';

const ITERATIONS = 65_000_000;
const scope = fileScope();

test('a child with 3 times the merge base\'s work reads FAIL behind the same wrapper, and an unchanged one reads PASS', async () => {
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
  const rounds = Array.from({ length: 3 }, () => ({ base: count(merged), same: count(same), tripled: count(tripled) }));
  const heavier = judgeInstructions(rounds.map(({ base, tripled: current }) => ({ current, base })));
  assert.equal(heavier.status, 'FAIL', `3 times the child's work reads ${heavier.status}: ${JSON.stringify(heavier)}`);
  const unchanged = judgeInstructions(rounds.map(({ base, same: current }) => ({ current, base })));
  assert.equal(unchanged.status, 'PASS', `the same child reads ${unchanged.status}: ${JSON.stringify(unchanged)}`);
});
