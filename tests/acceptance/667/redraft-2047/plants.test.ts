// The two wrong programs the issue's Proof names, planted with DEEP_HUB_PLANT (packages/hub/src/plant.ts): each
// criterion's own scenario (world.ts) runs against the planted hub and must fail, naming the criterion and the ask.

import { afterEach, expect, test, type TestContext } from 'vitest';
import { cleanup } from '../helpers.ts';
import { AC3, AC4, AC5, ac3, ac4, ac5, Inconclusive } from './world.ts';

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
  if (thrown !== undefined && !failure.test(message) && message.includes(`INCONCLUSIVE ${tag}`)) ctx.skip(message);
  expect(thrown, `${tag}: the scenario passed on the planted hub ${plant}`).toBeDefined();
  expect(message, `${tag}: the scenario on the planted hub ${plant} fails, naming the criterion and the ask`).toMatch(failure);
}

test(`${AC3} (wrong program) a planted inbox that counts an answer from inside the session's process tree (answer-inside-session) fails this criterion`, async (ctx) => {
  await failsOn(ctx, AC3, 'answer-inside-session', ac3, new RegExp(`^${esc(AC3)}: ask ask:[0-9A-Z]{26} \\(the authority ask\\), answered from inside session \\S+'s process tree with the OS confirming, counted`));
}, 600_000);

test(`${AC4} (wrong program) a planted hub that skips the default at the deadline (skip-default-at-deadline) fails this criterion`, async (ctx) => {
  await failsOn(ctx, AC4, 'skip-default-at-deadline', ac4, new RegExp(`^${esc(AC4)}: ask ask:[0-9A-Z]{26} \\(the choice ask\\) is still open \\d+ s past its deadline`));
}, 600_000);

test(`${AC5} (wrong program) a planted hub that skips the default at the deadline (skip-default-at-deadline) fails this criterion, naming the ask`, async (ctx) => {
  await failsOn(ctx, AC5, 'skip-default-at-deadline', ac5, new RegExp(`(^|\\n)${esc(AC5)}: ask ask:[0-9A-Z]{26} \\(the sixth ask, folded into the exception\\) is still open \\d+ s past its deadline`));
}, 600_000);
