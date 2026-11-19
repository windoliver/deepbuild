// #2365 AC6: "Budgets, on the reference Mac in the local preflight, compared with the merge base: a new perf task
// holds the first criterion's pass, and `archive-live`, `archive-month` and `archive-backlog` stay within their
// limits."
//
// The comparison with the merge base is the perf lane's (scripts/benchmark.mjs `judgeTask`, in the local preflight on
// a reference Mac), as #20's budgets are; this file doesn't repeat it, and the README lists it as proved only there.
// What it checks, on a checkout with git and its origin/main (as #20's budgets test does):
//   - benchmarks/budgets.json is valid against the merge base's (`validateBudgets`): the three archive tasks keep
//     their frozen definitions, and the file gains at least one task the merge base lacks that names #2365 (in its
//     first-measurement reason or its criteria) and runs a benchmark under benchmarks/;
//   - that task, and archive-live, archive-month and archive-backlog, each run once and exit 0.
// Heavy: it builds nothing and runs the benches, so it runs by hand or in the budget window, never in the unit lane.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NODE, REPO } from '../helpers.ts';
import { criterionId } from '../criteria.ts';

const AC6 = `#2365 AC6 ${criterionId(6)}`;
const ARCHIVE_TASKS = ['archive-live', 'archive-month', 'archive-backlog'];
interface Task { id: string; command: string[]; initialReason?: string; criteria?: string[] }
const current = (): { tasks: Task[] } => JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
function base(): { tasks: Task[] } {
  const sha = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
  return JSON.parse(execFileSync('git', ['show', `${sha}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })) as { tasks: Task[] };
}
function newTasks(): Task[] {
  const before = new Set(base().tasks.map((t) => t.id));
  return current().tasks.filter((t) => !before.has(t.id) && (/#2365\b/.test(String(t.initialReason)) || (t.criteria ?? []).some((c) => c.startsWith('#2365.'))) && t.command.some((part) => part.startsWith('benchmarks/')));
}

describe(`${AC6} budgets, compared with the merge base in the local preflight`, () => {
  it(`${AC6} budgets.json is valid against the merge base's, keeps archive-live, archive-month and archive-backlog, and gains a perf task for #2365`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    validateBudgets(current(), base());
    expect(ARCHIVE_TASKS.filter((id) => !current().tasks.some((t) => t.id === id)), 'the archive\'s three tasks are still there').toEqual([]);
    expect(newTasks().map((t) => t.id), 'a new perf task, naming #2365, holds the first criterion\'s pass').not.toEqual([]);
  });

  it(`${AC6} the new task, archive-live, archive-month and archive-backlog each run and exit 0`, () => {
    const tasks = [...newTasks(), ...current().tasks.filter((t) => ARCHIVE_TASKS.includes(t.id))];
    expect(tasks.length, 'the tasks to run').toBeGreaterThan(ARCHIVE_TASKS.length);
    for (const task of tasks) {
      const [cmd, ...args] = task.command;
      const r = spawnSync(cmd === 'node' ? NODE : cmd!, args, { cwd: REPO, encoding: 'utf8', timeout: 1_800_000, maxBuffer: 256 * 1024 * 1024 });
      expect(r.status, `${task.id} (${task.command.join(' ')}): ${r.stderr.slice(-2000)}`).toBe(0);
    }
  }, 7_200_000);
});
