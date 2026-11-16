// AC10: budgets, on the reference Mac in the local preflight, compared with the merge base: a source call adds under
// 5 ms beyond the network; a store query over 100,000 rows takes under 10 ms at p95; schedules fire within 1 s; each
// plug-in's store stays within its declared quota.
//
// A blind redraft of tests/acceptance/365/budgets.test.ts (#1830): every timing run reads the one-minute load average
// (`os.loadavg()[0]`) at its start and at its end, and judgeLimit gets those readings as `loads`, one { start, end }
// per run in the runs' order, as the design's timing rule says (a loaded run counts neither way).
//
// Split as #16's and #761's budgets are (design: Every task carries its own budgets):
// - The merge-base comparison is the perf lane's (scripts/perf.mjs, benchmarks/budgets.json): the three timings each
//   have a task there, and the budgets are valid against the merge base's, so the preflight compares this change's
//   p50 with the merge base's on the same work.
// - The issue's numbers are judged here, five runs after a warm-up, by the repo's judgeLimit: PASS when all five are
//   within the limit, FAIL when all five are over it by more than the margin, INCONCLUSIVE otherwise, off a reference
//   Mac (mains power, Low Power Mode off, thermal state nominal), or when the load at any run's start or end is above
//   the core count or can't be read. Only PASS passes; FAIL fails; INCONCLUSIVE (or BLOCKED) prints its readings and
//   skips as INCONCLUSIVE with judgeLimit's reason, never passed. These run on the real clock, with no tick: the
//   hub's own timer fires the schedule.
// - As in the first draft, each timing skips as INCONCLUSIVE before any work when this machine can't count a run
//   now: judgeLimit, given five empty runs with the load read at each one's start and end, reads anything but PASS
//   off a fit reference Mac or under load. Past that gate, the five real runs are judged with their own loads.
// - A schedule's run is one firing: from its slot to its job's start. The load is read when the test starts the host
//   and just before and just after each one-second poll of the job's report. A firing's start reading is the last one
//   taken at or before the earliest moment its slot can have been (the poll before the one that saw it began, less
//   its lateness), and its end reading is the one just after the poll that saw it.
// - The quota isn't a timing: it is checked on every machine.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, type TestContext } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import {
  grantFor, installAndLoad, json, KEY, MARKET, MARKET_ID, marketPackage, memoryStore, openHost, openWorld, pkg, PRICE, provider, REPO, report,
  routedClient, send, sleep, TALLY_ID, YOU, type Clock,
} from '../365/helpers.ts';

/** The perf lane's tasks for this issue's three timings (names from the first draft; its README, AC10). */
const TASKS = ['extension-source-call', 'extension-store-query', 'extension-schedule-fire'];
const SOURCE_MS = 5;
const QUERY_P95_MS = 10;
const FIRE_MS = 1_000;
const ROWS = 100_000;

/** The one-minute load average at a run's start and at its end. */
interface Load { start: number; end: number }
interface Verdict { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string }
interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown>; loads: Load[] }): Verdict;
}
const benchmark = () => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;
/** The real clock: these timings run on it. */
const realClock: Clock = { now: Date.now, set: () => { throw Error('the real clock is not set'); } };
const oneMinuteLoad = (): number => loadavg()[0]!;

/** Five timed runs, each with the one-minute load read just before it starts and just after it ends. */
async function fiveRuns(run: () => Promise<number>): Promise<{ runs: number[]; loads: Load[] }> {
  const runs: number[] = [];
  const loads: Load[] = [];
  for (let i = 0; i < 5; i++) {
    const start = oneMinuteLoad();
    runs.push(await run());
    loads.push({ start, end: oneMinuteLoad() });
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
    console.log(`AC10 INCONCLUSIVE: ${what} not timed: ${now.reason}`);
    ctx.skip(`INCONCLUSIVE: ${now.reason}`);
  }
}

