// #237 AC7: budgets on the reference Mac in the local preflight, compared with the merge base: a lease is granted
// in under 50 ms. The merge-base comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json): a
// `lease-grant` task, valid against the merge base's budgets. The issue's number is judged here by the timing rule
// (five runs after a warm-up; PASS when all are within the limit, FAIL when all are over it by more than the
// margin, otherwise INCONCLUSIVE). The timing is always measured and printed; it counts only on a reference Mac in
// a fit state and not loaded past its core count, and anywhere else it is skipped as INCONCLUSIVE with the reading,
// never passed (as the budgets of #14, #16 and #236 are).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, environmentProblem, judge, median, NODE, REPO, session } from './helpers.ts';
import { as, granted, openWorld } from './world.ts';

afterEach(cleanup);

interface Line { id: string; command: string[]; initialReason?: string }

describe('AC7 #237.5459ad56 a lease is granted in under 50 ms, compared with the merge base', () => {
  it('AC7 the perf lane has a lease-grant task, a #237 first measurement, valid against the merge base\'s budgets', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => t.id === 'lease-grant');
    expect(task, 'budgets.json has a task lease-grant').toBeDefined();
    expect(task!.command).toEqual(['node', 'benchmarks/lease.mjs']);
    expect(String(task!.initialReason), 'it says why, naming issue #237').toMatch(/#237/);
  });

  it('AC7 `node benchmarks/lease.mjs` runs and exits 0', () => {
    execFileSync(NODE, [join(REPO, 'benchmarks/lease.mjs')], { cwd: REPO, stdio: 'pipe', timeout: 300_000 });
  }, 300_000);

  it('AC7 on the reference Mac, a lease is granted in under 50 ms, on a record that already holds 100 leases', async (ctx) => {
    const w = await openWorld();
    try {
      await w.table.declare('test-timed', { name: 'test.timed', match: 'exact', cap: 100_000, cooldown: 0, cost: 0 });
      const key = (k: number) => ({ host: 'local', kind: 'test.timed', key: `k${k}` });
      let next = 0;
      for (let i = 0; i < 100; i++) granted(await w.table.lease(as(session()), key(next++), 'exclusive'), `held lease ${i}`);
      const once = async (): Promise<number> => {
        const took: number[] = [];
        for (let i = 0; i < 20; i++) {
          const t0 = performance.now();
          const r = await w.table.lease(as(session()), key(next++), 'exclusive');
          took.push(performance.now() - t0);
          granted(r, 'a timed grant');
        }
        return median(took);
      };
      await once();
      const runs: number[] = [];
      for (let i = 0; i < 5; i++) runs.push(await once());
      const problem = environmentProblem();
      if (problem) {
        console.log(`AC7 lease grant (ms, median of 20): ${runs.map((r) => r.toFixed(2)).join(', ')} against 50`);
        ctx.skip(`INCONCLUSIVE (reading only: ${problem}): ${runs.map((r) => r.toFixed(2)).join(', ')} ms against 50`);
      }
      judge(ctx, 'AC7 lease grant (ms, median of 20)', runs, 50);
    } finally {
      await w.close();
    }
  }, 120_000);
});
