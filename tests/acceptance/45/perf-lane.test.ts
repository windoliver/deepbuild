// #45 AC9, "in the local preflight, compared with the merge base": the comparison is the perf lane's (scripts/benchmark.mjs,
// benchmarks/budgets.json), as #20's budgets do it. The readings' two tasks must be there, each a #45 first measurement,
// valid against the merge base's budgets, and each must run. This file imports no readings, so it fails at its assertions
// on the merge base.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
interface Task { id: string; command: string[]; initialReason?: string }
function tasks(): Task[] {
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
  return current.tasks.filter((t) => /#45\b/.test(String(t.initialReason)) && t.command.some((part) => part.endsWith('benchmarks/readings.mjs')));
}

describe('AC9 in the local preflight', () => {
  it('#45.d0a882a2 AC9 the perf lane has two readings tasks, recompute and update, each a #45 first measurement running benchmarks/readings.mjs, valid against the merge base\'s budgets', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as unknown;
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    expect(tasks().map((t) => t.id), 'budgets.json has a #45 task for each of the two budgets').toHaveLength(2);
  });

  it('#45.d0a882a2 AC9 each of the readings\' perf-lane tasks runs and exits 0', () => {
    const found = tasks();
    expect(found.length, 'the readings have perf-lane tasks to run').toBeGreaterThan(0);
    for (const task of found) {
      const [cmd, ...args] = task.command;
      const r = spawnSync(cmd === 'node' ? process.execPath : cmd!, args, { cwd: REPO, encoding: 'utf8', timeout: 600_000 });
      expect(r.status, `${task.id} (${task.command.join(' ')}): ${r.stderr}`).toBe(0);
    }
  }, 1_200_000);
});
