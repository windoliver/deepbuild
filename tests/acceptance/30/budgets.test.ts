// AC12: budgets on the reference Mac in the local preflight, compared with the merge base: counting tests run adds
// under 1% to the check's time. The merge-base comparison is the perf lane's (scripts/benchmark.mjs,
// benchmarks/budgets.json), as #236's sandbox budget is: a task for the command check, a #30 first measurement,
// valid against the merge base's budgets. Its bench prints the median time of a command check run that counts its
// tests and of the same run with counting left out; the issue's 1% is judged here by the design's timing rule on
// five bench runs, on a reference Mac in a fit state only. Anywhere else the test fails BLOCKED, never passes.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { environmentProblem, judgeTiming, NODE, REPO } from './helpers.ts';

const TASK = 'command-check-count';
const BENCH = ['node', 'benchmarks/command-check.mjs'];
type Task = { id: string; command: string[]; initialReason: string };

/** One run of the bench: its JSON line, with the two medians. */
function bench(): { checkMs: number; plainMs: number } {
  const out = execFileSync(NODE, [join(REPO, BENCH[1]!)], { cwd: REPO, encoding: 'utf8', timeout: 600_000 }).trim().split('\n').pop()!;
  const line = JSON.parse(out) as { checkMs: unknown; plainMs: unknown };
  if (typeof line.checkMs !== 'number' || typeof line.plainMs !== 'number' || line.plainMs <= 0) throw Error(`the bench printed ${out}, not {checkMs, plainMs}`);
  return { checkMs: line.checkMs, plainMs: line.plainMs };
}

describe('AC12 #30.542330be counting tests run adds under 1% to the check\'s time, on the reference Mac, compared with the merge base', () => {
  it(`AC12 the perf lane has a ${TASK} task running ${BENCH.join(' ')}, a #30 first measurement, valid against the merge base's budgets`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
    const base = execFileSync('/usr/bin/git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('/usr/bin/git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => t.id === TASK);
    expect(task, `budgets.json has a task ${TASK}`).toBeDefined();
    expect(task!.command).toEqual(BENCH);
    expect(task!.initialReason, 'it says why, naming issue #30').toMatch(/#30\b/);
  });

  it(`AC12 \`${BENCH.join(' ')}\` runs, exits 0 and prints the two medians`, () => {
    const { checkMs, plainMs } = bench();
    expect(checkMs).toBeGreaterThan(0);
    expect(plainMs).toBeGreaterThan(0);
  }, 600_000);

  it('AC12 on the reference Mac, counting adds under 1% to the check\'s time (five bench runs, by the timing rule)', () => {
    const problem = environmentProblem();
    if (problem) throw Error(`BLOCKED: the budget counts only on a reference Mac in a fit state: ${problem}`);
    bench();
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const { checkMs, plainMs } = bench();
      runs.push(((checkMs - plainMs) / plainMs) * 100);
    }
    judgeTiming('AC12 counting overhead (% of the check\'s time)', runs, 1);
  }, 1_800_000);
});
