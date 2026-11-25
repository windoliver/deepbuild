// #1866 AC6 on any machine, from short runs of the benchmark with `--killed`: the same cycles, each session's agent process
// killed and no SessionEnd sent, read back from the record; and a planted hub that keeps a gone session's routes fails
// the benchmark. One unplanted run serves both tests. The 5,000-cycle budget is budgets.long.test.ts.
import { afterAll, describe, expect, it } from 'vitest';
import { AC6, CLAIM_PARTS, cleanup, CYCLES, cyclesOf, expectParts, KILLED, MINUTE, plantedFails, readingOf, TEST_MS, SESSION_PARTS, shortRun, WARMUP, type Ran } from './helpers.ts';

afterAll(cleanup, MINUTE);

const FLAGS = ['--killed'];
let run: Promise<Ran> | undefined;
const unplanted = (): Promise<Ran> => (run ??= shortRun(FLAGS));

describe(`${AC6} The same cycles with each session's agent process killed and no SessionEnd sent grow the retained heap under 1 MB. A planted hub that keeps a gone session's routes fails the benchmark, naming the growth`, () => {
  it(`${AC6} with --killed every cycle, warm-up's too, has the same parts, its own agent process recorded gone and no SessionEnd, read back from the record`, async () => {
    const r = await unplanted();
    expect(readingOf(r).killed, 'the reading says its sessions were killed: "killed": true').toBe(true);
    const cycles = await cyclesOf(r);
    expectParts(cycles, WARMUP + CYCLES, CLAIM_PARTS, SESSION_PARTS, KILLED);
    expect(new Set(cycles.flatMap((c) => c.gone)).size, 'each session\'s process is its own').toBe(WARMUP + CYCLES);
  }, TEST_MS);

  it(`${AC6} churn-keeps-gone-routes, a hub that keeps a gone session's routes, fails it`, async () => {
    await plantedFails('churn-keeps-gone-routes', unplanted, FLAGS);
  }, TEST_MS);
});
