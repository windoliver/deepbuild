// #1866 AC1 and AC2 on any machine, from short runs of the benchmark. AC1: every cycle made an edit, one claim judged to
// PASS by a run of its own and one deep_show, read back from the record. AC2: a planted hub that keeps one lane per judged
// claim and a planted gate runner that keeps every ended session's claims each fail the benchmark. One unplanted run
// serves all three tests. The 5,000-cycle budget is budgets.long.test.ts.
import { afterAll, describe, expect, it } from 'vitest';
import { AC1, AC2, CLAIM_PARTS, cleanup, CYCLES, cyclesOf, ENDED, expectParts, MINUTE, plantedFails, readingOf, shortRun, TEST_MS, WARMUP, type Ran } from './helpers.ts';

// The unplanted run's home, with the record, is kept until the file ends.
afterAll(cleanup, MINUTE);

let run: Promise<Ran> | undefined;
const unplanted = (): Promise<Ran> => (run ??= shortRun());

describe(`${AC1} Over 5,000 churn cycles after warm-up that each make one claim judged to PASS and one deep_show, the hub's retained heap grows under 1 MB compared with the merge base, on the reference Mac, and the reading names the growth per 1,000 cycles: the cycle and the reading`, () => {
  it(`${AC1} every cycle, warm-up's too, made an edit, one claim judged to PASS by a run of its own and one deep_show, read back from the record; the reading names the growth per 1,000 cycles`, async () => {
    const r = await unplanted();
    const line = readingOf(r);
    console.log(`#1866 unplanted: heap ${line.heapGrowthBytes} B over ${CYCLES} cycles, ${line.heapGrowthPer1000Bytes} B per 1,000`);
    expect(line.killed, 'the cycles as they are end each session with a SessionEnd').not.toBe(true);
    expectParts(await cyclesOf(r), WARMUP + CYCLES, CLAIM_PARTS, ENDED);
  }, TEST_MS);
});

describe(`${AC2} A planted hub that keeps one lane per judged claim, and a planted gate runner that keeps every ended session's claims, each fail the benchmark, naming the cycle count and the growth`, () => {
  it.each(['churn-keeps-claim-lane', 'churn-keeps-ended-claims'])(`${AC2} %s fails it`, async (plant) => {
    await plantedFails(plant, unplanted);
  }, TEST_MS);
});
