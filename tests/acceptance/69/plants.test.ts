// The wrong programs (plants.ts): each criterion's scenario must fail on its plant, naming what the criterion
// says it names.

import { expect, test } from 'vitest';
import { openBuyingWorld, type BuyingPlanting, type BuyingWorld } from './buying.ts';
import { noCardNumber, reservedPurchasesCount } from './buying-scenarios.ts';
import { openWorld, type Planting, type World } from './helpers.ts';
import { askSwitch, chargesAlone, defaultsYes, logsProcessor, placeholderPlan, slowPreview, startsOn, undoPlaceholder, yesOnly } from './plants.ts';
import { addedStepStops, batchSwitchedOff, irreversibleDefaultsNo, markedCantUndo, noPlanNoAsk, previewRuns } from './scenarios.ts';
import { judge } from './timing.ts';

async function onPlant(plant: Planting, scenario: (w: World) => Promise<void>, named: RegExp): Promise<void> {
  const w = await openWorld(plant);
  try {
    await expect(scenario(w)).rejects.toThrow(named);
  } finally {
    await w.close();
  }
}
async function onBuyingPlant(plant: BuyingPlanting, scenario: (w: BuyingWorld) => Promise<void>, named: RegExp): Promise<void> {
  const w = await openBuyingWorld(plant);
  try {
    await expect(scenario(w)).rejects.toThrow(named);
  } finally {
    await w.close();
  }
}

test('#69.9eb13dee fails on a core that drafts a placeholder plan for an authority ask raised without one', async () => {
  await onPlant(placeholderPlan, noPlanNoAsk, /an authority ask from effect\.push without a plan: expected the core to refuse it, naming plan/);
});

test('#69.f54debdc fails on a run held to your yes and not to the plan it approved, naming the added step', async () => {
  await onPlant(yesOnly, addedStepStops, /a run that adds a step after your yes stops before "Delete branch release-1\.3 on origin"/);
});

test(`#69.3f9c3f3d fails on a core that fills a missing undo with a placeholder, naming the step`, async () => {
  await onPlant(undoPlaceholder, async (w) => { await markedCantUndo(w); }, /"Empty and delete the bucket s3:\/\/logs-2025", given with no undo, is marked can't undo in its plan/);
});

test('#69.3f9c3f3d fails on a core whose default approves an irreversible step', async () => {
  await onPlant(defaultsYes, irreversibleDefaultsNo, /anything irreversible still defaults to no: ask:[0-9A-Z]+/);
});

test(`#69.275c8f18 fails on a batch whose every step starts switched on, naming the step that can't be undone`, async () => {
  await onPlant(startsOn, batchSwitchedOff, /"Empty and delete the bucket s3:\/\/logs-2025", marked can't undo, starts switched off/);
});

test("#69.275c8f18 fails on one switch per ask, where turning on one step that can't be undone runs its ask's others", async () => {
  await onPlant(askSwitch, batchSwitchedOff, /"Drop table sessions_2023 on the production database" runs though only another step's switch was turned on/);
});

test('#69.06d40ef2 fails on a processor adapter that logs the receipt with the card number under the state folder, naming the file', async () => {
  await onBuyingPlant(logsProcessor, noCardNumber, /DeepBuild stores the card number in these files under its state folder[\s\S]*logs\/processor\.log/);
});

test('#69.d8443973 fails on a check against charges alone, which lets the second $60 purchase through', async () => {
  await onBuyingPlant(chargesAlone, reservedPurchasesCount, /with \$100 approved and the first \$60 purchase reserved and still unpriced, a second \$60 purchase asks/);
});

test("#69.eb8b7be8 fails on a preview that takes 2.5 s to draft, judged by the timing rule wherever it runs", async (ctx) => {
  await onPlant(slowPreview, async (w) => { judge(ctx, "#69 a plan's preview drafted on the plant (ms)", await previewRuns(w), 2000, null); }, /FAIL #69 a plan's preview drafted on the plant/);
}, 120_000);
