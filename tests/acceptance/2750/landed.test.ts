// AC1 #2750.8eb13c6b: "Fixture: a record and recorded push answers, in #46's format, for ten commits the default branch
// gained. Six have a PASS on their tree, one a FAIL, one was pushed while the gate was off, one by a person from no
// session in the record, and one is a squash whose tree no snapshot matches while its branch's head passed. The reading
// is 6 PASS, 1 FAIL and 3 none: gate off; no session, naming the pusher; and tree not judged, naming the head's PASS and
// its commit. A reader that gives the squash its branch head's verdict reads 7 PASS and fails this test, naming the
// commit. A reader that lists only commits with a verdict reads 7 of 7 judged and fails it too"
//
// The fixture is fixture.ts's shop: ten real commits pushed to a real repository behind the fixture forge over the last
// thirty days, and a record of the base's own events. A real hub reads both when you run `deep numbers refresh`, and
// the reading is read from `numbers.read`. judges.ts's judgeLanded holds it to what the fixture's own commits say.
//
// Wrong programs: the merge base, which lists no such reading; the twins squash-takes-head-verdict, on which the
// failure names the squash and says the reading is 7 PASS, and lists-only-judged, on which it says 7 of 7 judged
// (twins/README.md).
import { afterAll, describe, expect, it } from 'vitest';
import { PERSON, REPO_NAME, Shop } from './fixture.ts';
import { AC1, cleanup, TIMEOUT, World } from './helpers.ts';
import { judgeLanded, tally } from './judges.ts';

afterAll(cleanup, 120_000);

describe(`${AC1} the fixture's ten commits the default branch gained, each with how it was judged`, () => {
  it(`${AC1} the reading is 6 PASS, 1 FAIL and 3 none: gate off; no session, naming the pusher; and tree not judged, naming the head's PASS and its commit`, async () => {
    const w = await World.make((dir) => Shop.build(dir));
    const { expected, sha } = w.fixture;
    // The fixture is the issue's: what its own commits, trees, pushes and events say, in the issue's numbers.
    expect(tally(expected), 'the fixture lands ten commits: six with a PASS on their tree, one with a FAIL, three with no verdict on theirs').toEqual({ PASS: 6, FAIL: 1, BLOCKED: 0, INVALID: 0, INCONCLUSIVE: 0, none: 3 });
    expect(expected.filter((e) => e.judged === 'none').map(({ commit, cause, pusher, verdict, verdict_commit }) => ({ commit, cause, pusher, verdict, verdict_commit })), 'its three with none: pushed while the gate was off; by a person from no session; the squash, whose branch head passed').toEqual([
      { commit: sha.c5, cause: 'off' },
      { commit: sha.c7, cause: 'no_session', pusher: PERSON },
      { commit: sha.c9, cause: 'tree', verdict: 'PASS', verdict_commit: sha.featureHead },
    ]);

    await w.start();
    const { reading } = await w.read();
    const failures = judgeLanded(reading, REPO_NAME, expected);
    expect(failures, `after \`deep numbers refresh\`, numbers.read must list the reading of ${REPO_NAME}'s ten commits, 6 PASS, 1 FAIL and 3 none, each none with its cause:\n${failures.join('\n')}\n`).toEqual([]);
  }, TIMEOUT);
});
