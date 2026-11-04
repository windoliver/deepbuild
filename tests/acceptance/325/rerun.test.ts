// #325 AC8: an agent that reruns the same failing check between stops with the same result is sent back three times
// and then reaches the inbox as one decision; a rule that counts any new run as new evidence keeps sending it back
// and fails this test (design: Stalled claims: "New evidence is a requirement whose result changed or a check that
// newly covers one; another run with the same result is not").
//
// Item 23 (24 for the wrong program): R1 passes after FLAG; R2's check fails on every commit. Before each stop the
// agent runs R2's check itself and works a round, so the gate runs it again with the same result; each stop reports
// other open items, so the two-stops rule (AC3) never applies and only the three send-backs do.
import { afterEach, describe, it } from 'vitest';
import { AC8, cleanup, failureOf, must } from './helpers.ts';
import { rerunToDecision } from './scenarios.ts';

afterEach(cleanup, 60_000);

describe(`${AC8} the same failing check rerun with the same result: three send-backs, then one decision`, () => {
  it(`${AC8} item 23: stops 1 to 3 are sent back, stop 4 isn't, and one decision with split, fund and accept is in the inbox after the third`, async () => {
    await rerunToDecision(23, AC8);
  }, 300_000);

  it(`${AC8} (wrong program) a rule that counts any new run as new evidence (DEEP_HUB_PLANT=new-run-is-evidence) keeps sending it back and fails`, async () => {
    const message = await failureOf(() => rerunToDecision(24, AC8, 'new-run-is-evidence'));
    must(message !== null, `${AC8} the scenario must fail on the planted rule, which counts each new run of the failing check as new evidence; it passed`);
    must(/fourth stop must not be sent back/.test(message!), `${AC8} the planted rule fails by sending the fourth stop back: ${message}`);
  }, 300_000);
});
