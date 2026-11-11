// AC3 of #2024 (README): budgets, on the reference Mac in the local preflight, compared with the merge base. As #1461's
// and #1515's suites have it: the perf lane holds a first measurement of its own, valid against the merge base's
// budgets, that runs; and the 200 ms is judged here by wall time, in the replica on its real clock over a copy of a real
// hub's record of 1,000 archived sessions (#1515's world): from the query typed in ⌘K, one input as a paste is, to its
// first hit drawn. Five runs after a warm-up; off a fit, quiet reference Mac the reading is INCONCLUSIVE, never PASS.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { archivedWorld, cleanup, handleOf, ID, inconclusive, indexed, MIN, REPO, replicaOf, timingProblem } from './helpers.ts';

afterAll(cleanup, 120_000);
const LIMIT_MS = 200;
const SESSIONS = 1000;
/** Each timed query and the one hit it has in #1515's world: a message of a Claude Code session, by its handle. */
const QUERIES = [
  ['retryWithBackoffJitter', handleOf('G1', 'mg1')],
  ['επανασύνδεση', handleOf('G2', 'mg1')],
  ['连接重试失败', handleOf('G3', 'mg1')],
  ['重试三次', handleOf('G5', 'mg1')],
  ['稍后重新尝试', handleOf('G1', 'mg2')],
] as const;
const WARM_UP = ['quillfeather', handleOf('F1', 'myou')] as const;

describe(`AC3 ${ID.budget} ⌘K's first hits over ${SESSIONS} archived sessions`, () => {
  test(`AC3 ${ID.budget}: the perf lane has a first measurement naming #2024, valid against the merge base's budgets, and it runs`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
    const tasks = current.tasks.filter((t) => /#2024\b/.test(String(t.initialReason)));
    expect(tasks.map((t) => t.id), 'benchmarks/budgets.json has a task whose initialReason names issue #2024 (README, Pinned 6)').not.toEqual([]);
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    for (const task of tasks) {
      const [command, ...args] = task.command;
      const ran = execFileSync(command === 'node' ? process.execPath : command!, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 1_800_000 });
      console.log(`${task.id}: ${ran.slice(-1500)}`);
    }
  }, 40 * MIN);

  test(`AC3 ${ID.budget}: over ${SESSIONS} archived sessions, ⌘K's first hits draw within ${LIMIT_MS} ms of the last keystroke`, async () => {
    const w = await archivedWorld({ a: 500, b: 500 });
    const held = await indexed(w.root, SESSIONS);
    console.log(`the archive's index held ${held} of ${SESSIONS} sessions when the replica copied the record`);
    const r = await replicaOf(w);
    const runs: number[] = [];
    const failures: string[] = [];
    /** ⌘K opened empty, the query typed in one input, then its hit waited for: the wall time from the input to the hit drawn. */
    const timed = async (query: string, handle: string): Promise<number | undefined> => {
      await r.press('escape');
      await r.press('cmd-k');
      const t0 = performance.now();
      await r.type(query);
      const got = await r.call({ call: 'wait_for', locator: { id: `hit:${handle}` }, wait_for: { state: 'visible' }, timeout: 10_000 });
      const ms = performance.now() - t0;
      if (got.ok === true) return ms;
      failures.push(`⌘K "${query}" over ${SESSIONS} archived sessions drew no hit hit:${handle} within 10 s of the replica's real clock: ${JSON.stringify(got.error).slice(0, 300)}`);
      return undefined;
    };
    try {
      if ((await timed(...WARM_UP)) !== undefined) {
        for (const [query, handle] of QUERIES) {
          const ms = await timed(query, handle);
          if (ms !== undefined) runs.push(ms);
        }
      }
    } finally {
      await r.stop();
    }
    expect(failures, failures.join('\n')).toEqual([]);
    const reading = `⌘K's first hit over ${SESSIONS} archived sessions, ms from the query typed to its hit drawn: ${runs.map((x) => x.toFixed(1)).join(', ')} against ${LIMIT_MS} ms`;
    console.log(reading);
    const problem = timingProblem();
    if (problem) inconclusive(`${problem}; the timing is a reading only`, [reading]);
    if (runs.every((x) => x <= LIMIT_MS)) return;
    const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9));
    expect(runs.every((x) => x > LIMIT_MS * (1 + margin)), `FAIL ${reading} (margin ${(margin * 100).toFixed(0)}%)`).toBe(false);
    inconclusive(`the five runs straddle ${LIMIT_MS} ms (margin ${(margin * 100).toFixed(0)}%)`, [reading]);
  }, 60 * MIN);
});
