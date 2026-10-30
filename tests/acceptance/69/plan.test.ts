// Criteria 1, 2, 3 and 6: every authority ask carries a plan; a run is held to the plan your yes approved;
// a step with no undo is marked "can't undo" and anything irreversible defaults to no; in a batch such a step
// starts switched off. Each test runs its criterion's scenario (scenarios.ts) on a fresh world.

import { afterEach, test } from 'vitest';
import { openWorld, type World } from './helpers.ts';
import { addedStepStops, batchSwitchedOff, irreversibleDefaultsNo, markedCantUndo, noPlanNoAsk } from './scenarios.ts';

let world: World | undefined;
afterEach(async () => { await world?.close(); world = undefined; });
const fresh = async (): Promise<World> => (world = await openWorld());

test("#69.9eb13dee an authority ask without a plan can't be created, from any source of authority asks, the core's or an agent's, nor with a plan of no steps", async () => {
  await noPlanNoAsk(await fresh());
});

test('#69.f54debdc a run that adds a step after your yes stops before the step and asks again, once; your yes to the new plan runs it', async () => {
  await addedStepStops(await fresh());
});

test(`#69.3f9c3f3d a step with no undo is marked "can't undo" in its plan, on its card and in the record`, async () => {
  await markedCantUndo(await fresh());
});

test('#69.3f9c3f3d anything irreversible still defaults to no, even when its raiser names the approving option as its default', async () => {
  await irreversibleDefaultsNo(await fresh());
});

test(`#69.275c8f18 in a batch, a step marked "can't undo" starts switched off and runs only after its own switch is turned on`, async () => {
  await batchSwitchedOff(await fresh());
});
