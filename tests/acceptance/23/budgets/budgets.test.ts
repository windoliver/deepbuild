// #23.67403f66 a per-run approval request inside an approved budget is answered without reaching you, logged as
// decided for you; and #23.d3776517 a per-run request whose price doesn't fit what's left of the budget the
// resolver names, counting runs reserved and not yet charged, is refused by the core and reaches you naming it.

import { test } from 'vitest';
import { inBudgetWorld } from './helpers.ts';
import { doesNotFit, insideBudget } from './scenarios.ts';

test('#23.67403f66 a paid run asked in a repo whose budget you approved is answered from that budget without reaching you, logged as decided for you and saying how much is left; one asked in another repo reaches you', async () => {
  await inBudgetWorld(insideBudget);
});

test("#23.d3776517 a paid run whose price fits what was charged but not what's left counting a run reserved and not yet charged is refused by the core and reaches you naming the budget; once that run's cost reading lands, the next run fits", async () => {
  await inBudgetWorld(doesNotFit);
});
