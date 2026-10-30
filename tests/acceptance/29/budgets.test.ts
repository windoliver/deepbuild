// #29 AC18: budgets, on the reference Mac in the local preflight. Judged by the design's rule for timing results: five runs after
// a warm-up; PASS when all are within the limit, FAIL when all are over it by more than the margin, otherwise INCONCLUSIVE. Off a
// reference Mac, on battery, with Low Power Mode on or unknown, or with a thermal warning the result is a reading only and each
// test skips as INCONCLUSIVE; it never passes by skipping. The merge base has no gate runner, so "compared with the merge base"
// has nothing to compare; the absolute limits are held here (README, Open points 10).
import { execFileSync, spawnSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'vitest';
import { executeClaim, lockDefinition, recomputeHash } from '../../../packages/gate/src/index.ts';
import type { DefinitionParts } from '../../../packages/gate/src/index.ts';
import { environmentProblem, git, judge, makeRepo, NODE, session, write } from './helpers.ts';
import { leaseWorld, maxOverlap } from './h-d.ts';

function gated(ctx: TestContext): void {
  const problem = environmentProblem();
  if (problem) ctx.skip(`INCONCLUSIVE ${problem}: a budget counts only on a reference Mac on mains power`);
}
const FIVE = [0, 1, 2, 3, 4];
const STAMP = "require('fs').appendFileSync(process.argv[1],String(Date.now())+'\\n')";

describe('AC18 budgets on the reference Mac', () => {
  it('AC18 the first check starts within 200 ms of its checkout being ready', async (ctx) => {
    gated(ctx);
    const w = await leaseWorld(availableParallelism());
    try {
      const { dir } = makeRepo({ 'src/a.ts': 'x\n' });
      write(dir, { 'src/a.ts': 'y\n' });
      const gaps: number[] = [];
      for (const i of [-1, ...FIVE]) {
        const stamp = join(w.dir, `stamp${i}`);
        const e = await executeClaim({ repo: dir, session: session(), table: w.table, checks: [{ id: 'first', argv: [NODE, '-e', STAMP, stamp] }] });
        if (i >= 0) gaps.push(e.checks[0]!.started_at - e.checkout_ready_at);
      }
      judge(ctx, 'first check start after checkout ready (ms)', gaps, 200);
    } finally { await w.close(); }
  }, 300_000);

  it('AC18 the claim\'s snapshot and checkout together are ready in under 3 s on a 1 GB repo', async (ctx) => {
    gated(ctx);
    const w = await leaseWorld(availableParallelism());
    try {
      const { dir } = makeRepo({ 'src/a.ts': 'x\n' });
      execFileSync('dd', ['if=/dev/zero', `of=${join(dir, 'big.bin')}`, 'bs=1048576', 'count=1024'], { stdio: 'ignore' });
      git(dir, ['add', '-A']);
      git(dir, ['commit', '-q', '-m', 'a 1 GB file']);
      const ready: number[] = [];
      for (const i of [-1, ...FIVE]) {
        write(dir, { 'src/a.ts': `edit ${i}\n` }); // an uncommitted change: a snapshot is made
        const t0 = Date.now();
        const e = await executeClaim({ repo: dir, session: session(), table: w.table, checks: [{ id: 'noop', argv: [NODE, '-e', '0'] }] });
        if (i >= 0) ready.push(e.checkout_ready_at - t0);
      }
      judge(ctx, 'snapshot and checkout ready on a 1 GB repo (ms)', ready, 3000);
    } finally { await w.close(); }
  }, 600_000);

  it('AC18 never more than half the CPU cores run checks', async (ctx) => {
    gated(ctx);
    const cores = availableParallelism();
    const limit = Math.floor(cores / 2);
    const w = await leaseWorld(cores);
    const stop = w.ticker();
    try {
      const log = join(w.dir, 'log');
      const body = "const fs=require('fs');const [id,log]=process.argv.slice(1);const s=Date.now();setTimeout(()=>fs.appendFileSync(log,id+' '+s+' '+Date.now()+'\\n'),500)";
      const repos = Array.from({ length: cores * 2 }, (_, i) => {
        const { dir } = makeRepo({ 'src/a.ts': `${i}\n` });
        return { dir, checks: [1, 2].map((n) => ({ id: `r${i}c${n}`, argv: [NODE, '-e', body, `r${i}c${n}`, log] })) };
      });
      await Promise.all(repos.map((r) => executeClaim({ repo: r.dir, session: session(), table: w.table, checks: r.checks })));
      const spans = linesOf(log).map((l) => { const [, s, e] = l.split(' '); return [Number(s), Number(e)] as [number, number]; });
      if (spans.length !== cores * 4) throw Error(`expected ${cores * 4} checks to have run, the log has ${spans.length}`);
      const deep = maxOverlap(spans);
      if (deep > limit) throw Error(`FAIL ${deep} checks ran at once on ${cores} cores; the limit is ${limit}`);
    } finally { stop(); await w.close(); }
  }, 300_000);

  it('AC18 the runner\'s own overhead stays under 2% of a check\'s wall time', async (ctx) => {
    gated(ctx);
    const w = await leaseWorld(availableParallelism());
    try {
      const { dir } = makeRepo({ 'src/a.ts': 'x\n' });
      const ratios: number[] = [];
      for (const i of [-1, ...FIVE]) {
        const t0 = Date.now();
        spawnSync('sleep', ['2']); // the check by itself
        const bare = Date.now() - t0;
        const e = await executeClaim({ repo: dir, session: session(), table: w.table, checks: [{ id: 'sleep', argv: ['sleep', '2'] }] });
        const c = e.checks[0]!;
        if (i >= 0) ratios.push(Math.max(0, c.wall_ms - bare) / c.wall_ms);
      }
      judge(ctx, 'runner overhead as a share of a check\'s wall time', ratios, 0.02);
    } finally { await w.close(); }
  }, 300_000);

  it('AC18 the hash check at a claim takes under 5 ms', (ctx) => {
    gated(ctx);
    const definition: DefinitionParts = {
      task_ref: 'task:01K74FX2B4D6F8H0K2M4P6R8T0',
      requirements: Array.from({ length: 20 }, (_, i) => ({ id: `R${i + 1}`, text: `requirement ${i + 1} holds`, check: `.deepbuild/checks/c${i + 1}.sh` })),
      deliverables: ['src/a.ts', 'src/b.ts'],
      files: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`.deepbuild/checks/c${i + 1}.sh`, `#!/bin/sh\n${'echo check\n'.repeat(200)}`])),
    };
    const locked = lockDefinition(definition);
    for (let i = 0; i < 200; i++) recomputeHash(definition, locked); // warm-up
    const per = FIVE.map(() => {
      const t0 = performance.now();
      for (let i = 0; i < 100; i++) recomputeHash(definition, locked);
      return (performance.now() - t0) / 100;
    });
    judge(ctx, 'recomputeHash over 20 requirements and 20 files (ms)', per, 5);
  });
});

function linesOf(file: string): string[] {
  return execFileSync('cat', [file], { encoding: 'utf8' }).split('\n').filter(Boolean);
}
