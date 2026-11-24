// #3108.20c3092c: "Both AC3 tests of `tests/acceptance/1720/` pass on main". This file holds the first of the two:
// hub.test.ts's AC3, every folder of packs/ with a pack.json listed by `deep_kinds list` on a live hub with its version.
// The other, planted.test.ts's AC3, is ac1-planted.test.ts (one file each, as each may take most of a file's 20 minutes).
//
// asserts: tests/acceptance/1720/hub.test.ts, as it stands, run in a child Vitest from the checkout's root with the root
// config and filtered to that one test by its name, reports the test ran and passed (not skipped, not missing), and the
// child exits 0. A failure quotes the #1720 test's own failure message (helpers.ts, namedTestFailures).
import { describe, expect, it } from 'vitest';
import { MINUTE, namedTestFailures } from './helpers.ts';

const FILE = 'tests/acceptance/1720/hub.test.ts';
const TITLE = 'AC3 each folder of packs/ with a pack.json is listed by deep_kinds list with its version';

describe('#3108 both AC3 tests of tests/acceptance/1720 pass', () => {
  it('#3108.20c3092c hub.test.ts AC3: each first-party pack is listed by deep_kinds list on a live hub, and the test passes', async () => {
    const failures = await namedTestFailures(FILE, TITLE, 18 * MINUTE);
    expect(failures, `${FILE}'s AC3 "${TITLE}" runs and passes:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, 19 * MINUTE);
});
