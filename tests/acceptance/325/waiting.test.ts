// #325 AC9: two stops that did work while a step only you can take is open, each with the same failing check and the
// same open items, aren't sent back and count toward neither limit: after your answer is delivered, the next stop is
// sent back as round 1 of 3, and the decision comes only from stops after it. A rule that counts the waiting stops
// raises the decision while the ask is still open and fails this test (design: A question holds the send-back;
// Stalled claims; How we know version 0 works, A question holds the send-back).
//
// Item 25 (26 for the wrong program): R1 passes after FLAG; R2's check fails on every commit. The agent raises an
// unblock task through deep_ask, proved by the spec's unit check (README, The step only you can take).
import { afterEach, describe, it } from 'vitest';
import { AC9, cleanup, failureOf, must } from './helpers.ts';
import { waitingThenAnswer } from './scenarios.ts';

afterEach(cleanup, 60_000);

describe(`${AC9} stops while a step only you can take is open count toward neither limit`, () => {
  it(`${AC9} item 25: two waiting stops aren't sent back and raise no decision; after your answer is delivered the next stop is sent back 1/3; the decision comes only after it`, async () => {
    await waitingThenAnswer(25, AC9);
  }, 360_000);

  it(`${AC9} (wrong program) a rule that counts the waiting stops (DEEP_HUB_PLANT=counts-waiting-stops) raises the decision while the ask is still open and fails`, async () => {
    const message = await failureOf(() => waitingThenAnswer(26, AC9, 'counts-waiting-stops'));
    must(message !== null, `${AC9} the scenario must fail on the planted rule, which counts the stops made while the ask is open; it passed`);
    must(/no decision is raised while ask:\S+ is still open/.test(message!), `${AC9} the planted rule fails by raising the decision while the ask is still open: ${message}`);
  }, 360_000);
});
