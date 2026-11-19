// #2650 AC1 and AC6 on any machine, from one short run of the benchmark on a healthy hub. AC1: the reading names each
// store's growth per 1,000 cycles by its key, and no store, each bounded in entries and bytes, grows past warm-up.
// AC6: each cycle made the new calls, read back from the record, never from the benchmark's word: a source call
// answered with 64 KB, a series source's batch, and a job that ran and ended. The action call leaves nothing in the
// record (a read), and neither the job's 256 KB nor the new set of names shows there: the planted runs prove those
// (planted-*.test.ts). #824's own criteria are held by #824's suites, run as they are (README, Criteria to tests).
// The 5,000-cycle budget is budgets.long.test.ts.
import { afterAll, describe, expect, it } from 'vitest';
import { AC1, AC6, bench, cleanup, HEAP_LIMIT_PER_1000, lineFrom, MINUTE, recorded, shown, STORES, storesOf, type Ran } from './helpers.ts';

// One run serves both criteria; its home, with the record, is kept until the file ends.
afterAll(cleanup, MINUTE);

const CYCLES = 100;
const WARMUP = 100;
let run: Promise<Ran> | undefined;
const healthy = (): Promise<Ran> => (run ??= bench({ cycles: CYCLES }));

describe(`${AC1} Over 5,000 cycles after warm-up, each making one source call that answers 64 KB, one action call with a request ID, one job that prints 256 KB and ends, and one series call with a new set of 100 names, the hub's retained heap grows under 1 MB compared with the merge base, on the reference Mac, and the reading names the growth per 1,000 cycles. On the merge base every cycle's 320 KB stays, and the test fails, naming the store that grew most: the reading`, () => {
  it(`${AC1} ${CYCLES} cycles after warm-up on a healthy hub: the reading names each store's growth per 1,000 cycles, keyed answers, results, jobs and names, and none grows past warm-up`, async () => {
    const line = lineFrom(await healthy());
    expect([line.cycles, line.warmup, line.every], 'cycles, warm-up, read every').toEqual([CYCLES, WARMUP, 100]);
    expect(Number.isFinite(line.heapGrowthPer1000Bytes), 'the hub\'s retained heap growth per 1,000 cycles').toBe(true);
    const stores = storesOf(line.stores);
    console.log(`#2650 healthy stores per 1,000 cycles: ${JSON.stringify(stores)}; heap ${line.heapGrowthPer1000Bytes} B per 1,000`);
    for (const key of STORES) {
      // Past warm-up's 100 cycles each store is at its bound of 64 entries, so a store that kept growing is no bound.
      expect(stores[key], `${key} grew ${stores[key]} bytes per 1,000 cycles past warm-up; a bounded store stays under ${HEAP_LIMIT_PER_1000}, the whole heap's limit`).toBeLessThan(HEAP_LIMIT_PER_1000);
    }
  }, 60 * MINUTE);
});

describe(`${AC6} \`hub-churn.mjs\` gains these four calls in its cycle, and #824's own criteria still hold`, () => {
  it(`${AC6} every cycle, warm-up's too, made a source call answered with 64 KB, landed a series batch and ran a job that ended, read back from the record`, async () => {
    const r = await healthy();
    lineFrom(r);
    const total = WARMUP + CYCLES;
    const events = await recorded(r.home, ['source.called', 'reading.batch', 'job.ended']);
    const answered = events.filter((e) => e.kind === 'source.called' && e.data.outcome === 'answered' && Number(e.data.bytes) >= 64_000);
    expect(answered.length, `source calls answered with at least 64 KB, one a cycle: ${shown(r).slice(0, 400)}`).toBeGreaterThanOrEqual(total);
    const batches = events.filter((e) => e.kind === 'reading.batch');
    expect(batches.length, 'series batches landed, one a cycle').toBeGreaterThanOrEqual(total);
    const jobs = events.filter((e) => e.kind === 'job.ended');
    expect(jobs.filter((e) => e.data.state === 'finished').length, `jobs that ran and ended, one a cycle: ${JSON.stringify(jobs.slice(-2).map((e) => e.data))}`).toBeGreaterThanOrEqual(total);
  }, 60 * MINUTE);
});
