// The wrong programs the issue names, planted around the real ledger (plants.ts): each criterion's
// scenario must fail on its plant, naming what the criterion says it names.

import { expect, test } from 'vitest';
import { openWorld, type Planting, type World } from './helpers.ts';
import { anyCharge, asksEachRun, existsOnly, forgetsFailures, issueOnly, keepsFirstReservation, releasedAtRunEnd, unknownPriceFree } from './plants.ts';
import { agentBatch, failedNotRerun, gpuAndIssue, gpuRace, plantedCharge, releasedOnlyOnCost, resolverNamesBudget, unknownPrice } from './scenarios.ts';

async function onPlant(plant: Planting, scenario: (w: World) => Promise<void>, named: RegExp): Promise<void> {
  const w = await openWorld(plant);
  try {
    await expect(scenario(w)).rejects.toThrow(named);
  } finally {
    await w.close();
  }
}

test('#86.80a13633 fails on a ledger that counts a price nobody knows as free, naming the missing price', async () => {
  await onPlant(unknownPriceFree, unknownPrice, /whose check hosted\.browser-journey has no known price, is BLOCKED for its price/);
});

test('#86.80a13633 fails on a ledger that releases a reservation when its run ends, before its cost reading lands', async () => {
  await onPlant(releasedAtRunEnd, releasedOnlyOnCost, /ended with no cost reading: its reservation still holds/);
});

test('#86.54597aa8 fails on a ledger that asks you for each paid run inside the budget', async () => {
  await onPlant(asksEachRun, agentBatch, /an agent's own batch of paid runs inside the budget asks nothing/);
});

test('#86.3dccb0b7 fails on a ledger that runs a failed run again on the same inputs', async () => {
  await onPlant(forgetsFailures, failedNotRerun, /re-runs failed run run:[0-9A-Z]+ on the same inputs without a change or your yes/);
});

test("#86.40d0717c fails on a ledger that covers a run by its issue's budget only, naming the GPU's budget", async () => {
  await onPlant(issueOnly, gpuAndIssue, /reserves \$3 against both the GPU's budget/);
});

test('#86.020ce247 fails on a core that checks only that the named budget exists, which applies the first answer', async () => {
  await onPlant(existsOnly, resolverNamesBudget, /expected the core to refuse it, naming \{"budget":"[^"]+"\}/);
});

test('#86.97e5a476 fails on a ledger that takes a charge for a run that never reserved, naming the run', async () => {
  await onPlant(anyCharge, plantedCharge, /a planted extension reports a \$5 charge for run run:[0-9A-Z]+, which never reserved/);
});

test("#86.60e70718 fails on a ledger that keeps the first reservation, naming the issue's budget, in every release order", async () => {
  for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2]]) {
    await onPlant(keepsFirstReservation, gpuRace(order), /the budget \S+ of issue windoliver\/deepbuild#4[123], whose run was BLOCKED by the GPU's budget, is whole/);
  }
});
