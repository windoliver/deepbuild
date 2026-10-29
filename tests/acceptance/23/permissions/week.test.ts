// A permission answered from a saved decision is answered for that call or that session only, and the agent's settings files are byte-identical after a week of answers: README.md, Criteria. The scenario (scenarios.ts) runs on the real hub,
// deep-hook and CLI; INCONCLUSIVE (a hook the machine made late) is a skip, never a pass.
import { afterEach, test } from 'vitest';
import { cleanup, WEEK, verdict } from './helpers.ts';
import { weekOfAnswers } from './scenarios.ts';

afterEach(cleanup);

test(`${WEEK} a permission answered from a saved decision is answered for that call or that session only, and the agent's settings files are byte-identical after a week of answers`, { timeout: 20 * 60_000 }, async (ctx) => {
  await verdict(ctx, () => weekOfAnswers());
});
