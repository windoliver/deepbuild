// AC10: budgets, on the reference Mac in the local preflight, compared with the merge base: a source call adds under
// 5 ms beyond the network; a store query over 100,000 rows takes under 10 ms at p95; schedules fire within 1 s; each
// plug-in's store stays within its declared quota.
//
// Split as #16's and #761's budgets are (design: Every task carries its own budgets):
// - The merge-base comparison is the perf lane's (scripts/perf.mjs, benchmarks/budgets.json): the three timings each
//   have a task there, and the budgets are valid against the merge base's, so the preflight compares this change's
//   p50 with the merge base's on the same work.
// - The issue's numbers are judged here, five runs after a warm-up, by the repo's judgeLimit (PASS when all five are
//   within the limit, FAIL when all five are over it by more than the margin, else INCONCLUSIVE), counted only on a
//   reference Mac on mains power, Low Power Mode off and the thermal state nominal. Anywhere else the timing is a
//   reading and the test is skipped as INCONCLUSIVE, never passed. These run on the real clock, with no tick: the
//   hub's own timer fires the schedule.
// - The quota isn't a timing: it is checked on every machine.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, type TestContext } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import {
  grantFor, installAndLoad, json, KEY, MARKET, MARKET_ID, marketPackage, memoryStore, openHost, openWorld, pkg, PRICE, provider, REPO, report,
  routedClient, send, sleep, TALLY_ID, YOU, type Clock,
} from './helpers.ts';

/** The perf lane's tasks for this issue's three timings (names picked here; README, AC10). */
const TASKS = ['extension-source-call', 'extension-store-query', 'extension-schedule-fire'];
const SOURCE_MS = 5;
const QUERY_P95_MS = 10;
const FIRE_MS = 1_000;
const ROWS = 100_000;

interface Benchmark {
  validateBudgets(current: unknown, base: unknown): void;
  fingerprint(): Record<string, unknown>;
  judgeLimit(input: { limit: number; runs: number[]; fingerprint: Record<string, unknown> }): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE' | 'BLOCKED'; reason?: string };
}
const benchmark = () => import(join(REPO, 'scripts/benchmark.mjs')) as Promise<Benchmark>;
/** The real clock: these timings run on it. */
const realClock: Clock = { now: Date.now, set: () => { throw Error('the real clock is not set'); } };

/** Skips as INCONCLUSIVE off the reference Macs, before any work. */
async function onReference(ctx: TestContext): Promise<Record<string, unknown>> {
  const { fingerprint, judgeLimit } = await benchmark();
  const machine = fingerprint();
  const off = judgeLimit({ limit: 1, runs: [0, 0, 0, 0, 0], fingerprint: machine });
  if (off.status === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE: ${off.reason}`);
  return machine;
}
async function judged(ctx: TestContext, what: string, limit: number, runs: number[], machine: Record<string, unknown>): Promise<void> {
  const { judgeLimit } = await benchmark();
  const result = judgeLimit({ limit, runs, fingerprint: machine });
  const shown = `${what}: ${runs.map((r) => r.toFixed(2)).join(', ')} against ${limit} on ${String(machine.model)} macOS ${String(machine.macosBuild)}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`;
  console.log(`AC10 ${shown}`);
  if (result.status === 'BLOCKED') throw Error(`BLOCKED ${shown}`);
  expect(result.status, `FAIL ${shown}`).not.toBe('FAIL');
  if (result.status === 'INCONCLUSIVE') ctx.skip(`INCONCLUSIVE ${shown}`);
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
    const machine = await onReference(ctx);
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
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(await once());
    await judged(ctx, 'a source call beyond the network (ms)', SOURCE_MS, runs, machine);
  }, 300_000);

  it('AC10 a store query over 100,000 rows takes under 10 ms at p95 (five runs of 200 lookups after a warm-up)', async (ctx) => {
    const machine = await onReference(ctx);
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
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) runs.push(await once());
    await judged(ctx, `a store query over ${ROWS} rows, p95 (ms)`, QUERY_P95_MS, runs, machine);
  }, 900_000);

  it('AC10 schedules fire within 1 s: a five-second schedule\'s job starts within 1 s of its slot (five firings after a warm-up)', async (ctx) => {
    const machine = await onReference(ctx);
    const h = await tally({ quotaBytes: 1_000_000, cadence: { every: 5_000 } });
    let late: number[] = [];
    const end = Date.now() + 90_000;
    while (late.length < 6 && Date.now() < end) {
      await sleep(1_000);
      late = (await report<{ late: number[] }>(h, 'ext.tally.report')).late;
    }
    expect(late.length, `firings of the five-second schedule in 90 s: ${JSON.stringify(late)}`).toBeGreaterThanOrEqual(6);
    await judged(ctx, 'a schedule\'s lateness past its slot (ms)', FIRE_MS, late.slice(1, 6).map((x) => Math.max(0, x)), machine);
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
