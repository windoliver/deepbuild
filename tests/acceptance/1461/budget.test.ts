// AC9: budgets, on the reference Mac in the local preflight, compared with the merge base: selecting a row paints within
// 100 ms at the 95th percentile with 700 rows, with no spinner on a local read. As #1463's and #24's suites have it: the
// perf lane holds a first measurement of its own, valid against the merge base's budgets, that runs (README, Pinned 9);
// and the 100 ms is judged here, by wall time, in the replica on its real clock (`launch.clock: "real"`, each frame the
// wall time it took) over a copy of a real hub's record of 700 sessions: a press on a row, at its point, through the two
// frames the replica draws after it. Off a fit, quiet reference Mac the reading is INCONCLUSIVE, never PASS.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { percentile } from '../1551/helpers.ts';
import { cleanup, flat, ID, inconclusive, listRows, makeWorld, MIN, REPO, replicaOf, timingProblem, type SessionSpec } from './helpers.ts';

afterAll(cleanup, 60_000);
const TASK = 'app-select-700';
const ROWS = 700;
const LIMIT_MS = 100;

describe(`AC9 ${ID.budget} selecting a row with 700 rows`, () => {
  test(`AC9 ${ID.budget}: the perf lane has the task ${TASK}, a first measurement naming #1461, valid against the merge base's budgets, and it runs`, async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason?: string }[] };
    const task = current.tasks.find((t) => t.id === TASK);
    expect(task, `benchmarks/budgets.json has a task ${TASK} (README, Pinned 9)`).toBeDefined();
    expect(String(task!.initialReason), `${TASK} says why, naming issue #1461`).toMatch(/#1461\b/);
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const [command, ...args] = task!.command;
    const ran = execFileSync(command === 'node' ? process.execPath : command!, args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 1_800_000 });
    console.log(ran.slice(-1500));
  }, 40 * MIN);

  test(`AC9 ${ID.budget}: selecting a row paints within ${LIMIT_MS} ms at the 95th percentile with ${ROWS} rows, with no spinner on a local read`, async () => {
    const projects = ['shop', 'docs', 'search', 'billing', 'infra', 'mobile', 'web'];
    const specs: SessionSpec[] = Array.from({ length: ROWS }, (_, i) => ({ key: `b${i}`, project: projects[i % 7]!, title: `Task ${String(i + 1).padStart(3, '0')}` }));
    const w = await makeWorld(specs);
    const r = await replicaOf(w, { clock: 'real' });
    const runs: number[] = [];
    const out: string[] = [];
    try {
      await r.wait(1000);
      const first = await r.see();
      expect(first.rows.length, `the replica holds at least ${ROWS} rows`).toBeGreaterThanOrEqual(ROWS);
      const rows = listRows(first.snapshot).filter((n) => String(n.id).startsWith('session:')).slice(0, 10);
      expect(rows.length, 'the list draws session rows to select').toBeGreaterThanOrEqual(2);
      for (let i = 0; i < 21; i++) {
        const row = rows[i % rows.length]!;
        const [x, y, rw, rh] = row.bounds as [number, number, number, number];
        const t0 = performance.now();
        await r.clickAt([Math.round(x + rw / 2), Math.round(y + rh / 2)]);
        const ms = performance.now() - t0;
        if (i > 0) runs.push(ms);
        const after = await r.see();
        const want = String(row.id).replace(/^session:/, 'session/');
        if (after.address !== want) out.push(`a press on ${String(row.id)} selected ${String(after.address)}, not ${want}`);
        for (const n of flat(after.snapshot.tree)) if (/progress|busy|spinner/i.test(n.role) || /\bloading\b/i.test(n.name ?? '')) out.push(`selecting ${String(row.id)} draws a spinner: ${n.role} ${JSON.stringify(n.name)}`);
        await r.wait(200);
      }
    } finally {
      await r.stop();
    }
    expect(out).toEqual([]);
    const p95 = percentile(runs, 0.95);
    const reading = `selecting a row with ${ROWS} rows: p95 ${p95.toFixed(1)} ms over ${runs.length} presses (${runs.map((x) => x.toFixed(1)).join(', ')}) against ${LIMIT_MS} ms`;
    console.log(reading);
    const problem = timingProblem();
    if (problem) inconclusive(`${problem}; the timing is a reading only`, [reading]);
    expect(p95, `FAIL ${reading}`).toBeLessThanOrEqual(LIMIT_MS);
  }, 60 * MIN);
});
