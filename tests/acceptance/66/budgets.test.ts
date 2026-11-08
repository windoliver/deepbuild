// AC8: budgets, on the reference Mac in the local preflight, compared with the merge base: polling stays within each
// source's quota, and an item becomes a task within 60 s. Three parts:
// - the perf lane (scripts/benchmark.mjs, benchmarks/budgets.json) has a task naming #66, valid against the merge
//   base's budgets, and it runs: the merge-base comparison is the lane's;
// - the quota is a count, held on every machine on the controlled clock: the tracker source declares 10 calls a
//   minute, 25 issues arrive at once, and no 60 s window holds more than 10 calls to the tracker, while every issue
//   still becomes a task;
// - the 60 s is a timing, on the real clock: five issues, one at a time, each timed from when the tracker holds it to
//   when it is a task, the hub's timer ticking once a second as the hub's own does. Judged by #304's timing rule (all
//   within: PASS; all over by more than the margin: FAIL; else INCONCLUSIVE). The numbers are always printed; they
//   count only on a reference Mac in a fit state and not loaded past its core count, and anywhere else the test is
//   skipped as INCONCLUSIVE with the reading.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, type TestContext } from 'vitest';
import {
  AC8, at, grantFor, installAndLoad, memoryStore, MINUTE, openHost, openWorld, pkg, REPO, routedClient, SECOND, sleep, step, tasksOf, YOU, type Clock,
} from './helpers.ts';
import { REPO_WEB, tracker, TRACKER } from './providers.ts';
import { TRACKER_SOURCE, trackerWorld } from './worlds.ts';

const T0 = at('2026-11-02T09:00');
const LIMIT_MS = 60_000;
const RUNS = 5;
const REFERENCE_MACS = [{ model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 }, { model: 'Mac15,12', chip: 'Apple M3', gib: 16 }];
const read = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's timings are a reading only, or null on a reference Mac not loaded past its cores. */
function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  const [model, chip, gib] = [read('sysctl', '-n', 'hw.model'), read('sysctl', '-n', 'machdep.cpu.brand_string'), Math.round(Number(read('sysctl', '-n', 'hw.memsize')) / 2 ** 30)];
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${model} / ${chip} / ${gib} GiB`;
  const load = loadavg()[0]!;
  return load > cpus().length ? `load ${load.toFixed(1)} is past the ${cpus().length} cores` : null;
}
interface Task { id: string; command: string[]; initialReason?: string; changeReason?: string }

describe(`${AC8} Budgets, on the reference Mac in the local preflight, compared with the merge base: polling stays within each source's quota, and an item becomes a task within 60 s`, () => {
  it('AC8 the perf lane has a task naming #66, valid against the merge base\'s budgets, and it runs', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const task = current.tasks.find((t) => /#66\b/.test(`${t.initialReason ?? ''} ${t.changeReason ?? ''}`));
    expect(task, 'benchmarks/budgets.json has a task whose reason names issue #66, timing a work source\'s item to its task').toBeDefined();
    const [cmd, ...args] = task!.command;
    const r = spawnSync(cmd === 'node' ? process.execPath : cmd!, args, { cwd: REPO, encoding: 'utf8', timeout: 600_000 });
    expect(r.status, `${task!.command.join(' ')} runs and exits 0: ${String(r.stderr).slice(-1500)}`).toBe(0);
  }, 900_000);

  it('AC8 polling stays within the source\'s quota of 10 calls a minute, and every one of 25 issues still becomes a task', async () => {
    const { c, h, tr, handle } = await trackerWorld(T0, { probe: { quota: { per_minute: 10, per_day: 2000 } }, every: MINUTE });
    for (let n = 1; n <= 25; n++) tr.add({ n, created: T0 + MINUTE, updated: T0 + MINUTE });
    await step(h, c, T0 + MINUTE, T0 + 60 * MINUTE);
    expect((await tasksOf(h, handle)).length, 'every issue became a task').toBe(25);
    const times = tr.p.seen.map((s) => s.at).sort((a, b) => a - b);
    const most = Math.max(...times.map((t) => times.filter((u) => u >= t && u < t + MINUTE).length));
    expect(most, `the most calls to the tracker in any 60 s: ${most}`).toBeLessThanOrEqual(10);
  }, 600_000);

  it('AC8 an item becomes a task within 60 s, on the real clock, five times', async (ctx: TestContext) => {
    const real: Clock = { now: () => Date.now(), set: () => { throw Error('the real clock is not set'); } };
    const tr = await tracker(real);
    const w = await openWorld(real);
    const h = await openHost(w, { secrets: memoryStore(), http: routedClient({ [TRACKER]: tr.p }).client });
    await installAndLoad(h, await pkg('tracker'), grantFor(TRACKER));
    const handle = await h.addWorkSource(YOU, { source: TRACKER_SOURCE, scope: REPO_WEB, every: 30 * SECOND });
    let ticking = true;
    const timer = (async () => { while (ticking) { await h.tick().catch(() => undefined); await sleep(1000); } })();
    const runs: number[] = [];
    try {
      for (let n = 1; n <= RUNS; n++) {
        await sleep(1000 + Math.floor(Math.random() * 5000));
        const t0 = Date.now();
        tr.add({ n, created: t0, updated: t0 });
        for (;;) {
          if ((await tasksOf(h, handle)).some((t) => t.id === `${REPO_WEB}#${n}`)) break;
          if (Date.now() - t0 > 3 * LIMIT_MS) break;
          await sleep(200);
        }
        runs.push(Date.now() - t0);
      }
    } finally {
      ticking = false;
      await timer;
    }
    const spread = (Math.max(...runs) - Math.min(...runs)) / Math.max(Math.min(...runs), 1e-9);
    const margin = Math.max(0.05, spread);
    const text = `item to task: ${runs.map((r) => (r / 1000).toFixed(1)).join(', ')} s against ${LIMIT_MS / 1000} s (margin ${(margin * 100).toFixed(0)}%)`;
    console.log(`AC8 ${text}`);
    const problem = environmentProblem();
    if (problem) {
      ctx.skip(`INCONCLUSIVE ${problem}: ${text}`);
      return;
    }
    if (runs.every((r) => r <= LIMIT_MS)) return;
    expect(runs.every((r) => r > LIMIT_MS * (1 + margin)), `FAIL ${text}`).toBe(false);
    ctx.skip(`INCONCLUSIVE ${text}`);
  }, 900_000);
});
