// AC3 #2750.8f4da496: "With the forge refusing the push readings for three of the thirty days, the reading says missing
// for those dates and gives no share for them. A reader that reports zero unjudged commits for that span fails this test"
//
// The fixture is the shop with three more days: six, five and four days ago a session lands two commits a day, and the
// forge refuses, with a 403, every read that would name a commit those three pushes brought (README: The fixture
// forge). The reading still lists the ten commits it can read, with their share; for the three dates it holds one row
// that says missing, from the first date to the last, with no number in it; and none of the six refused commits has a row.
//
// Wrong programs: the merge base, which lists no such reading; the twin uncovered-as-zero, on which the failure names
// the span (twins/README.md).
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_NAME, Shop } from './fixture.ts';
import { AC3, cleanup, TIMEOUT, World } from './helpers.ts';
import { datesOf, judgeLanded, judgeMissing } from './judges.ts';

afterAll(cleanup, 120_000);

describe(`${AC3} a span the push readings don't cover reads missing, with its dates, never zero`, () => {
  it(`${AC3} with the forge refusing the push readings for three of the thirty days, the reading says missing for those dates and gives no share for them`, async () => {
    const w = await World.make((dir) => Shop.build(dir, { refused: true }));
    const { expected, missing, withheld } = w.fixture;
    expect(missing.flatMap(datesOf).length, 'the forge refuses the push readings for three dates').toBe(3);
    expect([expected.length, withheld.length], 'ten commits it lets be read, and six, two a day, it refuses to name').toEqual([10, 6]);

    await w.start();
    const { reading } = await w.read();
    // The ten commits the forge answers for are read, with their share; then the three dates it refuses.
    const failures = [...new Set([...judgeLanded(reading, REPO_NAME, expected), ...judgeMissing(reading, REPO_NAME, missing, withheld)])];
    expect(failures, `the reading must say missing for ${missing.map((s) => `${s.from} to ${s.to}`).join(', ')}, give no number for those dates, and still read the ten commits the forge answers for:\n${failures.join('\n')}\n`).toEqual([]);
  }, TIMEOUT);
});
