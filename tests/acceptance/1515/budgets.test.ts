// AC7 #1515.c1a2b880 Budgets, drafted, on the reference Mac in the local preflight, compared with the merge base: a
// search on a 500-session record returns in under 100 ms. A find that reads each transcript on each call fails this
// budget.
//
// The merge-base comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json), as #20's, #26's and
// #237's budgets do it: a #1515 task, a first measurement ("drafted"), valid against the merge base's budgets, that
// runs. The issue's 100 ms is judged here, by the design's rule for timing results (five runs after a warm-up; PASS
// when all are within the limit, FAIL when all are over it by more than the margin, else INCONCLUSIVE), and counts
// only on a reference Mac in a fit state (26's environmentProblem); anywhere else it is skipped as INCONCLUSIVE, never
// passed. Each timed test first needs the surface to find criterion 1's message, so at the base the deep_search one
// fails on the missing transcripts whatever the machine. Both searches are timed: deep_search's reply (from the line
// written to its reply read, in the Codex session's own agent process), and `deep find`'s wall time beyond the CLI's
// own start (`deep --version` on the same machine in the same run), so a find that scans every transcript fails too.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { childEnv, CLI, environmentProblem, judge, NODE, p95, REPO, run } from '../26/helpers.ts';
import { AC, AGENT_WORD, cleanup, COMMON_WORD, ERR, find, handleOf, makeWorld, WHOSE_WORD, type World } from './helpers.ts';

afterAll(cleanup, 60_000);

const problem = environmentProblem();
let world: Promise<World> | undefined;
const setUp = (): Promise<World> => (world ??= makeWorld());
const median = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]!; };

it(`AC7 ${AC[7]} the perf lane has a #1515 task, a first measurement, valid against the merge base's budgets, and it runs`, async () => {
  const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
  validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  const tasks = current.tasks.filter((t) => /#1515\b/.test(String(t.initialReason)));
  expect(tasks.map((t) => t.id), 'benchmarks/budgets.json has a task whose initialReason names issue #1515').not.toEqual([]);
  for (const task of tasks) {
    const [command, ...args] = task.command;
    const r = await run(command === 'node' ? NODE : command!, args, { timeoutMs: 900_000 });
    expect(r.code, `${task.id} (${task.command.join(' ')}) exits 0: ${r.stderr.slice(-2000)}`).toBe(0);
  }
}, 1_800_000);

it(`AC7 ${AC[7]} on the reference Mac, deep_search from a Codex session of repo A over the 500-session record answers in under 100 ms at p95`, async (ctx) => {
  const w = await setUp();
  const a = await w.codex('a');
  const want = handleOf('E1', 'merr');
  const first = await a.past(ERR);
  expect(first.hits.map((h) => h.source), `deep_search "${ERR}" returns ${want}, so what is timed searches past sessions: ${JSON.stringify(first.hits).slice(0, 1500)}`).toContain(want);
  if (problem) ctx.skip(`INCONCLUSIVE (not measured: ${problem})`);
  const queries = [ERR, WHOSE_WORD, COMMON_WORD, AGENT_WORD];
  const once = async (): Promise<number> => {
    const ms: number[] = [];
    for (let i = 0; i < 20; i++) ms.push((await a.past(queries[i % queries.length]!)).reply.ms);
    return p95(ms);
  };
  await once();
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) runs.push(await once());
  judge(ctx, '#1515 deep_search over 500 sessions p95 (ms)', runs, 100);
}, 900_000);

it(`AC7 ${AC[7]} on the reference Mac, deep find over the 500-session record returns in under 100 ms beyond the CLI's own start`, async (ctx) => {
  const w = await setUp();
  const want = handleOf('E1', 'merr');
  expect((await find(w, [ERR])).hits.map((h) => h.handle), `deep find "${ERR}" returns ${want}`).toContain(want);
  const once = async (): Promise<number> => {
    const finds: number[] = [];
    const starts: number[] = [];
    for (let i = 0; i < 5; i++) {
      finds.push((await find(w, [ERR])).runs.reduce((sum, r) => sum + r.ms, 0));
      starts.push((await run(NODE, [CLI, '--version'], { env: childEnv(w.home), cwd: w.repos.a.dir })).ms);
    }
    return median(finds) - median(starts);
  };
  const reading = await once();
  console.log(`#1515 deep find over 500 sessions beyond the CLI's start, a reading: ${reading.toFixed(1)} ms`);
  if (problem) ctx.skip(`INCONCLUSIVE (not measured: ${problem}; the reading above is not judged)`);
  const runs: number[] = [];
  for (let i = 0; i < 5; i++) runs.push(await once());
  judge(ctx, "#1515 deep find over 500 sessions beyond the CLI's start (ms)", runs, 100);
}, 900_000);
