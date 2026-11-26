// AC2 #2750.230902ce: "A revert of the commit pushed while the gate was off counts as one revert of a commit never
// judged, and the escapes after PASS stay at zero. A reader that counts it as an escape fails this test, naming the
// revert"
//
// The fixture is the shop with an eleventh commit: seven days ago a session reverts the commit pushed while the gate was
// off, with git's own revert (its message says "This reverts commit <sha>." and its diff takes the file back out), its
// claim on the revert passes, and you push it. The revert's row names the commit it reverts and is counted
// "never_judged"; it is the only row counted so, and no row is counted "escape", an escape after PASS.
//
// Wrong programs: the merge base, which lists no such reading; the twin revert-as-escape, on which the failure names
// the revert (twins/README.md).
import { afterAll, describe, expect, it } from 'vitest';
import { REPO_NAME, Shop } from './fixture.ts';
import { AC2, cleanup, TIMEOUT, World } from './helpers.ts';
import { judgeLanded, judgeRevert } from './judges.ts';

afterAll(cleanup, 120_000);

describe(`${AC2} a revert of a commit that read none is counted apart, as never judged`, () => {
  it(`${AC2} the revert of the commit pushed while the gate was off counts as one revert of a commit never judged, and the escapes after PASS stay at zero`, async () => {
    const w = await World.make((dir) => Shop.build(dir, { revert: true }));
    const { expected, revert, sha } = w.fixture;
    expect(revert, 'the fixture holds the revert and the commit it reverts, the one pushed while the gate was off').toEqual({ revert: sha.revert, of: sha.c5 });
    expect(expected.find((e) => e.commit === sha.c5), 'which reads none: gate off').toMatchObject({ judged: 'none', cause: 'off' });

    await w.start();
    const { reading } = await w.read();
    // The reading is there and is the fixture's eleven commits; then the revert's own counting.
    const failures = [...new Set([...judgeLanded(reading, REPO_NAME, expected), ...judgeRevert(reading, REPO_NAME, { ...revert!, ofReads: 'none (gate off)' })])];
    expect(failures, `the revert ${sha.revert} of ${sha.c5} must count as one revert of a commit never judged, with no escape after PASS:\n${failures.join('\n')}\n`).toEqual([]);
  }, TIMEOUT);
});
