// #2650 AC1, the budget: the benchmark's default run, 5,000 cycles after warm-up with the four new calls in each, on a
// reference Mac in a fit state, with the merge base's reading beside it, driven through the same cycles and read the
// same way. Anywhere else it is a reading, skipped as INCONCLUSIVE, never passed. Long: run by hand (README, What
// scripts/lanes.mjs needs).
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { AC1, bench, cleanup, environmentProblem, grewMost, HEAP_LIMIT, lineFrom, MINUTE, REPO, shown, storesOf, worded } from './helpers.ts';

afterEach(cleanup, MINUTE);

const EIGHT_HOURS = 480 * MINUTE;
/** What each cycle keeps on the merge base, by the issue: the source's 64 KB answer and the job's 256 KB output. */
const MERGE_BASE_KEPT_PER_CYCLE = 320_000;

describe(`${AC1} Over 5,000 cycles after warm-up, each making one source call that answers 64 KB, one action call with a request ID, one job that prints 256 KB and ends, and one series call with a new set of 100 names, the hub's retained heap grows under 1 MB compared with the merge base, on the reference Mac, and the reading names the growth per 1,000 cycles. On the merge base every cycle's 320 KB stays, and the test fails, naming the store that grew most`, () => {
  it(`${AC1} the default run: 5,000 cycles, heap growth under 1 MB, each store's growth per 1,000 cycles named; on the merge base every cycle's 320 KB stays, and jobs grew most`, async (ctx) => {
    const problem = await environmentProblem();
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const r = await bench({ args: ['--merge-base'], timeoutMs: EIGHT_HOURS });
    const line = lineFrom(r);
    console.log(`#2650 growth: heap ${line.heapGrowthBytes} B over ${line.cycles} cycles, ${line.heapGrowthPer1000Bytes} B per 1,000; stores per 1,000 ${JSON.stringify(line.stores)}; merge base ${JSON.stringify(line.mergeBase)}`);
    expect([line.cycles, line.warmup, line.every], `the default run is the issue's: ${shown(r)}`).toEqual([5000, 100, 100]);
    expect(line.readings.length, 'a reading right after warm-up, then one every 100 cycles').toBe(51);
    storesOf(line.stores);
    expect(line.heapGrowthBytes, `retained heap growth over 5,000 cycles, in bytes: ${shown(r)}`).toBeLessThan(HEAP_LIMIT);
    expect(r.code, `an under-budget run exits 0: ${shown(r)}`).toBe(0);
    expect(worded(r, 'FAIL'), 'an under-budget run prints no FAIL').toEqual([]);

    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    expect(line.mergeBase?.commit, 'the comparison names the merge base').toBe(base);
    // The merge base's hub through the same cycles: every cycle's 320 KB stays, so its budget fails, and jobs grew most.
    expect(line.mergeBase?.heapGrowthPer1000Bytes, `the merge base's retained heap keeps about 320 KB a cycle: ${JSON.stringify(line.mergeBase)}`).toBeGreaterThanOrEqual(0.75 * MERGE_BASE_KEPT_PER_CYCLE * 1000);
    expect(grewMost(storesOf(line.mergeBase?.stores, 'the merge base\'s reading')), 'the store that grew most on the merge base').toBe('jobs');
  }, EIGHT_HOURS + MINUTE);
});
