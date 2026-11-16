// AC18's timings: budgets on the reference Mac in the local preflight, compared with the merge base. The sizes (the
// day's batch files, the record's growth) are deterministic and are judged on every machine in
// tests/acceptance/262/day.test.ts.
//
// A blind redraft of tests/acceptance/262/budgets.test.ts (#1830): every timing run reads the one-minute load average
// (`os.loadavg()[0]`) at its start and at its end, and judgeLimit gets those readings as `loads`, one { start, end }
// per run in the runs' order, as the design's timing rule says (a loaded run counts neither way).
//
// Split as #365's and #761's budgets are (design: Every task carries its own budgets):
// - The merge-base comparison is the perf lane's (scripts/perf.mjs, benchmarks/budgets.json): each timing has a task
//   there (reading-batch-refresh, reading-value-at-position), and the budgets are valid against the merge base's, so
//   the preflight compares this change's p50 with the merge base's on the same work.
// - The issue's numbers are judged here, five runs after a warm-up, by the repo's judgeLimit: PASS when all five are
//   within the limit, FAIL when all five are over it by more than the margin, INCONCLUSIVE otherwise, off a reference
//   Mac (mains power, Low Power Mode off, thermal state nominal), or when the load at any run's start or end is above
//   the core count or can't be read. Only PASS passes; FAIL fails; INCONCLUSIVE (or BLOCKED) prints its readings and
//   skips as INCONCLUSIVE with judgeLimit's reason, never passed. These run on the real clock.
// - As in the first draft, each timing skips as INCONCLUSIVE before any work when this machine can't count a run
//   now: judgeLimit, given five empty runs with the load read at each one's start and end, reads anything but PASS
//   off a fit reference Mac or under load. Past that gate, the five real runs are judged with their own loads.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, type TestContext } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import { API, batches, metricsApi, named, openHost, openWorld, pkg, installAndLoad, realClock, REPO, routedClient, seriesOf, sleep, type MetricsProbe, type World } from '../262/helpers.ts';

const TASKS = ['reading-batch-refresh', 'reading-value-at-position'];
const LIMIT_MS = 1;
const SERIES = 500;
const HANDLES = Object.keys(named(SERIES, () => 0)).map((s) => `reading:ext.shop.fleet#${s}`);

/** The one-minute load average at a run's start and at its end. */
interface Load { start: number; end: number }
interface Verdict { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string }
interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: Load[] }): Verdict;
}
const benchmark = () => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;

/** Five timed runs, each with the one-minute load read just before it starts and just after it ends. */
async function fiveRuns(run: () => Promise<number>): Promise<{ runs: number[]; loads: Load[] }> {
  const runs: number[] = [];
  const loads: Load[] = [];
  for (let i = 0; i < 5; i++) {
    const start = loadavg()[0]!;
    runs.push(await run());
    loads.push({ start, end: loadavg()[0]! });
  }
  return { runs, loads };
}

/**
 * Skips as INCONCLUSIVE before any work when this machine can't count a run now: judgeLimit on five empty runs, each
 * with the one-minute load read at its start and its end, reads anything but PASS off a fit reference Mac or under load.
 */
async function onReference(ctx: TestContext, what: string): Promise<void> {
  const { fingerprint, judgeLimit } = await benchmark();
  const empty = await fiveRuns(async () => 0);
  const now = judgeLimit({ limit: 1, ...empty, fingerprint: fingerprint() });
  if (now.status !== 'PASS') {
    console.log(`AC18 INCONCLUSIVE: ${what} not timed: ${now.reason}`);
    ctx.skip(`INCONCLUSIVE: ${now.reason}`);
  }
}

