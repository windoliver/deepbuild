// #3108.20c3092c: "Both AC3 tests of `tests/acceptance/1720/` pass on main". This file holds the second of the two:
// planted.test.ts's AC3, the planted pack refused (absent from `deep_kinds list` beside the shipped packs of the
// installed tree's hub, and named by `deep doctor`). The first, hub.test.ts's AC3, is ac1-hub-listing.test.ts.
//
// asserts: tests/acceptance/1720/planted.test.ts, as it stands, run in a child Vitest from the checkout's root with the
// root config and filtered to that one test by its name, reports the test ran and passed (not skipped, not missing), and
// the child exits 0. A failure quotes the #1720 test's own failure message (helpers.ts, namedTestFailures).
import { describe, expect, it } from 'vitest';
import { MINUTE, namedTestFailures } from './helpers.ts';

const FILE = 'tests/acceptance/1720/planted.test.ts';
const TITLE = 'AC3 the planted pack is refused: absent from deep_kinds list beside the shipped packs, and named by deep doctor';

describe('#3108 both AC3 tests of tests/acceptance/1720 pass', () => {
  it('#3108.20c3092c planted.test.ts AC3: the planted pack is refused by the installed tree\'s hub and named by deep doctor, and the test passes', async () => {
    const failures = await namedTestFailures(FILE, TITLE, 18 * MINUTE);
    expect(failures, `${FILE}'s AC3 "${TITLE}" runs and passes:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, 19 * MINUTE);
});
