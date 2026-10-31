// #824 AC3: the counts after the last cycle equal those after warm-up, on any machine. The counts are real (the hub
// has a listening socket and timers of its own, and nothing is left holding the benchmark's home), and a hub that
// leaves one of each behind per cycle fails, so a benchmark that prints equal numbers without counting fails here.
import { afterEach, describe, expect, it } from 'vitest';
import { AC3, bench, cleanup, holders, lineFrom, MINUTE, shown, worded } from './helpers.ts';

afterEach(cleanup, MINUTE);

const CYCLES = 300;

describe(`${AC3} The benchmark's cycles leave no open sockets, timers or child processes behind: their counts after the last cycle equal those after warm-up`, () => {
  it(`${AC3} the unplanted hub: sockets, timers and children after the last cycle equal those after warm-up, and nothing still holds its home`, async () => {
    const r = await bench({ cycles: CYCLES });
    const { afterWarmup, afterLast } = lineFrom(r).open;
    console.log(`#824 open: after warm-up ${JSON.stringify(afterWarmup)}, after the last cycle ${JSON.stringify(afterLast)}`);
    expect(afterLast, `the counts after the last cycle equal those after warm-up: ${shown(r)}`).toEqual(afterWarmup);
    for (const name of ['sockets', 'timers', 'children'] as const) {
      expect(Number.isSafeInteger(afterLast[name]) && afterLast[name] >= 0, `${name} is a count: ${afterLast[name]}`).toBe(true);
    }
    expect(afterLast.sockets, 'the hub\'s listening socket is among them: the count is measured').toBeGreaterThanOrEqual(1);
    expect(afterLast.timers, 'the hub\'s own interval timers are among them: the count is measured').toBeGreaterThanOrEqual(1);
    expect(holders(r.home), 'once it exits, no process it started still holds the benchmark\'s home').toEqual([]);
  }, 30 * MINUTE);

  it.each([
    ['churn-leaves-socket', 'sockets', /socket/i],
    ['churn-leaves-timer', 'timers', /timer/i],
    ['churn-leaves-child', 'children', /child/i],
  ] as const)(`${AC3} %s fails it, naming what it left`, async (plant, name, word) => {
    const r = await bench({ cycles: CYCLES, plant });
    const { afterWarmup, afterLast } = lineFrom(r).open;
    expect(afterLast[name] - afterWarmup[name], `one left a cycle shows in the count of ${name}: ${shown(r)}`).toBeGreaterThanOrEqual(CYCLES / 2);
    expect(r.code, `a run that leaves ${name} behind fails, exit non-zero: ${shown(r)}`).not.toBe(0);
    expect(worded(r, 'FAIL'), `it prints a FAIL line naming ${name}: ${shown(r)}`).toMatch(word);
  }, 30 * MINUTE);
});
