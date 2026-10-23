// #319.43d13eb3: creating or answering an ask takes under 5 ms in the hub; the inbox projection with 10,000
// asks loads in under 100 ms. Judged by the design's rule for timing results: five runs after a warm-up;
// PASS when all five are within the limit, FAIL when all five are over it by more than the margin (the
// larger of 5% and the five runs' spread), otherwise INCONCLUSIVE. Off a reference Mac (Mac15,7 or
// Mac15,12), on battery, with Low Power Mode on or unknown, or with a thermal warning, the result is a
// reading only and the test skips. It never passes by skipping. The merge-base comparison belongs to the
// perf lane (README: Criterion 10).

import { afterEach, describe, expect, it } from 'vitest';
import {
  ask, card, core, DAY, environmentProblem, judge, median, openWorld, settings, sourceOf, T0, ulid, type World,
} from './helpers.ts';

let world: World | undefined;
afterEach(async () => { await world?.close(); world = undefined; }, 120_000);

const problem = environmentProblem();
const PAIRS = 200;

describe('#319.43d13eb3 budgets on the reference Mac', () => {
  it('#319.43d13eb3 creating or answering an ask takes under 5 ms in the hub', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const w = (world = await openWorld({ settings: settings() }));
    await w.start('S1', 'T1');
    const source = sourceOf('taste');
    let n = 0;
    const run = async (): Promise<{ create: number; answer: number }> => {
      const create: number[] = [];
      const answer: number[] = [];
      for (let i = 0; i < PAIRS; i++) {
        w.clock.set(w.clock.now() + 1);
        let t = performance.now();
        const h = await w.asks.raise(core('S1'), source, ask('taste', `screen ${++n}`));
        create.push(performance.now() - t);
        t = performance.now();
        await w.asks.answer(card, h, { option: 'green' });
        answer.push(performance.now() - t);
      }
      return { create: median(create), answer: median(answer) };
    };
    const warm = await run();
    console.log(`warm-up: create ${warm.create.toFixed(3)} ms, answer ${warm.answer.toFixed(3)} ms at p50 (discarded)`);
    const runs: { create: number; answer: number }[] = [];
    for (let r = 0; r < 5; r++) runs.push(await run());
    const answered = (await w.asks.inbox()).filter((row) => row.outcome === 'answered');
    expect(answered, 'every ask timed was raised and answered').toHaveLength(6 * PAIRS);
    judge(ctx, '#319 create an ask, p50 (ms)', runs.map((r) => r.create), 5);
    judge(ctx, '#319 answer an ask, p50 (ms)', runs.map((r) => r.answer), 5);
  }, 600_000);

  it('#319.43d13eb3 the inbox projection with 10,000 asks loads in under 100 ms', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const w = (world = await openWorld({ settings: settings() }));
    // 2,000 sessions with five open asks each, appended as the core appends them, so none folds.
    const SESSIONS = 2000;
    for (let s = 0; s < SESSIONS; s += 100) {
      await Promise.all(Array.from({ length: 100 }, (_, i) => w.start(`S${s + i}`, `T${s + i}`)));
      await Promise.all(Array.from({ length: 100 * 5 }, (_, j) => {
        const session = `S${s + Math.floor(j / 5)}`;
        const data = { ...ask('taste', `${session} screen ${j % 5}`), deadline: T0 + 30 * DAY, default: 'green' };
        return w.record.append(core(session), { v: 1, id: ulid(T0), kind: 'ask.created', ts: T0, data });
      }));
    }
    await w.asks.tick();
    const load = async (): Promise<number> => {
      const t = performance.now();
      const rows = await w.asks.inbox();
      const ms = performance.now() - t;
      expect(rows.length, 'the inbox lists every ask').toBeGreaterThanOrEqual(10_000);
      return ms;
    };
    console.log(`warm-up: ${(await load()).toFixed(1)} ms (discarded)`);
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) runs.push(await load());
    judge(ctx, '#319 inbox with 10,000 asks (ms)', runs, 100);
  }, 600_000);
});
