// #1017 AC8, Budgets, on the reference Mac in the local preflight, compared with the merge base: placing a 15 GB
// `target` and a 500 MB `node_modules` in a new worktree takes under 2 s. These are targets, to be measured: by the
// timing rule of #1097's suite (five runs; PASS when all are within the limit, FAIL when all are over it by more than
// the margin, otherwise INCONCLUSIVE), and on a machine that isn't a fit reference Mac, INCONCLUSIVE, with nothing
// built, to spare the shared machine. The merge-base comparison is the perf lane's (scripts/benchmark.mjs,
// benchmarks/budgets.json), as #1015's and #237's budgets read it.
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { environmentProblem, judge } from '../1097/helpers.ts';
import { AC8, doneYaml, gb, GB, hostFree, makeRepo, NODE, REPO, waitBuilt, World, worktree, type Product } from './helpers.ts';

/** The merge base this suite was written on, pinned, so the comparison stays with the pre-#1017 code after it merges. */
const BASE = '79d98cbc200df73472c7aba3511ed48c39afaf75';
const LIMIT_MS = 2000;
const RUNS = 5;
/** A target shaped like a Rust one: 2,000 files of 7.5 MB and 30,000 small ones, 15 GB; a node_modules of 20,000 files, 500 MB. */
const SHAPE = { target: { big: 2000, bigBytes: 7.5e6, small: 30_000 }, node_modules: { big: 0, bigBytes: 0, small: 20_000 } } as const;
const GEN = `import { mkdirSync, writeFileSync } from 'node:fs';
const which = process.argv[2];
const shape = ${JSON.stringify(SHAPE)}[which];
const big = Buffer.alloc(shape.bigBytes || 1, 7);
const small = Buffer.alloc(which === 'target' ? 4096 : 25_000, 3);
for (let i = 0; i < shape.big; i++) { const d = which + '/debug/deps/' + (i % 50); mkdirSync(d, { recursive: true }); writeFileSync(d + '/lib' + i + '.rlib', big); }
for (let i = 0; i < shape.small; i++) { const d = which + '/' + (which === 'target' ? 'debug/incremental/' : 'pkg') + (i % 400); mkdirSync(d, { recursive: true }); writeFileSync(d + '/f' + i, small); }
`;
const TARGET: Product = { name: 'target', path: 'target', key: ['gen.lock'], key_values: [], build: 'node gen.mjs target' };
const MODULES: Product = { name: 'node_modules', path: 'node_modules', key: ['gen.lock'], key_values: [], build: 'node gen.mjs node_modules' };
const fileCount = (dir: string): number => {
  let n = 0;
  const walk = (at: string): void => { for (const e of readdirSync(at, { withFileTypes: true })) { if (e.isDirectory()) walk(join(at, e.name)); else n++; } };
  try { walk(dir); } catch { return -1; }
  return n;
};

describe(`${AC8} placing products in a new worktree stays within its budget`, () => {
  it(`${AC8} placing a 15 GB target and a 500 MB node_modules in a new worktree takes under ${LIMIT_MS / 1000} s`, async (ctx) => {
    const problem = environmentProblem();
    if (problem) {
      console.log(`AC8 placement time: not measured: ${problem}`);
      ctx.skip(`INCONCLUSIVE (not measured: ${problem})`);
    }
    if (hostFree() < 60 * GB) ctx.skip(`INCONCLUSIVE (not measured): the host disk has ${gb(hostFree())} free, under the 60 GB this run needs`);
    const w = new World({ gb: 80 });
    try {
      await w.startHub();
      const repo = makeRepo(w, 'shop', { 'gen.lock': 'gen 1\n', 'gen.mjs': GEN, '.gitignore': 'target/\nnode_modules/\n', '.deepbuild/done.yaml': doneYaml([TARGET, MODULES]) });
      w.trust(repo);
      const s0 = w.session(repo);
      await s0.start();
      await s0.prompt('Build it.');
      await waitBuilt(w, [TARGET, MODULES], { ms: 3_600_000 });
      const want = { target: SHAPE.target.big + SHAPE.target.small, node_modules: SHAPE.node_modules.small };
      const runs: number[] = [];
      for (let i = 1; i <= RUNS; i++) {
        const at = join(w.dir, `wt-${i}`);
        w.trust(at);
        worktree(w, repo, `wt-${i}`);
        const t0 = performance.now();
        await w.session(at).start();
        // In place when the session start returns, or at the start of the first reading that finds every file.
        let ms = performance.now() - t0;
        for (let first = true; ; first = false) {
          const mark = performance.now() - t0;
          if (fileCount(join(at, 'target')) === want.target && fileCount(join(at, 'node_modules')) === want.node_modules) { if (!first) ms = mark; break; }
          if (mark > 120_000) expect.fail(`wt-${i}: the products weren't in place 120 s after its session started (target ${fileCount(join(at, 'target'))} of ${want.target} files, node_modules ${fileCount(join(at, 'node_modules'))} of ${want.node_modules})`);
        }
        runs.push(ms);
        console.log(`AC8 wt-${i}: 15 GB target and 500 MB node_modules in place ${ms.toFixed(0)} ms after its session started`);
      }
      const late = environmentProblem();
      if (late) ctx.skip(`INCONCLUSIVE (reading only: ${late}): ${runs.map((r) => r.toFixed(0)).join(', ')} ms`);
      judge(ctx, 'AC8 placing a 15 GB target and a 500 MB node_modules, ms', runs, LIMIT_MS);
    } finally {
      await w.close();
    }
  }, 2 * 3_600_000);

  it(`${AC8} the perf lane has a task naming #1017, valid against the merge base's budgets, and it runs`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string; changeReason?: string }[] };
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${BASE}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => /#1017\b/.test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`));
    expect(task, 'benchmarks/budgets.json must have a task whose reason names issue #1017, timing a placement against the merge base').toBeDefined();
    const [cmd, ...args] = task!.command;
    const r = spawnSync(cmd === 'node' ? NODE : cmd!, args, { cwd: REPO, encoding: 'utf8', timeout: 1_800_000 });
    expect(r.status, `${task!.command.join(' ')} runs and exits 0: ${String(r.stderr).slice(-1500)}`).toBe(0);
  }, 2_400_000);
});
