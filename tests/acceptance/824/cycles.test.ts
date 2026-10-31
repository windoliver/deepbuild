// #824 AC1, what holds on any machine: the benchmark is in the local preflight, its cycles are the issue's and really
// reach the hub (read back from the record, never from the benchmark's word), its readings are real and read every 100
// cycles after a 100-cycle warm-up, and a platform that can't force a full collection or read resident memory is
// BLOCKED, never PASS. The budget itself is budgets.long.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AC1, bench, BENCH_PATH, cleanup, lineFrom, MINUTE, recorded, REPO, shown, worded, type RecordedEvent } from './helpers.ts';

afterEach(cleanup, MINUTE);

const CYCLES = 300;
const sessionOf = (e: RecordedEvent) => e.session_id ?? e.session;

describe(`${AC1} Over 5,000 cycles after warm-up, the hub's retained heap grows under 1 MB and its resident memory under 10 MB, compared with the merge base, on the reference Mac: the benchmark`, () => {
  it(`${AC1} the local preflight runs it: a lane in scripts/lanes.mjs or a task in benchmarks/budgets.json names ${BENCH_PATH}`, async () => {
    const lanes = (await import(join(REPO, 'scripts/lanes.mjs'))) as { checks: unknown[]; releaseLanes: unknown[] };
    const budgets = readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8');
    const named = [JSON.stringify(lanes.checks), JSON.stringify(lanes.releaseLanes), budgets].some((text) => text.includes(BENCH_PATH));
    expect(named, `no lane or perf task runs ${BENCH_PATH}`).toBe(true);
  });

  it(`${AC1} ${CYCLES} cycles after a 100-cycle warm-up: heap and resident memory read every 100 cycles, the growth per 1,000 cycles computed from them`, async () => {
    const r = await bench({ cycles: CYCLES });
    const line = lineFrom(r);
    expect([line.cycles, line.warmup, line.every], `cycles, warm-up, read every: ${shown(r)}`).toEqual([CYCLES, 100, 100]);
    expect(line.readings.map((x) => x.cycle), 'a reading right after warm-up, then one every 100 cycles').toEqual([0, 100, 200, 300]);
    for (const x of line.readings) {
      expect(Number.isSafeInteger(x.heapBytes) && x.heapBytes >= 1_000_000, `a hub's retained heap, in bytes: ${JSON.stringify(x)}`).toBe(true);
      expect(Number.isSafeInteger(x.rssBytes) && x.rssBytes >= x.heapBytes, `its resident memory, in bytes, holds the heap: ${JSON.stringify(x)}`).toBe(true);
    }
    expect(new Set(line.readings.map((x) => x.heapBytes)).size, 'the heap readings are measured, not one number repeated').toBeGreaterThan(1);
    const [first, last] = [line.readings[0]!, line.readings.at(-1)!];
    expect(line.heapGrowthBytes).toBe(last.heapBytes - first.heapBytes);
    expect(line.rssGrowthBytes).toBe(last.rssBytes - first.rssBytes);
    expect(Math.abs(line.heapGrowthPer1000Bytes - (line.heapGrowthBytes * 1000) / CYCLES), 'the reading is the growth per 1,000 cycles').toBeLessThanOrEqual(1);
    expect(Math.abs(line.rssGrowthPer1000Bytes - (line.rssGrowthBytes * 1000) / CYCLES), 'the reading is the growth per 1,000 cycles').toBeLessThanOrEqual(1);
  }, 30 * MINUTE);

  it(`${AC1} each cycle reached the hub: the record holds a session started and ended, ten tool calls with both hooks, an ask created and answered, a check run and a promise armed and woken`, async () => {
    const r = await bench({ cycles: CYCLES });
    lineFrom(r);
    const events = await recorded(r.home);
    const total = 100 + CYCLES;
    const count = (kind: string) => events.filter((e) => e.kind === kind).length;
    const ended = new Set(events.filter((e) => e.kind === 'session.end').map(sessionOf));
    expect(ended.size, 'every cycle ended a session of its own').toBe(total);
    for (const kind of ['session.start', 'promise.set', 'promise.woken']) {
      const sessions = new Set(events.filter((e) => e.kind === kind).map(sessionOf));
      expect([...ended].filter((s) => !sessions.has(s)), `every ended session has its ${kind}`).toEqual([]);
    }
    for (const kind of ['tool.before', 'tool.after']) {
      const perSession = new Map<unknown, number>();
      for (const e of events) if (e.kind === kind) perSession.set(sessionOf(e), (perSession.get(sessionOf(e)) ?? 0) + 1);
      expect([...ended].filter((s) => perSession.get(s) !== 10), `every ended session has exactly ten ${kind}`).toEqual([]);
    }
    for (const kind of ['ask.created', 'ask.answered', 'run.finished']) {
      expect(count(kind), `${kind} once a cycle at least`).toBeGreaterThanOrEqual(total);
    }
  }, 30 * MINUTE);

  it.each(['churn-no-full-collection', 'churn-no-resident-read'])(`${AC1} BLOCKED, never PASS, on a platform that can't take the reading: %s`, async (plant) => {
    const r = await bench({ cycles: 100, plant });
    expect(r.code, `a BLOCKED run doesn't exit 0: ${shown(r)}`).not.toBe(0);
    expect(worded(r, 'BLOCKED'), `it prints a line starting BLOCKED: ${shown(r)}`).toBeDefined();
    expect(r.words, 'it never says PASS').not.toMatch(/\bPASS\b/);
    expect(worded(r, 'FAIL'), 'nothing was measured, so nothing failed').toBeUndefined();
  }, 15 * MINUTE);
});
