// #86 criteria 2 to 7 against the ledger: unknown prices, reservations held until the cost reading, an
// agent's batch, failed runs, two budgets on one run, a resolver naming a budget, and a planted charge.

import { test } from 'vitest';
import { openWorld, type World } from './helpers.ts';
import { agentBatch, failedNotRerun, gpuAndIssue, plantedCharge, releasedOnlyOnCost, resolverNamesBudget, unknownPrice } from './scenarios.ts';

async function inWorld(scenario: (w: World) => Promise<void>): Promise<void> {
  const w = await openWorld();
  try {
    await scenario(w);
  } finally {
    await w.close();
  }
}

test('#86.80a13633 a check with no known price is BLOCKED naming the missing price, never counted as free, until it is priced', async () => {
  await inWorld(unknownPrice);
});

test('#86.80a13633 a reservation is released only when its cost reading lands, not when its run ends', async () => {
  await inWorld(releasedOnlyOnCost);
});

test("#86.54597aa8 an agent's own batch of paid runs inside the budget asks nothing", async () => {
  await inWorld(agentBatch);
});

test('#86.3dccb0b7 a failed paid run is never re-run on the same inputs without a change or your yes', async () => {
  await inWorld(failedNotRerun);
});

test("#86.40d0717c a $3 GPU run reserves against the GPU's $5 budget and its issue's $10 budget; a second $3 GPU run for another issue is BLOCKED naming the GPU's budget", async () => {
  await inWorld(gpuAndIssue);
});

test('#86.020ce247 a resolver naming a budget with no room left, counting reservations, is refused and the ask reaches you; naming one with room, the run reserves and starts, decided for you', async () => {
  await inWorld(resolverNamesBudget);
});

test('#86.97e5a476 a planted extension that reports a charge for a run that never reserved is refused, naming the run, and the ledger is unchanged', async () => {
  await inWorld(plantedCharge);
});
