// AC6: a version at least a week old whose name is older still runs with no ask and shows on the return card's
// what-changed line; a version published 2 days ago is still held; and a planted guard that asks for the old version
// too fails this test, naming the ask (README, Criteria to tests; Wrong programs the implementer adds). On the real hub
// and deep-hook against the fixture registry; INCONCLUSIVE (a hook the machine made late) is a skip, never a pass.
import { afterEach, describe, expect, it } from 'vitest';
import { AC6, ASKS_EVERY, cleanup, failureOf, verdict } from './helpers.ts';
import { oldVersionRuns } from './scenarios.ts';

afterEach(cleanup, 60_000);

describe(`AC6 ${AC6} a version published three years ago runs, raises no ask, and the return card names it; a planted guard that asks fails, naming the ask; a version published 2 days ago is still held`, () => {
  it(`AC6 ${AC6} \`npx -y some-pkg@1.0.0\`, published three years ago, runs with no ask and the what-changed line of its turn's change names it; \`npx -y some-pkg@2.0.0\`, published 2 days ago, is held`, async (ctx) => {
    await verdict(ctx, () => oldVersionRuns());
  }, 600_000);

  it(`AC6 ${AC6} (wrong program) a guard that asks for every package run from a registry, whatever its age (${ASKS_EVERY}), fails this test, naming the ask`, async (ctx) => {
    await verdict(ctx, async () => {
      const failure = await failureOf(() => oldVersionRuns({ plant: ASKS_EVERY }));
      expect(failure, `AC6 ${AC6} the scenario must fail on the planted guard ${ASKS_EVERY}`).not.toBeNull();
      expect(failure).toMatch(/`npx -y some-pkg@1\.0\.0` must run with no ask: .*ask:[0-9A-Za-z]{10,}/s);
    });
  }, 600_000);
});
