// AC4, AC5 and AC6: what a working session is doing now, on its page and in its row's accessible name, from its hook
// facts alone (README, The fixture: `lineRun`). Headless: the real `deep-drive` on a copy of a real hub's record, a
// recorded Claude Code turn's hooks through the hub's hook entry, the replica's virtual clock for 40 s and 10 min.
// The shipped run is made once and judged by all three criteria; each plant runs only the part its judge reads.
import { afterAll, describe, expect, it } from 'vitest';
import { shared } from '../16/helpers.ts';
import { cleanup, ID, lineRun, MIN, PLANT, scrubFailures, selectFailures, turnFailures } from './helpers.ts';

afterAll(cleanup);
const LIMIT = 180 * MIN;
const shipped = shared(() => lineRun(['turn', 'scrub', 'silence']));
const HELD = 'the shipped app must pass this judge first, or a plant it fails proves nothing';

describe(`AC4 ${ID.turn} A recorded turn reads "Edited cart/total.ts", "Running npm · 40 s", "Couldn't run npm" and the permission prompt; plants fail`, () => {
  it('AC4 the shipped app: each step on the selected row\'s page and in its accessible name within one event of its hook, the prompt reading needs you, never the agent\'s words', async () => {
    expect(turnFailures(await shipped())).toEqual([]);
  }, LIMIT);

  it('AC4 wrong program: a row that reads the agent\'s last message (line-reads-message) fails, naming the session', async () => {
    expect(turnFailures(await shipped()), HELD).toEqual([]);
    const failures = turnFailures(await lineRun(['turn'], PLANT.message));
    expect(failures.join('\n'), `${PLANT.message} wasn't caught`).toMatch(/session:\S+ \("Cart totals"\): .*Almost done, fixing tests/);
  }, LIMIT);

  it('AC4 wrong program: a row that keeps "Running npm" after the failure (line-keeps-running) fails, naming the session', async () => {
    expect(turnFailures(await shipped()), HELD).toEqual([]);
    const failures = turnFailures(await lineRun(['turn'], PLANT.keepsRunning));
    expect(failures.join('\n'), `${PLANT.keepsRunning} wasn't caught`).toMatch(/session:\S+ \("Cart totals"\): turn: (right|a second) after npm test failed, /);
  }, LIMIT);
});

describe(`AC5 ${ID.scrub} A scrubbed command shows its first word only; 10 min with no event reads "10 min ago", never stuck; plants fail`, () => {
  it('AC5 the shipped app: "Running curl" with the hub\'s token in no reading of the row; ten minutes on, "Ran curl · 10 min ago" and no stuck, stalled or idle', async () => {
    expect(scrubFailures(await shipped(), true)).toEqual([]);
  }, LIMIT);

  it('AC5 wrong program: a row that prints the whole command line (line-whole-command) fails, naming the session', async () => {
    expect(scrubFailures(await shipped(), true), HELD).toEqual([]);
    const failures = scrubFailures(await lineRun(['scrub'], PLANT.wholeCommand), false);
    expect(failures.join('\n'), `${PLANT.wholeCommand} wasn't caught`).toMatch(/session:\S+ \("Deploy check"\): scrub: (right after the curl began|2 s into the curl), /);
  }, LIMIT);

  it('AC5 wrong program: a row that switches to "stalled" on a timer (line-stalls-on-timer) fails, naming the session', async () => {
    expect(scrubFailures(await shipped(), true), HELD).toEqual([]);
    const failures = scrubFailures(await lineRun(['scrub', 'silence'], PLANT.stalls), true);
    expect(failures.join('\n'), `${PLANT.stalls} wasn't caught`).toMatch(/session:\S+ \("Deploy check"\): silence: \d+ min with no event[^,]*, its row says "stalled"/i);
  }, LIMIT);
});

describe(`AC6 ${ID.select} Selecting a working row moves no row and changes no height; a second line on the selected row fails`, () => {
  it('AC6 the shipped app: every row drawn before the press on Cart totals keeps its place and height after it', async () => {
    expect(selectFailures(await shipped())).toEqual([]);
  }, LIMIT);

  it('AC6 wrong program: a second line on the selected row (selected-second-line) fails, naming it', async () => {
    expect(selectFailures(await shipped()), HELD).toEqual([]);
    const failures = selectFailures(await lineRun(['turn'], PLANT.secondLine));
    expect(failures.join('\n'), `${PLANT.secondLine} wasn't caught`).toMatch(/selecting session:\S+ \("Cart totals"\) made the selected row session:\S+ \("Cart totals"\) \d+ px tall/);
  }, LIMIT);
});
