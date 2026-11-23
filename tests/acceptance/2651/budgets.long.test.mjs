// #2651 AC5 (#2651.59066289): "`deep-hook-overhead`, `deep-hook-guards`, `hub-round-trip` and `extension-host` in
// `benchmarks/budgets.json` retire no more instructions than on the merge base"
//   DEEP_2651_BASE=<built merge base> node --test tests/acceptance/2651/budgets.long.test.mjs     # by hand: an hour or more, macOS
// Each task's command, as each checkout's budgets.json names it, runs in that checkout the way the perf lane runs a
// budget (scripts/benchmark.mjs `measure` and `judgeInstructions`, the judge's own code, not the code under test): one
// warm-up round, then 20 rounds alternating which side goes first, instructions retired counted for the command and
// every child it waits for, and the pairs judged by the design's two seeded sign-flip tests. Only PASS passes: a rise
// above 2% at p under 0.01 FAILs, and a missing counter, an uncounted child or pairs that can't tell are INCONCLUSIVE.
// Both checkouts need the release deep-hook (the deep-hook tasks build it) and hyperfine 1.x (deep-hook-overhead).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { AC, BASE, CHANGE, machine, perfJudge, sidesProblem } from './lib.mjs';

async function task(id) {
  const blocked = sidesProblem();
  if (blocked) assert.fail(blocked);
  const named = (checkout) => JSON.parse(readFileSync(join(checkout, 'benchmarks/budgets.json'), 'utf8')).tasks.find((entry) => entry.id === id);
  const now = named(CHANGE), then = named(BASE);
  assert.ok(now, `benchmarks/budgets.json has no task ${id}`);
  if (!then) assert.fail(`BLOCKED: the merge base's benchmarks/budgets.json has no task ${id}`);
  const { measure, judgeInstructions } = await perfJudge();
  let current, base;
  try {
    [current, base] = measure(now.command, CHANGE, { command: then.command, cwd: BASE });
  } catch (error) {
    assert.fail(`BLOCKED: ${id} could not be measured on both sides: ${String(error.message).slice(0, 1500)}`);
  }
  const verdict = judgeInstructions(current.instructions.map((count, round) => ({ current: count, base: base.instructions[round] })), [...new Set([...current.uncounted, ...base.uncounted])]);
  console.log(`AC5 ${id}: ${verdict.status}${verdict.reason ? `: ${verdict.reason}` : ''} (${machine()})`);
  assert.equal(verdict.status, 'PASS', `${verdict.status}: ${id}: ${verdict.reason ?? ''}\n${JSON.stringify({ change: verdict.change, seed: verdict.seed, pAbove: verdict.pAbove, pBelow: verdict.pBelow, pairs: verdict.pairs })}`);
}

describe(`${AC[5]} the four budget tasks retire no more instructions than on the merge base`, { timeout: 14_400_000 }, () => {
  for (const id of ['deep-hook-overhead', 'deep-hook-guards', 'hub-round-trip', 'extension-host']) {
    it(`${AC[5]} ${id} retires no more instructions than on the merge base`, { timeout: 7_200_000 }, () => task(id));
  }
});
