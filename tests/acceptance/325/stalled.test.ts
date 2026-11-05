// #325 AC3 and AC4: a stalled claim. An agent that reports the same open items on two stops in a row, with no new
// passing evidence, is not sent back a third time for them; one decision with split, fund and accept reaches the
// inbox instead. A split leaves the issue closable with evidence for what passed and drafts a new issue listing what
// each remaining item needs (design: Stalled claims and Open items, in An agent says it's done).
//
// Item 21 (and 22): R1, "An expired token is rejected with 401", passes once the agent makes FLAG; R2, "A dropped
// connection is retried", and R3, "Each rejected token is logged", have drafted checks that fail on every commit the
// agent makes. Every stop ends with the same "Still open" list naming R2 and R3, and between stops the agent works a
// round (the `note` line of src/auth.js), so the checks run again with the same results.
import { afterEach, describe, it } from 'vitest';
import { AC3, AC4, cleanup } from './helpers.ts';
import { splitLeavesClosable, stallToDecision } from './scenarios.ts';

afterEach(cleanup, 60_000);

describe(`${AC3} the same open items on two stops in a row: no third send-back, one decision in the inbox`, () => {
  it(`${AC3} item 21: sent back on the first stop; by the third stop with the same open items it is no longer sent back; one decision with split, fund and accept is in the inbox`, async () => {
    await stallToDecision(21, AC3);
  }, 300_000);
});

describe(`${AC4} a split leaves the issue closable and drafts a new issue for what's left`, () => {
  it(`${AC4} item 22: answering the decision's split lets the PR say Closes #22, with R1's passing run as its evidence, and drafts a new issue listing R2 and R3 each with its check`, async () => {
    await splitLeavesClosable(22, AC4);
  }, 300_000);
});
