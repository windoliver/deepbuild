// #1523 AC1: in a thread whose prompts name none of push, PR or merge, each of `jj git push --bookmark main`,
// `gt submit --stack`, `git town ship`, `sl push`, `glab mr merge 3` and a `gh api graphql` mutation that runs
// `mergePullRequest` is held under the default rules: denied naming a block entry of its effect class, with an
// authority ask filed whose card names the effect in its own words. A matcher that reads only `git push`,
// `gh pr merge` and the REST endpoint lets them through and fails this test, naming the call: that matcher is the
// merge base's (BASE-FAILURE.txt).
import { afterEach, describe, it } from 'vitest';
import { AC1, HELD, cleanup, each, expectHeld, makeWorld, startHub, stopHub, unasked, verdict } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC1} the new push, PR and merge forms are held in a thread that names none of them`, () => {
  it(`${AC1} ${HELD.map(([c]) => c.split(' -f ')[0]).join(', ')} are each held with an authority ask whose card names the effect`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const s = await unasked(hub, w);
      await each(HELD, ([command, effects]) => expectHeld(hub, s, command, effects, AC1));
    } finally {
      await stopHub(hub);
    }
  }), 900_000);
});
