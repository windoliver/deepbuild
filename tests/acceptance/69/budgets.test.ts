// #69.eb8b7be8 budgets, on the reference Mac in the local preflight, compared with the merge base: a plan's
// preview is drafted in under 2 s, model calls excluded.
//
// The merge-base comparison is the perf lane's (scripts/perf.mjs and scripts/benchmark.mjs over
// benchmarks/budgets.json), as #23, #24 and #319 left it: the first test holds the lane to a task for this budget.
// The second times the drafting itself: an authority ask raised with a 500-step plan until its card shows the whole
// plan, with no model in the path. Timing follows timing.ts; the readings are always printed, and off a reference
// Mac the result is INCONCLUSIVE and the test skips. It never passes by skipping.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { openWorld, type World } from './helpers.ts';
import { previewRuns } from './scenarios.ts';
import { environmentProblem, judge } from './timing.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const TASK = 'plan-preview';

let world: World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });

test(`#69.eb8b7be8 the perf lane has the task ${TASK}, a #69 first measurement, valid against the merge base's budgets, and it runs`, async () => {
  const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
  validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  const task = current.tasks.find((t) => t.id === TASK);
  expect(task, `benchmarks/budgets.json has a task ${TASK}`).toBeDefined();
  expect(String(task!.initialReason), `${TASK} says why, naming issue #69`).toMatch(/#69\b/);
  const [command, ...args] = task!.command;
  // It runs to completion: execFileSync throws on a non-zero exit, naming the command.
  execFileSync(command === 'node' ? process.execPath : command!, args, { cwd: REPO, encoding: 'utf8', timeout: 600_000 });
}, 600_000);

test("#69.eb8b7be8 a plan's preview is drafted in under 2 s, model calls excluded", async (ctx) => {
  const runs = await previewRuns((world = await openWorld()));
  judge(ctx, "#69 a plan's preview drafted, 500 steps (ms)", runs, 2000, environmentProblem());
}, 600_000);
