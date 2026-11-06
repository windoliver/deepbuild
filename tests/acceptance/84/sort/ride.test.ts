// #84 AC28: a "proceed" rides in the stop's one reply with the send-back's failing requirements (design: A question holds
// the send-back, "so an agent told to go on knows what is still failing").
//
// Item 91: the requirement "the receipt shows $18.01" fails, since src/receipt.js shows $18.00. The agent makes FIX, so
// the unit test passes, and ends "want me to run the e2e suite?". The one reply carries the proceed, the requirement and
// its smallest failing case: the `smallest` the verdict recorded for it, read by the $18.00 it shows, as the design's
// line does ("receipt shows $18.00"). A hub that sends the proceed alone fails, naming the requirement.
import { afterAll, describe, it } from 'vitest';
import {
  AC28, CHECKS, CRITERIA, FIX, blocked, cleanup, failureOf, item, lastPos, listed, makeWorld, must, proceededIn, replyText, saysProceed, sendBacksIn, Session, settle,
  shown, startHub, startOnItem, verdict, verdictsIn, type Line,
} from './helpers.ts';

const QUESTION = 'want me to run the e2e suite?';
/** What src/receipt.js shows: the part of the check's failure the requirement's own words don't hold. */
const ACTUAL = '$18.00';

async function scenario(n: number, plant?: string): Promise<void> {
  const w = makeWorld({ items: [item(n, 'The receipt is a cent short', [{ text: CRITERIA.receipt, check: CHECKS.receipt }])] });
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  await startOnItem(hub, s, n, AC28);
  await s.edit(FIX.file, FIX.from, FIX.to);
  const since = await lastPos(hub);
  const stop = await s.stop(`The unit test passes. ${QUESTION}`);
  const events = await settle(hub, (all) => proceededIn(all, s, since).length > 0 && verdictsIn(all, since).length > 0, 10_000);
  const reply = replyText(stop);
  must(blocked(stop) && saysProceed(stop), `${AC28} the stop ending "${QUESTION}" gets a reply carrying the proceed: ${shown(stop)}`);
  must(proceededIn(events, s, since).some((e) => String(e.data.question).includes('e2e suite')), `${AC28} the proceed is recorded: ${listed(proceededIn(events, s, since))}`);
  must(reply.includes(CRITERIA.receipt), `${AC28} one reply carries the proceed and the failing requirement '${CRITERIA.receipt}': it carries ${reply.slice(0, 600)}`);
  const verdicts = verdictsIn(events, since);
  const failing = verdicts.flatMap((v) => (v.data.requirements ?? []) as Line[]).find((q) => q.outcome === 'FAIL' && typeof q.smallest === 'string');
  const smallest = String(failing?.smallest ?? verdicts.find((v) => v.data.smallest)?.data.smallest ?? '');
  must(smallest.includes(ACTUAL), `BLOCKED: ${AC28} the verdict records the requirement's smallest failing case, with the ${ACTUAL} the check found: ${listed(verdicts)}`);
  must(reply.includes(ACTUAL), `${AC28} the reply carries '${CRITERIA.receipt}' with its smallest failing case, ${JSON.stringify(smallest.slice(0, 200))}, which shows ${ACTUAL}: ${reply.slice(0, 600)}`);
  must(sendBacksIn(events, since).length > 0, `${AC28} the claim is sent back as it would be with no question: no claim.sent_back for '${CRITERIA.receipt}'`);
}

afterAll(cleanup, 60_000);

describe(`${AC28} a stop answered "proceed" while a requirement fails gets one reply carrying the proceed and that requirement with its smallest failing case`, () => {
  it(`${AC28} item 91: "${QUESTION}", '${CRITERIA.receipt}' failing: one reply carries the proceed, the requirement and its smallest failing case`, async (ctx) => verdict(ctx, () => scenario(91)), 600_000);

  it(`${AC28} (wrong program) a hub that sends the proceed alone (DEEP_HUB_PLANT=proceed-alone) fails this test, naming the requirement`, async (ctx) => verdict(ctx, async () => {
    const why = await failureOf(() => scenario(92, 'proceed-alone'));
    must(why !== null, `${AC28} the planted hub proceed-alone must fail this test; it passed`);
    must(why.includes(CRITERIA.receipt) && why.includes('one reply carries'), `${AC28} the planted hub fails naming the requirement '${CRITERIA.receipt}': ${why}`);
  }), 600_000);
});
