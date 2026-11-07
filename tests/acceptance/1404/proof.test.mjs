// #1404's Proof: a planted bench whose child does 3 times the work, run through `measure`: PASS on main,
// FAIL with the fix. Both sides run `node wrap.mjs`, frozen, each in its own directory, as a budget and
// its merge-base copy do; only the child's work differs. This is the suite's one 21-round Node run.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { benchmark, buildSpin, counted, fileScope, macOnly, median, millions, plantBench, scratch, WRAPPER_COMMAND } from './helpers.mjs';

const ITERATIONS = 65_000_000;
const scope = fileScope();

test('a planted bench whose child does 3 times the work reads FAIL through measure', async (t) => {
  macOnly();
  const { judgeInstructions, measure } = await benchmark('judgeInstructions', 'measure');
  const box = scratch(scope);
  const spin = buildSpin(box);
  const merged = plantBench(join(box, 'base'), spin, ITERATIONS);
  const current = plantBench(join(box, 'current'), spin, 3 * ITERATIONS);
  const [now, then] = measure(WRAPPER_COMMAND, current, { command: WRAPPER_COMMAND, cwd: merged });
  assert.equal(now.instructions.length, 20, `20 measured rounds a side: ${JSON.stringify(now.instructions)}`);
  const judged = judgeInstructions(now.instructions.map((count, round) => ({ current: count, base: then.instructions[round] })));
  t.diagnostic(`current ${millions(median(now.instructions))}, merge base ${millions(median(then.instructions))}, change ${judged.change}`);
  assert.equal(judged.status, 'FAIL', `3 times the child's work reads ${judged.status}, change ${judged.change}, spread ${judged.spread}: current ${millions(median(now.instructions))}, merge base ${millions(median(then.instructions))}`);
  const child = counted([spin, String(3 * ITERATIONS)], box);
  for (const [round, count] of now.instructions.entries()) assert.ok(count >= 0.95 * child, `round ${round} read ${millions(count)}; the child alone retires ${millions(child)}`);
});
