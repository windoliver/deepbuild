// With the hub stopped, the standing rule the hub copied into rules.json allows and records a KMS key in its account; another account is still denied with the reason: README.md, Criteria. The scenario (scenarios.ts) runs on the real hub,
// deep-hook and CLI; INCONCLUSIVE (a hook the machine made late) is a skip, never a pass.
import { afterEach, test } from 'vitest';
import { cleanup, HUB_DOWN, verdict } from './helpers.ts';
import { hubStopped } from './scenarios.ts';

afterEach(cleanup);

test(`${HUB_DOWN} with the hub stopped, the standing rule the hub copied into rules.json allows and records a KMS key in its account; another account is still denied with the reason`, { timeout: 20 * 60_000 }, async (ctx) => {
  await verdict(ctx, () => hubStopped());
});
