// #2646.0e7e5ac3: hub-history, hub-idle, asks-inbox-10k and deep-status-30 in benchmarks/budgets.json retire no more
// instructions than on the merge base.
//   DEEP_2646_BASE=<built merge base> node --test tests/acceptance/2646/budgets.long.test.mjs      # by hand: about half an hour
// Each task's command, as each checkout's budgets.json names it, runs in that checkout the way the perf lane runs a
// budget (scripts/benchmark.mjs, the judge's own code, not the code under test): one warm-up round, then 20 rounds that
// alternate which side goes first, instructions retired counted for the command and every child it waits for, and the
// pairs judged by the design's two seeded sign-flip tests. Only PASS passes: a FAIL is a rise above 2% at p under 0.01,
// and a missing counter, an uncounted child or pairs that can't tell read INCONCLUSIVE.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { BASE, CHANGE, sidesProblem } from './lib.mjs';

async function task(id) {
  const blocked = sidesProblem();
  if (blocked) assert.fail(blocked);
  const named = (checkout) => JSON.parse(readFileSync(join(checkout, 'benchmarks/budgets.json'), 'utf8')).tasks.find((entry) => entry.id === id);
  const now = named(CHANGE), then = named(BASE);
  assert.ok(now, `benchmarks/budgets.json has no task ${id}`);
  if (!then) assert.fail(`BLOCKED: the merge base's benchmarks/budgets.json has no task ${id}`);
  const { measure, judgeInstructions } = await import(pathToFileURL(join(CHANGE, 'scripts/benchmark.mjs')).href);
  let current, base;
  try {
    [current, base] = measure(now.command, CHANGE, { command: then.command, cwd: BASE });
  } catch (error) {
    assert.fail(`BLOCKED: ${id} could not be measured on both sides: ${String(error.message).slice(0, 1500)}`);
  }
  const verdict = judgeInstructions(current.instructions.map((count, round) => ({ current: count, base: base.instructions[round] })), [...new Set([...current.uncounted, ...base.uncounted])]);
  assert.equal(verdict.status, 'PASS', `${verdict.status}: ${id}: ${verdict.reason ?? ''}\n${JSON.stringify({ change: verdict.change, seed: verdict.seed, pAbove: verdict.pAbove, pBelow: verdict.pBelow, pairs: verdict.pairs })}`);
}

describe('#2646 the four budget tasks against the merge base', { timeout: 7_200_000 }, () => {
  it('#2646.0e7e5ac3 hub-history retires no more instructions than on the merge base', () => task('hub-history'));
  it('#2646.0e7e5ac3 hub-idle retires no more instructions than on the merge base', () => task('hub-idle'));
  it('#2646.0e7e5ac3 asks-inbox-10k retires no more instructions than on the merge base', () => task('asks-inbox-10k'));
  it('#2646.0e7e5ac3 deep-status-30 retires no more instructions than on the merge base', () => task('deep-status-30'));
});