/** judgeLimit on the five runs and their loads: PASS passes, FAIL fails, anything else skips as INCONCLUSIVE. */
async function judged(ctx: TestContext, what: string, limit: number, { runs, loads }: { runs: number[]; loads: Load[] }): Promise<void> {
  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const result = judgeLimit({ limit, runs, fingerprint: machine, loads });
  const shown = `${what}: ${runs.map((r) => r.toFixed(3)).join(', ')} against ${limit}, one-minute load at each run's start and end ${loads.map((l) => `${l.start.toFixed(1)}/${l.end.toFixed(1)}`).join(', ')}, on ${String(machine.model)} macOS ${String(machine.macosBuild)}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  console.log(`AC18 ${shown}`);
  expect(result.status, `FAIL ${shown}`).not.toBe('FAIL');
  if (result.status !== 'PASS') ctx.skip(`INCONCLUSIVE ${shown}`);
}
const pct = (xs: number[], p: number): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]!; };
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The 500-series source on the real clock, read on demand (a call every time: fresh for 1 ms). */
async function fleet(): Promise<{ w: World; h: ExtensionHost }> {
  const probe: MetricsProbe = {
    sources: [{ name: 'ext.shop.fleet', series: true, quota: { per_minute: 1_000_000, per_day: 100_000_000 }, freshFor: 1 }],
    views: [{ name: 'ext.shop.fleet', binds: HANDLES }],
  };
  const api = await metricsApi(realClock, { 'ext.shop.fleet': (n) => seriesOf(named(SERIES, (i) => ((n * 31 + i * 7) % 1000) / 10)) });
  const w = await openWorld(realClock);
  const h = await openHost(w, routedClient({ [API]: api }));
  await installAndLoad(h, await pkg('shop', probe));
  return { w, h };
}
async function land(h: ExtensionHost): Promise<void> {
  await sleep(2);
  const r = await h.readSource('ext.shop.fleet');
  if (r.status === 'failed' || r.status === 'BLOCKED') throw Error(`the fleet call made no batch: ${JSON.stringify(r)}`);
}

describe('AC18 #262.7859de09 Budgets, on the reference Mac in the local preflight, compared with the merge base: the 500-series day\'s batch files sum to under 60 MB of file bytes (4,320,000 values at 12 bytes is 51.84 MB); its 8,640 batch and 1,464 rollup events, with their indexes, add under 5 MB to the record, the driver\'s own events counted apart; a landed batch refreshes its 500 bound values in under 1 ms in all; a value at a past log position resolves in under 1 ms at p50, with p95 reported', () => {
  it('AC18 the perf lane has a task for each timing, and the budgets are valid against the merge base\'s', async () => {
    const { validateBudgets } = await benchmark();
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string }[] };
    let baseBudgets: unknown;
    try {
      const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      baseBudgets = JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    } catch (e) {
      throw Error(`BLOCKED: no merge base to compare with (git merge-base HEAD origin/main in ${REPO}): ${(e as Error).message.split('\n')[0]}`);
    }
    validateBudgets(current, baseBudgets);
    expect(TASKS.filter((x) => !current.tasks.some((y) => y.id === x)), 'timings with no perf-lane task to compare with the merge base').toEqual([]);
  });

  it('AC18 a landed batch refreshes its 500 bound values in under 1 ms in all (five runs of 20 batches after a warm-up)', async (ctx) => {
    await onReference(ctx, 'a landed batch\'s refresh');
    const { h } = await fleet();
    const once = async (): Promise<number> => {
      const ms: number[] = [];
      for (let i = 0; i < 20; i++) {
        await land(h);
        const start = performance.now();
        const values = await h.boundValues(HANDLES);
        ms.push(performance.now() - start);
        if (values.length !== SERIES || values.some((v) => v.status !== 'reading')) throw Error(`the 500 bound values after a batch landed: ${JSON.stringify(values.slice(0, 3))} …`);
      }
      return mean(ms);
    };
    await once();
    await judged(ctx, 'a landed batch\'s 500 bound values refreshed, in all (ms)', LIMIT_MS, await fiveRuns(once));
  }, 600_000);

  it('AC18 a value at a past log position resolves in under 1 ms at p50, with p95 reported (five runs of 200 over 360 batches after a warm-up)', async (ctx) => {
    await onReference(ctx, 'a value at a past log position');
    const { w, h } = await fleet();
    for (let i = 0; i < 360; i++) await land(h);
    const positions = (await batches(w, 'ext.shop.fleet')).map((e) => e.log_pos);
    let seed = 0x262;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    const p95s: number[] = [];
    const once = async (): Promise<number> => {
      const ms: number[] = [];
      for (let i = 0; i < 200; i++) {
        const pin = positions[rand() % (positions.length - 1)]!;
        const handle = HANDLES[rand() % SERIES]!;
        const start = performance.now();
        const [v] = await h.boundValues([handle], { log_pos: pin });
        ms.push(performance.now() - start);
        if (v?.status !== 'reading') throw Error(`${handle} at log position ${pin}: ${JSON.stringify(v)}`);
      }
      p95s.push(pct(ms, 0.95));
      return pct(ms, 0.5);
    };
    await once();
    p95s.length = 0;
    const timed = await fiveRuns(once);
    console.log(`AC18 a value at a past log position, p95 (ms): ${p95s.map((x) => x.toFixed(3)).join(', ')}`);
    await judged(ctx, 'a value at a past log position, p50 (ms)', LIMIT_MS, timed);
  }, 600_000);
});
