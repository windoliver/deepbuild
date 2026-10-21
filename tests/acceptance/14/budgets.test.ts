// #14 AC4 and AC17: throughput, append latency, the replay of a large log and its working memory.
// Judged by the design's rule for timing results: runs after a warm-up; PASS when all are within the limit,
// FAIL when all are over it by more than the margin (the larger of 5% and the runs' spread), otherwise
// INCONCLUSIVE. Off a reference Mac (Mac15,7 or Mac15,12), on battery, with Low Power Mode on or unknown,
// or with a thermal warning, the result is a reading only and the test skips. It never passes by skipping.
// The merge-base comparison belongs to the perf lane (README: Criteria 4 and 17).
import { afterEach, describe, expect, it } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import type { RecordStore } from '../../../packages/record/src/index.ts';
import { agentStop, app, claimMade, environmentProblem, hook, judge, makeClock, removeRoots, SECOND, seqAt, sessionStart, T0, tempRoot, toolAfter, ulidAt, userAsk } from './helpers.ts';

afterEach(removeRoots, 120_000);

const FULL = process.env.DEEP_RECORD_FULL === '1';
const REPLAY_EVENTS = FULL ? 1_000_000 : 100_000;
const REPLAY_LIMIT_S = FULL ? 60 : 6;   // the issue's 60 s for a million events, scaled by the same factor
const problem = environmentProblem();

async function open(): Promise<{ record: RecordStore; clock: ReturnType<typeof makeClock> }> {
  const clock = makeClock();
  const record = await openRecord({ path: `${tempRoot()}/record.db`, now: clock.now });
  return { record, clock };
}
/** `count` stream events of one session, fired `group` at a time; returns the wall time in ms. */
async function fire(record: RecordStore, session: string, from: number, count: number, group: number): Promise<number> {
  const started = performance.now();
  for (let i = 0; i < count; i += group) {
    const batch = [];
    for (let j = i; j < Math.min(count, i + group); j++) {
      const at = from + j;
      batch.push(record.append(hook(session), toolAfter(at, 'read', [`src/${j % 500}.ts`], null, seqAt(at))));
    }
    await Promise.all(batch);
  }
  return performance.now() - started;
}

describe('AC4 writes batch in WAL mode at 5,000 events a second or more', () => {
  it('AC4 20,000 stream events, fired 200 at a time, append at 5,000/s or more on a reference Mac', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const { record, clock } = await open();
    const S = ulidAt(T0 - SECOND);
    await record.append(hook(S), sessionStart(T0 - SECOND, S));
    await record.append(hook(S), userAsk(T0, 1, 'go'));
    const warm = await fire(record, S, clock.tick(SECOND), 4000, 200);
    console.log(`warm-up: ${(4000 / (warm / 1000)).toFixed(0)} events/s (discarded)`);
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) {
      const ms = await fire(record, S, clock.tick(10 * SECOND), 4000, 200);
      runs.push(4000 / (ms / 1000));
    }
    await record.close();
    // A store that commits each event in its own transaction falls well under 5,000/s.
    judge(ctx, 'AC4 appends per second', runs, 5000, false);
  }, 300_000);
});

describe('AC17 budgets on the reference Mac', () => {
  it('AC17 an awaited stream append takes under 2 ms at p95', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const { record, clock } = await open();
    const S = ulidAt(T0 - SECOND);
    await record.append(hook(S), sessionStart(T0 - SECOND, S));
    await record.append(hook(S), userAsk(T0, 1, 'go'));
    const p95 = async (count: number): Promise<number> => {
      const samples: number[] = [];
      for (let i = 0; i < count; i++) {
        const at = clock.tick(1);
        const t0 = performance.now();
        await record.append(hook(S), toolAfter(at, 'read', [`src/${i % 500}.ts`], null, seqAt(at)));
        samples.push(performance.now() - t0);
      }
      samples.sort((a, b) => a - b);
      return samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)]!;
    };
    console.log(`warm-up p95 ${(await p95(2000)).toFixed(3)} ms (discarded)`);
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) runs.push(await p95(2000));
    await record.close();
    judge(ctx, 'AC17 append p95 (ms)', runs, 2);
  }, 300_000);

  it(`AC17 replaying ${REPLAY_EVENTS.toLocaleString('en-US')} events rebuilds every projection in under ${REPLAY_LIMIT_S} s, with working memory under 100 MB${FULL ? '' : ' (scaled by 10; DEEP_RECORD_FULL=1 runs the issue\'s million)'}`, async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const { record, clock } = await open();
    const SESSIONS = 50;
    const perSession = Math.floor(REPLAY_EVENTS / SESSIONS);
    for (let s = 0; s < SESSIONS; s++) {
      const S = ulidAt(clock.tick(SECOND));
      await record.append(hook(S), sessionStart(clock.now(), S));
      await record.append(hook(S), userAsk(clock.tick(SECOND), 1, `part ${s}`));
      await fire(record, S, clock.tick(SECOND), perSession - 4, 500);
      await record.append(hook(S), agentStop(clock.tick(SECOND), S, 1));
      await record.append(app(S), claimMade(clock.tick(1), 'task:01K74FX2B4D6F8H0K2M4P6R8T0', 1));
    }
    const sample = await record.read({ after: 0, limit: 1 });
    expect(sample).toHaveLength(1);
    if (global.gc) global.gc();
    const rssBefore = process.memoryUsage().rss;
    const started = performance.now();
    await record.rebuild();
    const seconds = (performance.now() - started) / 1000;
    const rssGrowthMb = (process.memoryUsage().rss - rssBefore) / 1e6;
    await record.close();
    console.log(`AC17 replay of ${REPLAY_EVENTS} events: ${seconds.toFixed(1)} s; resident set grew ${rssGrowthMb.toFixed(0)} MB`);
    expect(rssGrowthMb, 'the record\'s working memory stays under 100 MB').toBeLessThan(100);
    judge(ctx, `AC17 replay of ${REPLAY_EVENTS} events (s)`, [seconds], REPLAY_LIMIT_S);
  }, 1_800_000);
});
