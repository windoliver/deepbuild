// #303.447eb97a: turning a message into a task adds under 5 ms to the prompt hook. Judged by the design's rule for
// timing results: five runs after a warm-up; PASS when all five are within the limit, FAIL when all five are over it
// by more than the margin (the larger of 5% and the five runs' spread), otherwise INCONCLUSIVE. Off a reference Mac
// (Mac15,7 or Mac15,12), on battery, with Low Power Mode on or unknown, or with a thermal warning, the result is a
// reading only and the test skips. It never passes by skipping. The merge-base comparison belongs to the perf lane
// (README: Criterion 11).

import { afterEach, describe, expect, it } from 'vitest';
import { environmentProblem, judge, median, openWorld, type World } from './helpers.ts';

let world: World | undefined;
afterEach(async () => { await world?.close(); world = undefined; }, 120_000);

const problem = environmentProblem();
const PROMPTS = 200;

describe('#303.447eb97a budgets on the reference Mac', () => {
  it('#303.447eb97a turning a message into a task adds under 5 ms to the prompt hook', async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const w = (world = await openWorld());
    await w.start('S1', 'T1');
    let n = 0;
    // The kernel's whole work for one prompt hook: the prompt's user.ask, the decision, and the task it opens.
    const run = async (): Promise<number> => {
      const samples: number[] = [];
      for (let i = 0; i < PROMPTS; i++) {
        w.clock.set(w.clock.now() + 1);
        const t = performance.now();
        const prompted = await w.prompt('S1', `make the auth middleware reject expired tokens on route ${++n}`);
        samples.push(performance.now() - t);
        expect(prompted.task, `${prompted.handle}: the prompt opened a task`).toBe(prompted.handle);
        await w.stop('S1');
      }
      return median(samples);
    };
    const warm = await run();
    console.log(`warm-up: ${warm.toFixed(3)} ms at p50 (discarded)`);
    const runs: number[] = [];
    for (let r = 0; r < 5; r++) runs.push(await run());
    expect((await w.table('tasks')).length, 'every prompt timed opened a task').toBe(6 * PROMPTS);
    judge(ctx, '#303 a message into a task, p50 (ms)', runs, 5);
  }, 600_000);
});
