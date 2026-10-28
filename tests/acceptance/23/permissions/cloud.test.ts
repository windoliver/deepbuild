// A KMS key the plan doesn't name is answered by your standing rule in its account, asked in a new account, and the agent sees why: README.md, Criteria. The scenario (scenarios.ts) runs on the real hub,
// deep-hook and CLI; INCONCLUSIVE (a hook the machine made late) is a skip, never a pass.
import { afterEach, test } from 'vitest';
import { cleanup, CLOUD, verdict } from './helpers.ts';
import { cloudResource } from './scenarios.ts';

afterEach(cleanup);

test(`${CLOUD} a KMS key the plan doesn't name is answered by your standing rule in its account, asked in a new account, and the agent sees why`, { timeout: 20 * 60_000 }, async (ctx) => {
  await verdict(ctx, () => cloudResource());
});
