// #26.131a6956 Budgets, on the reference Mac in the local preflight, compared with the merge base: status and
// open-item calls answer in under 100 ms at p95 and search over 30 days in under 300 ms; the server stays under 80 MB.
// The merge-base comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json), as #16 and #24 left
// it. The issue's numbers are judged by the design's rule for timing results (five runs after a warm-up; PASS when
// all are within the limit, FAIL when all are over it by more than the margin, otherwise INCONCLUSIVE), and count
// only on a reference Mac on mains power, Low Power Mode off and no thermal warning; anywhere else the test is
// skipped with the reason, never passed. "The server" is the agent's `deep mcp`, measured by its resident memory.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  agentWorld, callTool, cleanup, environmentProblem, judge, NODE, p95, REPO, run, seedMonth, valueOf, word,
} from './helpers.ts';

afterEach(cleanup, 30_000);

const problem = environmentProblem();
const TASK = 'deep-mcp-30d';

it(`#26.131a6956 the perf lane has the task ${TASK}, a #26 first measurement, valid against the merge base's budgets, and it runs`, async () => {
  const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
  const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
  validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
  const task = current.tasks.find((t) => t.id === TASK);
  expect(task, `benchmarks/budgets.json has a task ${TASK}`).toBeDefined();
  expect(String(task!.initialReason), `${TASK} says why, naming issue #26`).toMatch(/#26\b/);
  const [command, ...args] = task!.command;
  const r = await run(command === 'node' ? NODE : command!, args, { timeoutMs: 600_000 });
  expect(r.code, `${task!.command.join(' ')} exits 0: ${r.stderr}`).toBe(0);
}, 600_000);

it('#26.131a6956 on the reference Mac, with 30 days in the record: status and open-item p95 under 100 ms, search under 300 ms, deep mcp under 80 MB', async (ctx) => {
  if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
  const term = word(10);
  const w = await agentWorld({ seeded: (s, _session, worktree) => seedMonth(s, worktree, term) });
  const { agent } = w;
  const rss = async (): Promise<number> => {
    const { pid } = await agent.mcpProcess();
    return Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) * 1024 / 1e6;
  };
  let item = 0;
  const once = async () => {
    const status: number[] = [];
    const items: number[] = [];
    const searches: number[] = [];
    for (let i = 0; i < 40; i++) {
      const s = await callTool(agent, 'deep_status', {});
      valueOf(s, 'deep_status');
      status.push(s.ms);
      const o = await callTool(agent, 'deep_open_item', { text: `budget item ${++item} for ${term}` });
      valueOf(o, 'deep_open_item');
      items.push(o.ms);
    }
    for (let i = 0; i < 20; i++) {
      const q = await callTool(agent, 'deep_search', { query: i % 2 ? term : `store ${i}` });
      valueOf(q, 'deep_search over 30 days');
      searches.push(q.ms);
    }
    return { status: p95(status), item: p95(items), search: p95(searches), rss: await rss() };
  };
  await once();
  const runs = [];
  for (let i = 0; i < 5; i++) runs.push(await once());
  judge(ctx, '#26 deep_status p95 (ms)', runs.map((r) => r.status), 100);
  judge(ctx, '#26 deep_open_item p95 (ms)', runs.map((r) => r.item), 100);
  judge(ctx, '#26 deep_search over 30 days p95 (ms)', runs.map((r) => r.search), 300);
  judge(ctx, '#26 deep mcp resident memory (MB)', runs.map((r) => r.rss), 80);
}, 900_000);
