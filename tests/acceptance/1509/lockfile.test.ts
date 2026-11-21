// AC2: a package the repo's lockfile holds at the version run is no decision: `npx vitest` runs with no ask, while a
// vitest version the lockfile doesn't hold is held (README, Criteria to tests). On the real hub and deep-hook against
// the fixture registry; INCONCLUSIVE (a hook the machine made late) is a skip, never a pass.
import { afterEach, describe, it } from 'vitest';
import { AC2, cleanup, verdict } from './helpers.ts';
import { lockfileRuns } from './scenarios.ts';

afterEach(cleanup, 60_000);

describe(`AC2 ${AC2} \`npx vitest\` at the lockfile's version runs with no ask`, () => {
  it(`AC2 ${AC2} \`npx vitest\`, which the lockfile holds at 3.2.4, runs with no ask; \`npx vitest@4.0.0\`, a version it doesn't hold, is held`, async (ctx) => {
    await verdict(ctx, () => lockfileRuns());
  }, 600_000);
});
