// A permission prompt whose ask was cancelled (its hold ended with no answer in) gets cancel, never deny: README.md, Criteria. The scenario (scenarios.ts) runs on the real hub,
// deep-hook and CLI; INCONCLUSIVE (a hook the machine made late) is a skip, never a pass.
import { afterEach, test } from 'vitest';
import { cleanup, CANCEL, verdict } from './helpers.ts';
import { cancelledPrompt } from './scenarios.ts';

afterEach(cleanup);

test(`${CANCEL} a permission prompt whose ask was cancelled (its hold ended with no answer in) gets cancel, never deny`, { timeout: 20 * 60_000 }, async (ctx) => {
  await verdict(ctx, () => cancelledPrompt());
});
