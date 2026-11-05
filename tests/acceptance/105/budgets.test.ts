// AC3 budgets, on the reference Mac in the local preflight, compared with the merge base: a capture is saved within
// 1 s. Two parts, as #401's AC8:
// - the merge-base comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json): a task for the
//   save, valid against the merge base's budgets;
// - the issue's number in wall time, judged by the design's rule for timing results (five runs after a warm-up, within
//   the limit, over it by more than the margin, else INCONCLUSIVE), and counted only on a reference Mac on mains
//   power, Low Power Mode off, thermal state nominal and not loaded past its core count: anywhere else the test fails
//   with INCONCLUSIVE. It never passes on a reading it can't trust.
// On the virtual clock the asset is there 1 s after the release in privacy.test.ts; this file holds the wall time.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import {
  ALPHA, B, MS, REPO, SEC, at, cancelPick, capture, capturesOf, environmentProblem, hid, newFeed, pick, runShow, scenario,
  useFolders, useShow,
  type JsonObject,
} from './helpers.ts';

const show = useShow();
const dirs = useFolders();

// ---------------------------------------------------------------------------------------------------
// The merge-base comparison: the perf lane's task.

interface Line { id: string; command: string[]; initialReason?: string }
const TASK = 'capture-save';

describe('AC3 budgets in the local preflight, compared with the merge base', () => {
  it('AC3 the perf lane has a task for saving a capture, a #105 first measurement, valid against the merge base\'s budgets', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => t.id === TASK);
    expect(task, `budgets.json has a task ${TASK}`).toBeDefined();
    expect(task!.command.length, `${TASK} names its command`).toBeGreaterThan(0);
    expect(String(task!.initialReason), `${TASK} says why, naming issue #105`).toMatch(/#105/);
  });
});

// ---------------------------------------------------------------------------------------------------
// The issue's number in wall time on the reference Mac (as tests/acceptance/401 and 96).

/** PASS when every run is within the limit; FAIL when every run is over it by more than the margin (the larger of 5% and
 * the runs' spread); else, and off a fit reference Mac, INCONCLUSIVE, which fails: it is not a pass. */
function judge(name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
  const margin = Math.max(0.05, spread);
  const reading = `${name}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(reading);
  const problem = environmentProblem();
  if (problem) expect.fail(`INCONCLUSIVE: ${problem}; the reading is not a result: ${reading}`);
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${reading}`).toBe(false);
  if (!runs.every((r) => r <= limit)) expect.fail(`INCONCLUSIVE: ${reading}`);
}

describe('AC3 the issue\'s number on the reference Mac', () => {
  it('AC3 a capture is saved within 1 s: a 119.5 s hold of B, recorded, released and saved, against the same run with the picker cancelled', () => {
    const DOWN = 3 * SEC;
    const UP = DOWN + 119.5 * SEC;
    const calls = (picked: boolean): JsonObject[] => [
      capture(2 * SEC, ALPHA.id, 'The legend overlaps the chart on the second display'),
      picked ? pick(2 * SEC + 500 * MS, B.uuid) : cancelPick(2 * SEC + 500 * MS),
      hid(DOWN, 'down'), hid(UP, 'up'), at('captures', UP + SEC),
    ];
    const timed = (picked: boolean): number => {
      const s = scenario({ ...dirs(), feeds: { a: newFeed('feedA'), b: newFeed('feedB') } }, calls(picked));
      const t = performance.now();
      const { replies } = runShow(show(), s, picked ? 'a saved capture' : 'a cancelled pick');
      const ms = performance.now() - t;
      const saved = capturesOf(replies[replies.length - 1], 'captures').filter((c) => c.asset !== null).length;
      expect(saved, picked ? 'the timed capture is saved' : 'the cancelled pick saves nothing').toBe(picked ? 1 : 0);
      return ms;
    };
    const perSave = (): number => timed(true) - timed(false);
    console.log(`warm-up: ${perSave().toFixed(3)} ms per capture (discarded)`);
    judge('AC3 a 119.5 s capture recorded and saved (ms)', [1, 2, 3, 4, 5].map(perSave), 1000);
  }, 900_000);
});
