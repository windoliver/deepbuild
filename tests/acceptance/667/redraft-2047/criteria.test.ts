// #667 AC3, AC4 and AC5 on the real hub, redrafted blind at 531da1ef0 (README.md). One test per criterion, each on a
// world of its own (world.ts).

import { afterEach, test, type TestContext } from 'vitest';
import { cleanup } from '../helpers.ts';
import { AC3, AC4, AC5, ac3, ac4, ac5, Inconclusive } from './world.ts';

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

test(`${AC3} the authority ask answered from a process inside the asking session's process tree is refused and stays open; answered by the person with the OS confirmation, it counts; with the confirmation cancelled, it saves no decision and stays open`, async (ctx) => {
  await judged(ctx, () => ac3());
}, 600_000);

test(`${AC4} with the clock moved past the choice ask's deadline and no answer, it takes its default, announced on the stream and recorded as defaulted, and an undo opens it again; the authority ask past its deadline takes no, recorded as defaulted`, async (ctx) => {
  await judged(ctx, () => ac4());
}, 600_000);

test(`${AC5} the sixth open ask from one session lands inside one "this session keeps asking" exception in deep inbox, and answering that exception in bulk closes all six; a hub that lets the deadline pass with the ask still open fails this test, naming the ask`, async (ctx) => {
  await judged(ctx, () => ac5());
}, 600_000);
