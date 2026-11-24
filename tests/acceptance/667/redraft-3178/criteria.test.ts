// #667 AC1 and AC2 on the real hub, redrafted blind at 37dd3c0c8 (README.md). One test per criterion, each on a
// world of its own (world.ts).

import { afterEach, test, type TestContext } from 'vitest';
import { cleanup } from '../helpers.ts';
import { AC1, AC2, ac1, ac2, Inconclusive } from './world.ts';

afterEach(cleanup, 30_000);

/** The scenario's outcome: a reading load spoiled skips the test with that reading, never passes it. */
async function judged(ctx: TestContext, scenario: () => Promise<void>): Promise<void> {
  try {
    await scenario();
  } catch (error) {
    if (error instanceof Inconclusive) ctx.skip(error.message);
    throw error;
  }
}

test(`${AC1} #667.84442921 AC1 (the earlier suite's ID beside the computed one): deep inbox lists the choice ask with its kind, session and age within a second of its append, and the stream consumer gets its frame at the same log position`, async (ctx) => {
  await judged(ctx, () => ac1());
}, 300_000);

test(`${AC2} #667.b25a1d05 AC2 (the earlier suite's ID beside the computed one): deep inbox answer on the choice ask saves a decision with its scope, the ask leaves deep inbox, the stream shows it answered, and the test process that raised it gets the answer once`, async (ctx) => {
  await judged(ctx, () => ac2());
}, 300_000);
