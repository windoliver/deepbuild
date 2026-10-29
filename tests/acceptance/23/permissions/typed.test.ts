// An approval typed in the session becomes a saved decision only after one click in the CLI: README.md, Criteria. The scenario (scenarios.ts) runs on the real hub,
// deep-hook and CLI; INCONCLUSIVE (a hook the machine made late) is a skip, never a pass.
import { afterEach, test } from 'vitest';
import { cleanup, TYPED, verdict } from './helpers.ts';
import { typedApproval } from './scenarios.ts';

afterEach(cleanup);

test(`${TYPED} an approval typed in the session becomes a saved decision only after one click in the CLI`, { timeout: 20 * 60_000 }, async (ctx) => {
  await verdict(ctx, () => typedApproval());
});
