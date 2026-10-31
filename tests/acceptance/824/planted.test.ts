// #824 AC2: the two planted hubs, selected with DEEP_HUB_PLANT, fail the benchmark on any machine, naming the cycle
// count and the growth. The unplanted hub on the same cycles is the comparison, so a benchmark that fails everything,
// or a plant that leaks nothing, fails here. A plant's entry is 1 KiB (README, Defined here, 3).
import { afterEach, describe, expect, it } from 'vitest';
import { AC2, bench, cleanup, HEAP_LIMIT_PER_1000, lineFrom, MINUTE, shown, sizesNamed, worded, type Ran } from './helpers.ts';

afterEach(cleanup, MINUTE);

const CYCLES = 500;
/** 1 KiB an entry over 1,000 cycles is about 1 MB; half of that clears the hub's own noise and any entry's overhead. */
const AT_LEAST = 500_000;
const AT_MOST = 20_000_000;

let unplanted: Promise<Ran> | undefined;

describe(`${AC2} A planted hub that keeps one entry per ended session in a map, or one listener per reloaded extension, fails the benchmark, naming the cycle count and the growth`, () => {
  it.each(['churn-keeps-ended-session', 'churn-keeps-reload-listener'])(`${AC2} %s fails it`, async (plant) => {
    const planted = await bench({ cycles: CYCLES, plant });
    const line = lineFrom(planted);
    expect(planted.code, `a planted hub fails the benchmark, exit non-zero: ${shown(planted)}`).not.toBe(0);
    const fail = worded(planted, 'FAIL');
    expect(fail, `it prints a line starting FAIL: ${shown(planted)}`).toBeDefined();
    expect(fail, 'the line names the cycle count').toMatch(new RegExp(`\\b${CYCLES} cycles\\b`));
    const named = sizesNamed(fail!);
    expect(named.length, `the line names the growth with its unit: ${fail}`).toBeGreaterThan(0);
    const growth = [line.heapGrowthBytes, line.heapGrowthPer1000Bytes, line.rssGrowthBytes, line.rssGrowthPer1000Bytes];
    expect(named.some((n) => growth.some((g) => Math.abs(n - g) <= Math.max(Math.abs(g) * 0.15, 1))), `the growth it names is the one it read: "${fail}" against ${JSON.stringify(growth)}`).toBe(true);
    expect(line.heapGrowthPer1000Bytes, 'the leak is over the limit per 1,000 cycles').toBeGreaterThanOrEqual(HEAP_LIMIT_PER_1000);

    // The plant is what moved the reading: its 1 KiB a cycle is there beside the unplanted hub's on the same cycles.
    unplanted ??= bench({ cycles: CYCLES });
    const healthy = lineFrom(await unplanted);
    const added = line.heapGrowthPer1000Bytes - healthy.heapGrowthPer1000Bytes;
    expect(added, `${plant} adds at least ${AT_LEAST} B per 1,000 cycles over the unplanted hub's ${healthy.heapGrowthPer1000Bytes} B: this is one entry a cycle, so a run with no reload or no ended session reads nothing`).toBeGreaterThanOrEqual(AT_LEAST);
    expect(added, `${plant} is the small leak the issue names, not a flood any benchmark would see`).toBeLessThanOrEqual(AT_MOST);
  }, 60 * MINUTE);
});
