// #824 AC1, the budget: the benchmark's default run, on a reference Mac in a fit state, with the merge base's reading
// beside it. Anywhere else it is a reading, skipped as INCONCLUSIVE, never passed. Long: run by hand (README, What
// scripts/lanes.mjs needs).
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { AC1, bench, cleanup, environmentProblem, HEAP_LIMIT, lineFrom, MINUTE, REPO, RSS_LIMIT, shown, worded } from './helpers.ts';

afterEach(cleanup, MINUTE);

const FOUR_HOURS = 240 * MINUTE;
const problem = environmentProblem();

describe(`${AC1} Over 5,000 cycles after warm-up, the hub's retained heap grows under 1 MB and its resident memory under 10 MB, compared with the merge base, on the reference Mac`, () => {
  it(`${AC1} the default run: 5,000 cycles, heap growth under 1 MB, resident growth under 10 MB, the merge base's reading beside them`, async (ctx) => {
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const r = await bench({ args: ['--merge-base'], timeoutMs: FOUR_HOURS });
    const line = lineFrom(r);
    console.log(`#824 growth: heap ${line.heapGrowthBytes} B, resident ${line.rssGrowthBytes} B; per 1,000 cycles heap ${line.heapGrowthPer1000Bytes} B, resident ${line.rssGrowthPer1000Bytes} B; merge base ${JSON.stringify(line.mergeBase)}`);
    expect([line.cycles, line.warmup, line.every], `the default run is the issue's: ${shown(r)}`).toEqual([5000, 100, 100]);
    expect(line.readings.length, 'a reading right after warm-up, then one every 100 cycles').toBe(51);
    expect(line.heapGrowthBytes, `retained heap growth over 5,000 cycles, in bytes: ${shown(r)}`).toBeLessThan(HEAP_LIMIT);
    expect(line.rssGrowthBytes, `resident memory growth over 5,000 cycles, in bytes: ${shown(r)}`).toBeLessThan(RSS_LIMIT);
    expect(r.code, `an under-budget run exits 0: ${shown(r)}`).toBe(0);
    expect(worded(r, 'FAIL'), 'an under-budget run prints no FAIL').toBeUndefined();
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    expect(line.mergeBase?.commit, 'the comparison names the merge base').toBe(base);
    const measured = Number.isFinite(line.mergeBase?.heapGrowthPer1000Bytes) && Number.isFinite(line.mergeBase?.rssGrowthPer1000Bytes);
    expect(measured || (line.mergeBase?.initial ?? '').trim().length > 0, `the merge base's readings, or the reason it has none: ${JSON.stringify(line.mergeBase)}`).toBe(true);
  }, FOUR_HOURS + MINUTE);
});
