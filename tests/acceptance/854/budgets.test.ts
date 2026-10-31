// The four perf-lane tasks in benchmarks/budgets.json, each with its target, its command and the perf lane's
// margin against the merge base (the issue's scope: "Four perf-lane tasks in benchmarks/budgets.json … Each task
// fails past its target and compares with the merge base at the perf lane's margin"). Each task's entry is tagged
// with the criterion whose numbers it holds. The entry's `targets` are the issue's numbers, frozen with the entry
// once it reaches main (scripts/benchmark.mjs `validateBudgets`), so no later change moves them; `canvas.mjs judge`
// reads them from here. The wrong programs: the base (no task); a task with another command, a target off the
// issue's number, or a margin other than the lane's; a budgets.json the lane's own validator refuses against the
// merge base's.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, TASKS, type TaskKey } from './helpers.ts';

const IDS: Record<TaskKey, string> = { patch: '#854.ad11ae91', read: '#854.3f8dbc12', idle: '#854.022ea575', replica: '#854.0393e70f' };
/** The perf lane's margin against the merge base: "A regression is a p50 more than 50% above the merge base's". */
const LANE_MARGIN = 0.5;

interface Task { id: string; command: string[]; margin: number; limits: Record<string, number>; targets?: Record<string, number>; initialReason?: string }

async function budgets(): Promise<{ current: { tasks: Task[] } }> {
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
  const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
  validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  return { current };
}

describe('#854 budgets.json gains the four perf-lane tasks, each with its target', () => {
  for (const key of Object.keys(TASKS) as TaskKey[]) {
    const task = TASKS[key];
    it(`${IDS[key]} budgets.json has the task ${task.id}: it runs node benchmarks/canvas.mjs ${task.mode}, holds the issue's targets ${JSON.stringify(task.targets)}, compares with the merge base at the lane's 50% margin, and passes the lane's validator against the merge base's budgets`, async () => {
      const { current } = await budgets();
      const entry = current.tasks.find((t) => t.id === task.id);
      expect(entry, `budgets.json has the task ${task.id}`).toBeDefined();
      expect(entry!.command, `${task.id} runs its mode of the canvas bench`).toEqual(['node', 'benchmarks/canvas.mjs', task.mode]);
      expect(entry!.targets, `${task.id} holds the issue's numbers as its targets`).toEqual(task.targets);
      expect(entry!.margin, `${task.id} compares with the merge base at the perf lane's margin`).toBe(LANE_MARGIN);
      expect(String(entry!.initialReason), `${task.id} says why, naming #854`).toMatch(/#854/);
    }, 120_000);
  }
});
