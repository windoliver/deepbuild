// AC7 #1463.0c303476: budgets, on the reference Mac in the local preflight, compared with the merge base: `deep` answers
// within 100 ms over the socket on 700 rows. As #24's and #19's suites have it: the perf lane holds a first measurement
// of its own, valid against the merge base's budgets, that runs; and the 100 ms is judged here, by wall time of the real
// `deep` against a real hub holding 700 open asks. Off a fit, quiet reference Mac the reading is INCONCLUSIVE, never PASS.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { makeHome, startHub } from '../16/helpers.ts';
import { seed } from '../26/helpers.ts';
import { cleanup, countsIn, deep, ID, inconclusive, jsonRows, needBuilds, REPO, shown, timingProblem } from './helpers.ts';

afterAll(cleanup, 60_000);

const TASK = 'deep-list-700';
const ROWS = 700;
const LIMIT_MS = 100;

describe(ID.budget, () => {
  test(`${ID.budget}: the perf lane has the task ${TASK}, a first measurement naming #1463, valid against the merge base's budgets, and it runs`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
    const task = current.tasks.find((t) => t.id === TASK);
    expect(task, `benchmarks/budgets.json has a task ${TASK} (README, Pinned 12)`).toBeDefined();
    expect(String(task!.initialReason), `${TASK} says why, naming issue #1463`).toMatch(/#1463\b/);
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const [command, ...args] = task!.command;
    const ran = execFileSync(command === 'node' ? process.execPath : command!, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900_000 });
    console.log(ran.slice(-1500));
  }, 900_000);

  test(`${ID.budget}: deep answers within ${LIMIT_MS} ms over the socket on ${ROWS} rows`, async () => {
    needBuilds();
    const home = makeHome();
    // 140 sessions in 7 repos, each with five open asks (the most a session holds before its asks fold): 700 ask rows.
    await seed(home, async (s) => {
      for (let n = 0; n < 140; n++) {
        const session = `S1463-${String(n).padStart(3, '0')}`;
        await s.start(session, `/work/repo${n % 7}`);
        for (let k = 0; k < 5; k++) await s.raise(session, 'choice', `Keep store ${n}-${k} on SQLite or plain files?`);
      }
    });
    const version = (JSON.parse(readFileSync(join(REPO, 'packages/cli/package.json'), 'utf8')) as { version: string }).version;
    writeFileSync(join(home, '.deepbuild', 'setup-finished.json'), JSON.stringify({ version }));
    await startHub({ home });
    const w = { home };
    const rows = (await jsonRows(w, 'status')).rows.length;
    expect(rows, `the record gives deep at least ${ROWS} rows`).toBeGreaterThanOrEqual(ROWS);
    const once = async (): Promise<number> => {
      const t0 = performance.now();
      const r = await deep(w, []);
      const ms = performance.now() - t0;
      expect(r.code === 0 && countsIn(r.stdout).includes(ROWS), `deep answers with the list and its count, "${ROWS} asks need you": ${shown(r)}`).toBe(true);
      return ms;
    };
    console.log(`warm-up: ${(await once()).toFixed(1)} ms (discarded)`);
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(await once());
    const reading = `deep on ${rows} rows: ${runs.map((r) => r.toFixed(1)).join(', ')} ms against ${LIMIT_MS} ms`;
    console.log(reading);
    const problem = timingProblem();
    if (problem) inconclusive(`${problem}; the timing is a reading only`, [reading]);
    const spread = (Math.max(...runs) - Math.min(...runs)) / Math.min(...runs);
    if (runs.every((r) => r <= LIMIT_MS)) return;
    expect(runs.every((r) => r > LIMIT_MS * (1 + Math.max(0.05, spread))), `FAIL ${reading}`).toBe(false);
    inconclusive(`the runs straddle ${LIMIT_MS} ms within their spread`, [reading]);
  }, 900_000);
});
