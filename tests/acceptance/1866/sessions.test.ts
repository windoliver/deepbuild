// #1866 AC5 on any machine, from short runs of the benchmark: every cycle's session had a stop that carried usage, a
// permission prompt and a held plug-in action that were answered, one commit and a SessionEnd, read back from the record;
// and a planted hub that keeps one usage tail per ended session, and one that keeps every prompt's ask, each fail the
// benchmark. One unplanted run serves the three tests. The 5,000-cycle budget is budgets.long.test.ts.
import { afterAll, describe, it } from 'vitest';
import { AC5, cleanup, CYCLES, cyclesOf, ENDED, expectParts, MINUTE, plantedFails, readingOf, shortRun, TEST_MS, SESSION_PARTS, WARMUP, type Ran } from './helpers.ts';

afterAll(cleanup, MINUTE);

let run: Promise<Ran> | undefined;
const unplanted = (): Promise<Ran> => (run ??= shortRun());

describe(`${AC5} Over the same 5,000 cycles, each also starting a Claude Code session whose stop carries usage, raising one permission prompt and one held plug-in action that are answered, recording one commit and ending the session, the hub's retained heap still grows under 1 MB. A planted hub that keeps one usage tail per ended session, and one that keeps every prompt's ask, each fail the benchmark, naming the growth`, () => {
  it(`${AC5} every cycle, warm-up's too, had a stop that carried usage, one permission prompt and one held plug-in action, each answered, one commit and a SessionEnd, read back from the record`, async () => {
    const r = await unplanted();
    readingOf(r);
    expectParts(await cyclesOf(r), WARMUP + CYCLES, SESSION_PARTS, ENDED);
  }, TEST_MS);

  it.each(['churn-keeps-usage-tail', 'churn-keeps-prompt-ask'])(`${AC5} %s fails it`, async (plant) => {
    await plantedFails(plant, unplanted);
  }, TEST_MS);
});
