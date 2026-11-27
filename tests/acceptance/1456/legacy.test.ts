// AC2 #1456.f70bc414: a record written before this change, replayed, gives the same states as the merge base. The
// fixture's readings as the merge base writes them, session.reading@1 with the base's words and no code (README: The
// fixture), in a hub of its own: each session's newest session.state must be the one the merge base recorded for it,
// pinned in the fixture as `expected`. It holds at the merge base by construction (a regression guard); its wrong
// program is the twin `legacy-readings-unread` (README: Planted programs), which reads no reading without a code.
import { afterAll, describe, expect, test } from 'vitest';
import { AC2, beside, cleanup, moved, statesOf } from './helpers.ts';

afterAll(cleanup, 60_000);

describe(AC2, () => {
  test(`${AC2}: a record of the base's readings, with no codes, reads the base's states`, async () => {
    const legacy = await statesOf('legacy');
    const proof = beside("the base's words, no codes (session.reading@1)", legacy.states);
    console.log(proof);
    expect(moved(legacy.states), `the sessions whose state isn't the merge base's:\n${proof}`).toEqual([]);
  }, 300_000);
});
