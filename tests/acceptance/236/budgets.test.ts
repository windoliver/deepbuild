// #236 AC8: budgets on the reference Mac in the local preflight, compared with the merge base: sandbox setup
// adds under 300 ms per check. The merge-base comparison is the perf lane's (scripts/benchmark.mjs,
// benchmarks/budgets.json): a `sandbox-setup` task, valid against the merge base's budgets. The issue's number is
// judged here by the design's rule for timing (five runs after a warm-up; PASS when all are within the limit,
// FAIL when all are over it by more than the margin, otherwise INCONCLUSIVE), and counts only on a reference
// Mac in a fit state; anywhere else it is skipped with the reason, never passed (as #14's and #16's budgets are).
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, environmentProblem, judge, median, NODE, REPO, runId, sub, tempDir, type Line } from './helpers.ts';
import { openWorld, type World } from './world.ts';

afterEach(cleanup, 60_000);
const problem = environmentProblem();

describe('AC8 #236.d19f1cac sandbox setup adds under 300 ms per check, compared with the merge base', () => {
  it('AC8 the perf lane has a sandbox-setup task, a #236 first measurement, valid against the merge base\'s budgets', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => t.id === 'sandbox-setup');
    expect(task, 'budgets.json has a task sandbox-setup').toBeDefined();
    expect(task!.command).toEqual(['node', 'benchmarks/sandbox.mjs']);
    expect(String(task!.initialReason), 'it says why, naming issue #236').toMatch(/#236/);
  });

  it('AC8 `node benchmarks/sandbox.mjs` runs and exits 0', () => {
    execFileSync(NODE, [join(REPO, 'benchmarks/sandbox.mjs')], { cwd: REPO, stdio: 'pipe', timeout: 300_000 });
  }, 300_000);

  it('AC8 on the reference Mac, a check started through the supervisor in the sandbox takes under 300 ms more than the same process started bare', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const w = await openWorld();
    try {
      const bare = (): Promise<number> => new Promise((resolve, reject) => {
        const t0 = performance.now();
        const child = spawn('/usr/bin/true', [], { stdio: 'ignore' });
        child.on('error', reject);
        child.on('exit', () => resolve(performance.now() - t0));
      });
      const supervised = async (world: World): Promise<number> => {
        const run = runId();
        const cwd = sub(tempDir(), 'run');
        const t0 = performance.now();
        const started = await world.sup.start({ run, cwd, argv: ['/usr/bin/true'] });
        if (started.status !== 'started') throw Error(`BLOCKED: ${run} didn't start: ${JSON.stringify(started)}`);
        await world.sup.wait(run);
        const took = performance.now() - t0;
        await world.sup.cleanup(run);
        return took;
      };
      const once = async (): Promise<number> => {
        const a: number[] = [];
        const b: number[] = [];
        for (let i = 0; i < 20; i++) { a.push(await supervised(w)); b.push(await bare()); }
        return median(a) - median(b);
      };
      await once();
      const runs: number[] = [];
      for (let i = 0; i < 5; i++) runs.push(await once());
      judge(ctx, 'AC8 sandbox setup per check (ms)', runs, 300);
    } finally {
      await w.close();
    }
  }, 600_000);
});
