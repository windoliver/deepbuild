// #3544, sixth criterion: budget: `record-replay-100k` reads within its margin of the merge base, 20 samples a side.
// The comparison is the budget window's (scripts/budget-window.mjs, with benchmark.mjs's 20 interleaved samples a side
// and the task's `margin`), which proves a criterion through the tasks that name it. So, as #3440's budget criterion
// was carried: the task of benchmarks/budgets.json names this criterion, the budgets are valid against the merge
// base's (no command, margin or limit of theirs moved), and the task runs and exits 0. No sample is taken here.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { AC, REPO } from './helpers.ts';

interface Task { id: string; command: string[]; margin?: number; criteria?: string[] }
const TASK = 'record-replay-100k';

it(`${AC.budget} record-replay-100k names this criterion for the budget window, unchanged against the merge base's budgets, and runs`, async () => {
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
  let base: { tasks: Task[] };
  try {
    const commit = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    base = JSON.parse(execFileSync('git', ['show', `${commit}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] })) as { tasks: Task[] };
  } catch (error) {
    expect.fail(`BLOCKED: the merge base's budgets can't be read (git merge-base HEAD origin/main, git show): ${String((error as { stderr?: string }).stderr ?? error).slice(-600)}`);
  }
  const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): unknown };
  let refused = '';
  try { validateBudgets(current, base); } catch (error) { refused = error instanceof Error ? error.message : String(error); }
  expect(refused, "benchmarks/budgets.json is valid against the merge base's budgets").toBe('');

  const task = current.tasks.find((t) => t.id === TASK);
  const before = base.tasks.find((t) => t.id === TASK);
  expect(before, `BLOCKED: the merge base's budgets hold no task ${TASK} to compare with`).toBeDefined();
  expect(task && { command: task.command, margin: task.margin }, `the task ${TASK} keeps the merge base's command and margin, so its 20 samples a side compare like with like`).toEqual({ command: before!.command, margin: before!.margin });
  expect(task!.criteria ?? [], `the task ${TASK} of benchmarks/budgets.json names ${AC.budget} in its criteria, so the budget window's record of it proves the criterion: it names ${JSON.stringify(task!.criteria ?? [])}`).toContain(AC.budget);

  const [command, ...args] = task!.command;
  let failed = '';
  try {
    execFileSync(command === 'node' ? process.execPath : command!, args, { cwd: REPO, stdio: 'pipe', timeout: 600_000, maxBuffer: 1 << 26 });
  } catch (error) {
    failed = String((error as { stderr?: Buffer }).stderr ?? error).slice(-1500) || String(error);
  }
  expect(failed, `the task ${TASK} runs and exits 0`).toBe('');
}, 900_000);
