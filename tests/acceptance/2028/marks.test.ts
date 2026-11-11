// AC1: on a virtual clock, you're present at 14:00 and absent until 17:00; in between five sessions reach PASS, are sent
// back, are BLOCKED, have a decision applied for you, and start a new turn that's still working. On return exactly those
// five rows are marked (their titles medium), and having one's page open for a second clears its mark. A planted mark
// from the whole day, or from the agents' messages, fails, naming the row.
//
// One world a real hub made (helpers.ts `MARKS_WORLD`), and one replica of it per program, run in step on the
// replica's virtual clock (helpers.ts `marksRun`): the app as shipped, and the app with each plant (README, Pinned).
// Each plant's test first holds the shipped run to the same judge, so a plant can't look caught on a program that
// already fails.
import { afterAll, describe, expect, it } from 'vitest';
import { cleanup, HOUR, ID, marksRun, MIN, PLANT } from './helpers.ts';

afterAll(cleanup, 5 * MIN);

let ran: ReturnType<typeof marksRun> | undefined;
const run = (): ReturnType<typeof marksRun> => (ran ??= marksRun([undefined, PLANT.wholeDay, PLANT.messages]));
const clean = 'the shipped app already fails AC1, so a plant can\'t be told from it';

describe(`#2028 AC1 ${ID.marks}`, () => {
  it('on a virtual clock, exactly the five rows that changed while you were away from 14:00 to 17:00 are marked on return, and each clears once its page was open a second', async () => {
    expect((await run()).get(undefined)).toEqual([]);
  }, 8 * HOUR);

  it(`a planted mark from the whole day (${PLANT.wholeDay}) fails, naming the row`, async () => {
    const runs = await run();
    expect(runs.get(undefined), clean).toEqual([]);
    const failures = runs.get(PLANT.wholeDay)!;
    expect(failures.join('\n'), `the planted mark from the whole day wasn't caught, naming the row read at 14:00: ${JSON.stringify(failures)}`)
      .toMatch(/^at 17:00, the row read at 14:00 after its change earlier in the day, row session:\S+'s title is drawn at weight \d+, medium/m);
  }, 8 * HOUR);

  it(`a planted mark from the agents' messages (${PLANT.messages}) fails, naming the row`, async () => {
    const runs = await run();
    expect(runs.get(undefined), clean).toEqual([]);
    const failures = runs.get(PLANT.messages)!;
    expect(failures.join('\n'), `the planted mark from the agents' messages wasn't caught, naming the row with only its agent's messages: ${JSON.stringify(failures)}`)
      .toMatch(/^at 17:00, the row with only its agent's messages since 14:00, row session:\S+'s title is drawn at weight \d+, medium/m);
  }, 8 * HOUR);
});
