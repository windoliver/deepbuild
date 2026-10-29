// Npm install of a package the plan doesn't name is answered by your standing rule, and the agent sees the reason: README.md, Criteria. The scenario (scenarios.ts) runs on the real hub,
// deep-hook and CLI; INCONCLUSIVE (a hook the machine made late) is a skip, never a pass.
import { afterEach, test } from 'vitest';
import { cleanup, DEPENDENCY, verdict } from './helpers.ts';
import { newDependency } from './scenarios.ts';

afterEach(cleanup);

test(`${DEPENDENCY} npm install of a package the plan doesn't name is answered by your standing rule, and the agent sees the reason`, { timeout: 20 * 60_000 }, async (ctx) => {
  await verdict(ctx, () => newDependency());
});
