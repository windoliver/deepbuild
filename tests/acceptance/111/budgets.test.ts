// #111.AC4 Budgets, on the reference Mac in the local preflight, compared with the merge base: compiling every agent's
// memory files takes under 60 s. The merge-base comparison is the perf lane's (scripts/benchmark.mjs,
// benchmarks/budgets.json), as #356's. The 60 s counts only on a reference Mac in a fit state (INCONCLUSIVE elsewhere,
// never a pass); that the compile finished and read all four agents is judged anywhere.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { environmentProblem, judge } from '../356/machine.ts';
import { NODE } from '../356/helpers.ts';
import { AGENTS, cleanup, compile, memoryFile, memoryHome, REPO_ROOT, ruleClaims, TWO } from './helpers.ts';

afterAll(cleanup, 60_000);
const AC4 = '#111.5691aa30';
const RULES_PER_AGENT = 200;
const SHARED = 100;
const SEEN = 'shared rule number 7 of the corpus';

interface Task { id: string; command: string[]; initialReason?: string }
const tasks = (): Task[] => (JSON.parse(readFileSync(join(REPO_ROOT, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] }).tasks
  .filter((t) => /#111\b/.test(String(t.initialReason)));

describe(`${AC4} budgets`, () => {
  it(`${AC4} the perf lane has a #111 task, valid against the merge base's budgets, and it runs`, async () => {
    const { validateBudgets } = (await import(join(REPO_ROOT, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const base = execFileSync('/usr/bin/git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    validateBudgets(JSON.parse(readFileSync(join(REPO_ROOT, 'benchmarks/budgets.json'), 'utf8')), JSON.parse(execFileSync('/usr/bin/git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO_ROOT, encoding: 'utf8' })));
    expect(tasks().length, 'budgets.json has a #111 task for compiling the memory files').toBeGreaterThan(0);
    for (const t of tasks()) {
      const [cmd, ...args] = t.command;
      const r = spawnSync(cmd === 'node' ? NODE : cmd!, args, { cwd: REPO_ROOT, encoding: 'utf8', timeout: 1_800_000 });
      expect(r.status, `${t.id} (${t.command.join(' ')}): ${r.stderr}`).toBe(0);
    }
  }, 3_600_000);

  it(`${AC4} compiling four agents' memory files, ${RULES_PER_AGENT} rules each and ${SHARED} of them shared, takes under 60 s and leaves each shared rule one claim with four sources`, async (ctx) => {
    const m = memoryHome();
    const shared = Array.from({ length: SHARED }, (_, i) => `- shared rule number ${i} of the corpus`);
    for (const agent of AGENTS) {
      const file = memoryFile(m.h.home, agent);
      const own = Array.from({ length: RULES_PER_AGENT - SHARED }, (_, i) => `- ${agent} rule number ${i} of the corpus`);
      writeFileSync(file, `${readFileSync(file, 'utf8')}\n${[...shared, ...own].join('\n')}\n`);
    }
    const t0 = performance.now();
    await compile(m);
    const seconds = (performance.now() - t0) / 1000;
    const [claim] = ruleClaims(m, SEEN);
    expect(claim?.json.proof, `"${SEEN}" is one claim held by all four agents after ${seconds.toFixed(1)} s`).toBe(4);
    expect(ruleClaims(m, TWO).length, 'the fixture\'s own rule is there too').toBe(1);
    const problem = environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (compile took ${seconds.toFixed(1)} s, not judged: ${problem})`);
    judge(ctx, 'compile seconds', [seconds], 60);
  }, 1_800_000);
});
