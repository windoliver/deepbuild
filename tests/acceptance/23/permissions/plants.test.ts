// The wrong programs (plants.ts): each criterion's scenario must fail on its plant, naming what the criterion names.
// A hub plant the program doesn't list makes the hub refuse to start: BLOCKED, never a pass.
import { afterEach, expect, test } from 'vitest';
import { CANCEL, cleanup, failureOf, verdict } from './helpers.ts';
import { cancelAsDenyAdapter, HUB_PLANTS } from './plants.ts';
import { cancelGetsCancel } from './scenarios.ts';

afterEach(cleanup);

test(`${CANCEL} plant: an adapter that answers a cancelled ask deny fails`, () => {
  expect(() => cancelGetsCancel(cancelAsDenyAdapter())).toThrow(/a cancelled ask's prompt gets cancel, never deny/);
});

for (const p of HUB_PLANTS) {
  test(`${p.criterion} plant ${p.plant}: a hub that ${p.does} fails`, { timeout: 20 * 60_000 }, async (ctx) => {
    await verdict(ctx, async () => {
      const failure = await failureOf(() => p.scenario({ plant: p.plant }));
      expect(failure, `${p.criterion} the scenario must fail on the plant ${p.plant}`).not.toBeNull();
      expect(failure).toMatch(p.named);
    });
  });
}
