// AC12: budgets on the reference Mac in the local preflight, compared with the merge base: counting tests run adds
// under 1% to the check's time. The merge-base comparison is the perf lane's (scripts/benchmark.mjs,
// benchmarks/budgets.json), as #236's sandbox budget is: a task for the command check, a #30 first measurement,
// valid against the merge base's budgets. Its bench times interleaved pairs of a command check run that counts its
// tests and the same run with counting left out, and prints every pair: a short run by default, which the perf
// lane times 42 times per preflight, and at least 300 pairs when given `--pairs 300`, as AC12's number. One such run is one
// reading: the median of the pairs' differences as a percentage of the median plain run. The issue's 1% is judged
// on five readings after a warm-up one, by the design's timing rule with the margin as a fraction of the limit
// (as the perf lane's judgeLimit takes it), on a reference Mac in a fit state only. Anywhere else the test fails
// BLOCKED, never passes. (Dispute redraft, 2026-10-24: README, What depends on other issues.)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { environmentProblem, median, NODE, REPO } from './helpers.ts';

const TASK = 'command-check-count';
const BENCH = ['node', 'benchmarks/command-check.mjs'];
/** Pairs a reading needs so five readings can tell 0.2% from 3% (README, AC12's comparison). */
const PAIRS = 300;
const LIMIT = 1;
type Task = { id: string; command: string[]; initialReason: string };

/** The perf lane's limit on one run of a task's command (scripts/benchmark.mjs, measureOnce). */
const LANE_RUN_MS = 300_000;

/**
 * One run of the bench: its JSON line, every counted run and the plain run paired with it. With no count it is the
 * perf lane's default run, which must end within the lane's per-run limit; with a count, `--pairs <count>`.
 */
function bench(pairs?: number): { checkMs: number[]; plainMs: number[] } {
  const args = pairs === undefined ? [] : ['--pairs', String(pairs)];
  const out = execFileSync(NODE, [join(REPO, BENCH[1]!), ...args], { cwd: REPO, encoding: 'utf8', timeout: pairs === undefined ? LANE_RUN_MS : 1_200_000, maxBuffer: 64 * 1024 * 1024 }).trim().split('\n').pop()!;
  const line = JSON.parse(out) as { checkMs: unknown; plainMs: unknown };
  const times = (xs: unknown): xs is number[] => Array.isArray(xs) && xs.every((x) => typeof x === 'number' && Number.isFinite(x) && x > 0);
  if (!times(line.checkMs) || !times(line.plainMs) || line.checkMs.length !== line.plainMs.length)
    throw Error(`the bench printed ${out.slice(0, 500)}, not {checkMs: [...], plainMs: [...]} of equal length`);
  if (line.checkMs.length < (pairs ?? 1)) throw Error(`the bench${args.length ? ` ${args.join(' ')}` : ''} timed ${line.checkMs.length} pairs; it needs at least ${pairs ?? 1}`);
  return { checkMs: line.checkMs, plainMs: line.plainMs };
}

/** One reading: the median paired difference, as a percentage of the median plain run. */
function reading({ checkMs, plainMs }: { checkMs: number[]; plainMs: number[] }): number {
  return (median(checkMs.map((c, i) => c - plainMs[i]!)) / median(plainMs)) * 100;
}

/**
 * The design's timing rule (Numbers version 0 has to hold, Every task carries its own budgets): PASS when all five
 * readings are within the limit, FAIL when all five are over it by more than the margin, otherwise INCONCLUSIVE with
 * all five attached. The margin is the larger of 5% and the five readings' spread, both as fractions of the limit,
 * as the perf lane's judgeLimit takes them, so a reading near zero can't widen it. INCONCLUSIVE fails the test with
 * that word (Nothing missing passes), never a skip.
 */
function judgeOverhead(runs: number[]): void {
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / LIMIT);
  const shown = `AC12 counting overhead (% of the check's time): ${runs.map((r) => r.toFixed(3)).join(', ')} against ${LIMIT} (margin ${(margin * 100).toFixed(1)}% of the limit, FAIL above ${(LIMIT * (1 + margin)).toFixed(3)})`;
  console.log(shown);
  if (runs.every((r) => r <= LIMIT)) return;
  expect(runs.every((r) => r > LIMIT * (1 + margin)), `FAIL ${shown}`).toBe(false);
  throw Error(`INCONCLUSIVE ${shown}`);
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

  it(`AC12 \`${BENCH.join(' ')}\`, the perf lane's run, exits 0 within the lane's ${LANE_RUN_MS / 1000} s per run and prints its pairs`, () => {
    const pairs = bench();
    console.log(`AC12 default run: ${reading(pairs).toFixed(3)}% over ${pairs.checkMs.length} pairs, plain median ${median(pairs.plainMs).toFixed(1)} ms`);
  }, LANE_RUN_MS + 60_000);

  it(`AC12 \`${BENCH.join(' ')} --pairs ${PAIRS}\` exits 0 and prints at least ${PAIRS} counted and plain pairs`, () => {
    const pairs = bench(PAIRS);
    console.log(`AC12 one reading: ${reading(pairs).toFixed(3)}% over ${pairs.checkMs.length} pairs, plain median ${median(pairs.plainMs).toFixed(1)} ms`);
  }, 1_200_000);

  it(`AC12 on the reference Mac, counting adds under 1% to the check's time (five readings of ${PAIRS}+ pairs, by the timing rule)`, () => {
    const problem = environmentProblem();
    if (problem) throw Error(`BLOCKED: the budget counts only on a reference Mac in a fit state: ${problem}`);
    bench(PAIRS);
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(reading(bench(PAIRS)));
    judgeOverhead(runs);
  }, 3_600_000);
});
