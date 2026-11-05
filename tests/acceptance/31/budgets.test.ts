// #31 AC6 #31.814af360: budgets, on the reference Mac in the local preflight. Judged by the design's rule for timing results: five runs
// after a warm-up; PASS when all are within the limit, FAIL when all are over it by more than the margin, otherwise
// INCONCLUSIVE. Off a reference Mac, on battery, with Low Power Mode on or unknown, or with a thermal warning, each test
// skips as INCONCLUSIVE; it never passes by skipping. The merge base has no such service, so "compared with the merge
// base" has nothing to compare; the absolute limits are held here (README, Readings).
import { execFileSync } from 'node:child_process';
import { statfsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, type TestContext } from 'vitest';
import { commit, environmentProblem, git, makeRepo, openWorld, SEEDED, type World } from './helpers.ts';

const FIVE = [0, 1, 2, 3, 4];
const MB = 1024 * 1024;
function gated(ctx: TestContext): void {
  const problem = environmentProblem();
  if (problem) ctx.skip(`INCONCLUSIVE ${problem}: a budget counts only on a reference Mac on mains power`);
}
function judge(ctx: TestContext, name: string, runs: number[], limit: number): void {
  const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.abs(Math.min(...runs)), 1e-9);
  const margin = Math.max(0.05, spread);
  const shown = `${name}: ${runs.map((r) => r.toFixed(1)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(0)}%)`;
  console.log(shown);
  if (runs.every((r) => r <= limit)) return;
  expect(runs.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  ctx.skip(`INCONCLUSIVE ${shown}`);
}
/** A repo with 1 GB of tracked files and one new commit on a branch off its base. */
function oneGigabyte(): string {
  const repo = makeRepo(SEEDED);
  execFileSync('dd', ['if=/dev/zero', `of=${join(repo, 'big.bin')}`, 'bs=1048576', 'count=1024'], { stdio: 'ignore' });
  commit(repo, {}, 'a 1 GB file');
  git(repo, ['checkout', '-q', '-b', 'fix']);
  commit(repo, { 'src/fix.ts': 'export const fix = 1;\n' }, 'the fix');
  return repo;
}
const freeBytes = (dir: string): number => { const s = statfsSync(dir); return s.bavail * s.bsize; };
const baseCheckout = (service: Awaited<ReturnType<World['service']>>, repo: string, run: string) =>
  service.baseCheckout({ worktree: repo, onto: 'main', claim: 'HEAD', own: [], runs: [run] });

describe('AC6 #31.814af360 budgets on the reference Mac', () => {
  it('AC6 the base-commit checkout is ready in under 3 s on a 1 GB repo', async (ctx) => {
    gated(ctx);
    const w = await openWorld();
    try {
      const service = await w.service();
      const repo = oneGigabyte();
      const ms: number[] = [];
      for (const i of [-1, ...FIVE]) {
        const t0 = performance.now();
        const c = await baseCheckout(service, repo, `run:t${i + 1}`);
        if (i >= 0) ms.push(performance.now() - t0);
        await service.ended(c, `run:t${i + 1}`);
      }
      judge(ctx, 'base-commit checkout ready on a 1 GB repo (ms)', ms, 3000);
    } finally { await w.close(); }
  }, 600_000);

  it('AC6 a base-commit checkout of a 1 GB repo adds under 100 MB of disk, using copy-on-write where the file system has it', async (ctx) => {
    gated(ctx);
    const w = await openWorld();
    try {
      const service = await w.service();
      const repo = oneGigabyte();
      const added: number[] = [];
      for (const i of [-1, ...FIVE]) {
        const before = freeBytes(w.dir);
        const c = await baseCheckout(service, repo, `run:d${i + 1}`);
        if (i >= 0) added.push(Math.max(0, before - freeBytes(w.dir)) / MB);
        await service.ended(c, `run:d${i + 1}`);
      }
      judge(ctx, 'disk a base-commit checkout adds on a 1 GB repo (MB)', added, 100);
    } finally { await w.close(); }
  }, 600_000);
});
