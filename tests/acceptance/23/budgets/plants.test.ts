// The wrong programs the budget criteria name, planted around the real program (plants.ts): each criterion's
// scenario must fail on its plant, naming what the criterion says it names.

import { expect, test } from 'vitest';
import { openBudgetWorld, type BudgetPlanting, type BudgetWorld } from './helpers.ts';
import { chargedOnly, repoIgnored } from './plants.ts';
import { doesNotFit, insideBudget } from './scenarios.ts';

async function onPlant(plant: BudgetPlanting, scenario: (b: BudgetWorld) => Promise<void>, named: RegExp): Promise<void> {
  const b = await openBudgetWorld(plant);
  try {
    await expect(scenario(b)).rejects.toThrow(named);
  } finally {
    await b.close();
  }
}

// A resolver that reads what's left from its own count also says that count to the agent, so it may fail first at
// the run before: the answer to a run inside the budget says more is left than the core's ledger holds.
test('#23.d3776517 fails on a resolver that answers from its own count of what was charged, which lets the $4 run through while the $7 reservation is unpriced', async () => {
  await onPlant(chargedOnly, doesNotFit, new RegExp([
    /run run:[0-9A-Z]+, \$4, against budget \S+ with \$3 left counting run run:[0-9A-Z]+'s \$7 reserved and not yet charged \(\$10 counting only what was charged\): ask:[0-9A-Z]+ reaches you, not decided for you by \[decision:/.source,
    /inside budget \S+ \(\$12\): the answer handed to the agent names budget \S+ and says \$10 is left in it: expected \{[^}]*\} to deeply equal/.source,
  ].join('|')));
});

test('#23.67403f66 fails on a resolver that never reads which repo a paid run was asked in, which answers the run in repoB from the budget of repoA', async () => {
  await onPlant(repoIgnored, insideBudget, /\$1 asked in repoB, which no budget you approved covers(: ask:[0-9A-Z]+ reaches you, not decided for you by \[decision:|: its card names no budget)/);
});
