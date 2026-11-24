// AC2's "gets the answer once" on the hub's planted wrong program `sends-shown-again` (packages/hub/src/plant.ts: it
// keeps no answer in flight, so each later route sends it again without reading the session): AC2's own scenario
// (world.ts) must fail there, naming the criterion and the ask. AC1's wrong program and AC2's scope wrong program
// are mutants no plant reaches; mutants.sh lays them over a clone of the base (README: Wrong programs).

import { afterEach, expect, test, type TestContext } from 'vitest';
import { cleanup } from '../helpers.ts';
import { AC2, ac2, Inconclusive } from './world.ts';

afterEach(cleanup, 30_000);

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The scenario on the plant must fail with `failure`; a reading load spoiled skips the test with it. */
async function failsOn(ctx: TestContext, tag: string, plant: string, scenario: (plant: string) => Promise<void>, failure: RegExp): Promise<void> {
  let thrown: unknown;
  try {
    await scenario(plant);
  } catch (error) {
    thrown = error;
  }
  if (thrown instanceof Inconclusive) ctx.skip(thrown.message);
  const message = thrown instanceof Error ? thrown.message : String(thrown);
  console.log(`==== ${tag} on ${plant}: the scenario's failure\n${message}\n`);
  expect(thrown, `${tag}: the scenario passed on the planted hub ${plant}`).toBeDefined();
  expect(message, `${tag}: the scenario on the planted hub ${plant} fails, naming the criterion and the ask`).toMatch(failure);
}

test(`${AC2} #667.b25a1d05 AC2 (wrong program) a planted hub that sends an answer again at each later route (sends-shown-again) fails this criterion`, async (ctx) => {
  await failsOn(ctx, AC2, 'sends-shown-again', ac2, new RegExp(`^${esc(AC2)}: the agent that raised ask:[0-9A-Z]{26} got your answer [2-9] times, once expected`));
}, 300_000);
