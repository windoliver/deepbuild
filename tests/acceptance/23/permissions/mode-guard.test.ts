// A saved decision never allows a call the session's permission mode (dontAsk, plan) or a guard of yours denies: README.md, Criteria. The scenario (scenarios.ts) runs on the real hub,
// deep-hook and CLI; INCONCLUSIVE (a hook the machine made late) is a skip, never a pass.
import { afterEach, test } from 'vitest';
import { cleanup, MODE_GUARD, verdict } from './helpers.ts';
import { modeAndGuard } from './scenarios.ts';

afterEach(cleanup);

test(`${MODE_GUARD} a saved decision never allows a call the session's permission mode (dontAsk, plan) or a guard of yours denies`, { timeout: 20 * 60_000 }, async (ctx) => {
  await verdict(ctx, () => modeAndGuard());
});
