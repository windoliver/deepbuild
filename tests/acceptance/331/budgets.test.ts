// #331 AC8: budgets on the reference Mac in the local preflight, compared with the merge base: `deep env up` adds
// under 1 s beyond the repo's own start, and teardown finishes in under 5 s. The merge-base comparison is the
// perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json): tasks `env-up` and `env-down`, a #331 first
// measurement, valid against the merge base's budgets. The issue's numbers are judged here by the design's timing
// rule (five runs after a warm-up; PASS when all are within the limit, FAIL when all are over it by more than the
// margin, otherwise INCONCLUSIVE) and count only on a reference Mac in a fit state; anywhere else the timing test
// fails BLOCKED, naming why, since nothing unrun passes.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  alive, blocked, childEnv, cleanup, envDown, environmentProblem, firstFreeFrom, health, judge, makeRepo, median, NODE, own, ownPidDir, READY, REPO,
  serverUp, SERVER, startHub, stopHub, sub, tempDir, upReady, waitFor, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

describe('AC8 #331.18b679cd deep env up adds under 1 s beyond the repo\'s own start; teardown under 5 s; on the reference Mac, against the merge base', () => {
  it('AC8 the perf lane has env-up and env-down tasks, a #331 first measurement, valid against the merge base\'s budgets', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Line[] };
    const base = execFileSync('/usr/bin/git', ['-C', REPO, 'merge-base', 'HEAD', 'origin/main'], { encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('/usr/bin/git', ['-C', REPO, 'show', `${base}:benchmarks/budgets.json`], { encoding: 'utf8' })));
    for (const [id, arg] of [['env-up', 'up'], ['env-down', 'down']] as const) {
      const task = current.tasks.find((t) => t.id === id);
      expect(task, `budgets.json has a task ${id}`).toBeDefined();
      expect(task!.command).toEqual(['node', 'benchmarks/env.mjs', arg]);
      expect(String(task!.initialReason), `${id} says why, naming issue #331`).toMatch(/#331/);
    }
  });

  it.each(['up', 'down'])('AC8 `node benchmarks/env.mjs %s` runs and exits 0', (arg) => {
    execFileSync(NODE, [join(REPO, 'benchmarks/env.mjs'), arg], { cwd: REPO, stdio: 'pipe', timeout: 300_000, env: childEnv() });
  }, 300_000);

  it('AC8 on the reference Mac, deep env up takes under 1000 ms more than the repo\'s own start of the same stack, and deep env down under 5000 ms', async (ctx) => {
    const problem = environmentProblem();
    if (problem) blocked(`this budget counts only on the reference Mac in the local preflight, and this machine can't give it: ${problem}`);
    const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20 });
    const wt = t.worktree('wt-a');
    const hub = await startHub(sub(tempDir(), 'root'));
    try {
      /** The repo's own start: its dev server spawned bare until its health route answers 200, then stopped. */
      const own0 = async (): Promise<number> => {
        const port = await firstFreeFrom(3100);
        const pids = ownPidDir(sub(tempDir(), 'bare'));
        const t0 = performance.now();
        const child = spawn(NODE, [SERVER, '--pid-dir', pids], { cwd: wt, env: childEnv({ web: String(port) }), stdio: 'ignore' });
        own(child.pid);
        await waitFor(async () => (await health(port)).status === 200, 20_000, 'the bare start');
        const took = performance.now() - t0;
        child.kill('SIGTERM');
        await waitFor(() => !alive(child.pid!), 5000, 'the bare server to stop');
        return took;
      };
      const round = async (): Promise<{ added: number; down: number }> => {
        const bare: number[] = [];
        const up: number[] = [];
        const down: number[] = [];
        for (let i = 0; i < 5; i++) {
          bare.push(await own0());
          const t0 = performance.now();
          await upReady(hub, wt);
          up.push(performance.now() - t0);
          const t1 = performance.now();
          const d = await envDown(hub, wt);
          down.push(performance.now() - t1);
          expect(d.ran.code).toBe(0);
        }
        return { added: median(up) - median(bare), down: median(down) };
      };
      await round();
      const runs: { added: number; down: number }[] = [];
      for (let i = 0; i < 5; i++) runs.push(await round());
      judge(ctx, 'AC8 deep env up beyond the repo\'s own start (ms)', runs.map((r) => r.added), 1000);
      judge(ctx, 'AC8 deep env down (ms)', runs.map((r) => r.down), 5000);
    } finally {
      await stopHub(hub);
    }
  }, 900_000);
});