/** judgeLimit on the five runs and their loads: PASS passes, FAIL fails, anything else skips as INCONCLUSIVE. */
async function judged(ctx: TestContext, what: string, limit: number, { runs, loads }: { runs: number[]; loads: (Load | undefined)[] }): Promise<void> {
  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const result = judgeLimit({ limit, runs, fingerprint: machine, loads: loads as Load[] });
  const shownLoads = loads.map((l) => (l ? `${l.start.toFixed(1)}/${l.end.toFixed(1)}` : 'unread')).join(', ');
  const shown = `${what}: ${runs.map((r) => r.toFixed(2)).join(', ')} against ${limit}, one-minute load at each run's start and end ${shownLoads}, on ${String(machine.model)} macOS ${String(machine.macosBuild)}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  console.log(`AC10 ${shown}`);
  expect(result.status, `FAIL ${shown}`).not.toBe('FAIL');
  if (result.status !== 'PASS') ctx.skip(`INCONCLUSIVE ${shown}`);
}
const p95 = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]!; };
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

async function tally(probe: Record<string, unknown>): Promise<ExtensionHost> {
  const w = await openWorld(realClock);
  const h = await openHost(w, { secrets: memoryStore(), http: routedClient({}).client });
  await installAndLoad(h, await pkg('tally', probe), undefined);
  return h;
}
const callTally = async (h: ExtensionHost, action: string, input: unknown) => {
  const r = await h.callAction({ action, target: { handle: `ext:${TALLY_ID}`, version: '1.0.0' }, input, caller: YOU });
  if (r.status !== 'done') throw Error(`${action}: ${JSON.stringify(r)}`);
  return r.output as Record<string, unknown>;
};

describe('AC10 #365.db4ac3e6 Budgets, on the reference Mac in the local preflight, compared with the merge base: a source call adds under 5 ms beyond the network; a store query over 100,000 rows takes under 10 ms at p95; schedules fire within 1 s; each plug-in\'s store stays within its declared quota', () => {
  it('AC10 the perf lane has a task for each timing, and the budgets are valid against the merge base\'s', async () => {
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
    expect(TASKS.filter((t) => !current.tasks.some((x) => x.id === t)), 'timings with no perf-lane task to compare with the merge base').toEqual([]);
  });

  it('AC10 a source call adds under 5 ms beyond the network (five runs of 20 calls after a warm-up)', async (ctx) => {
    await onReference(ctx, 'a source call');
    const api = await provider(realClock, () => json({ price: 187.25 }));
    const routes = { [MARKET]: api };
    const w = await openWorld(realClock);
    const h = await openHost(w, { secrets: memoryStore(), http: routedClient(routes).client });
    await installAndLoad(h, await marketPackage({ watch: false, cadence: { cron: '0 0 1 1 *' }, freshFor: 1, quota: { per_minute: 1_000_000, per_day: 10_000_000 } }), grantFor(MARKET));
    await h.enterSecret(YOU, MARKET_ID, 'market_key', KEY);
    const once = async (): Promise<number> => {
      const hub: number[] = [];
      const net: number[] = [];
      for (let i = 0; i < 20; i++) {
        await sleep(2);
        let t = performance.now();
        const r = await h.readSource(PRICE);
        hub.push(performance.now() - t);
        if (r.status !== 'reading') throw Error(`the price read: ${JSON.stringify(r)}`);
        t = performance.now();
        await send(routes, { url: `https://${MARKET}/q`, method: 'GET', headers: { 'x-api-key': KEY } });
        net.push(performance.now() - t);
      }
      return Math.max(0, mean(hub) - mean(net));
    };
    await once();
    await judged(ctx, 'a source call beyond the network (ms)', SOURCE_MS, await fiveRuns(once));
  }, 300_000);

  it('AC10 a store query over 100,000 rows takes under 10 ms at p95 (five runs of 200 lookups after a warm-up)', async (ctx) => {
    await onReference(ctx, 'a store query');
    const h = await tally({ quotaBytes: 1_000_000_000 });
    for (let from = 0; from < ROWS; from += 1_000) {
      const out = await callTally(h, 'ext.tally.put_batch', { from, count: 1_000, size: 16 });
      if (out.taken !== 1_000) throw Error(`seeding the store at ${from}: ${JSON.stringify(out)}`);
    }
    let seed = 0x365;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed; };
    const once = async (): Promise<number> => {
      const keys = Array.from({ length: 200 }, () => `k${rand() % ROWS}`);
      const out = await callTally(h, 'ext.tally.lookup', { keys });
      if (out.found !== keys.length) throw Error(`lookups found ${String(out.found)} of ${keys.length}`);
      return p95(out.ms as number[]);
    };
    await once();
    await judged(ctx, `a store query over ${ROWS} rows, p95 (ms)`, QUERY_P95_MS, await fiveRuns(once));
  }, 900_000);

  it('AC10 schedules fire within 1 s: a five-second schedule\'s job starts within 1 s of its slot (five firings after a warm-up)', async (ctx) => {
    await onReference(ctx, 'a schedule firing');
    // The load, read when the host starts and just before and just after each poll's report, with when it was read.
    const read = () => ({ at: Date.now(), load: oneMinuteLoad() });
    const started = read();
    const h = await tally({ quotaBytes: 1_000_000, cadence: { every: 5_000 } });
    let late: number[] = [];
    const polls: { before: ReturnType<typeof read>; after: ReturnType<typeof read> }[] = [];
    /** For each firing, the poll that first saw it. */
    const seenAt: number[] = [];
    const end = Date.now() + 90_000;
    while (late.length < 6 && Date.now() < end) {
      await sleep(1_000);
      const before = read();
      late = (await report<{ late: number[] }>(h, 'ext.tally.report')).late;
      polls.push({ before, after: read() });
      while (seenAt.length < late.length) seenAt.push(polls.length - 1);
    }
    expect(late.length, `firings of the five-second schedule in 90 s: ${JSON.stringify(late)}`).toBeGreaterThanOrEqual(6);
    // A firing the poll before didn't see started after that poll's `before` reading, and its slot was its lateness
    // before its start: its run's start reading is the last at or before that, its end the `after` of the poll that saw it.
    const readings = [started, ...polls.flatMap((p) => [p.before, p.after])];
    const loadOf = (k: number): Load | undefined => {
      const seen = seenAt[k]!;
      const earliestSlot = (seen > 0 ? polls[seen - 1]!.before.at : started.at) - Math.max(0, late[k]!);
      const start = readings.filter((r) => r.at <= earliestSlot).at(-1);
      return start && { start: start.load, end: polls[seen]!.after.load };
    };
    const firings = [1, 2, 3, 4, 5];
    await judged(ctx, 'a schedule\'s lateness past its slot (ms)', FIRE_MS, { runs: firings.map((k) => Math.max(0, late[k]!)), loads: firings.map(loadOf) });
  }, 180_000);

  it('AC10 a plug-in\'s store stays within its declared quota: puts past 4,096 bytes are refused, naming the quota, and the store holds no more', async () => {
    const h = await tally({ quotaBytes: 4_096 });
    const out = await callTally(h, 'ext.tally.put_batch', { from: 0, count: 100, size: 100 });
    const taken = out.taken as number;
    const itemBytes = JSON.stringify({ n: 99, pad: 'x'.repeat(100) }).length;
    expect(taken, `items the store took against a 4,096-byte quota (each at least ${itemBytes} bytes): ${JSON.stringify(out)}`).toBeLessThanOrEqual(Math.floor(4_096 / itemBytes));
    expect(taken, 'the store took items up to its quota').toBeGreaterThan(0);
    expect(String(out.refusal), 'the refusal of a put past the quota').toMatch(/quota/i);
    const keys = Array.from({ length: 100 }, (_, n) => `k${n}`);
    const held = await callTally(h, 'ext.tally.lookup', { keys });
    expect(held.found, 'items the store holds').toBe(taken);
  }, 120_000);
});
