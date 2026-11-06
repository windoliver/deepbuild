// #84 AC17: items on a stop's own still-open list are sorted like questions: work inside the ask goes back with "proceed",
// and work outside it shows on the line as a follow-up (the issue's Scope; design: Open items).
//
// Item 31: R1 passes once the agent makes FIX and FLAG; R2, "A dropped connection is retried", is unstarted, so its check
// fails. The final message lists R2 and a job no requirement names. The reply sends the agent on: "proceed", and R2. A
// plain send-back on R2's failing check, which the base gives, is not enough: the list's item has to be sorted.
import { afterAll, describe, it } from 'vitest';
import {
  AC17, CHECKS, CRITERIA, asksNaming, blocked, chatLine, cleanup, item, lastPos, listed, makeWorld, must, names, proceededIn, replyText, saysProceed,
  Session, settle, shown, startHub, startOnItem, verdict,
} from './helpers.ts';

const OUTSIDE = 'Migrate the billing exports to the new SDK';
const WORDS = `checkToken rejects expired tokens now.\n\nStill open:\n- ${CRITERIA.retry}: not started\n- ${OUTSIDE}`;

afterAll(cleanup, 60_000);

describe(`${AC17} a stop whose still-open list names an unstarted fix inside the ask is sent back with "proceed", and an item outside the ask shows on the line as a follow-up`, () => {
  it(`${AC17} item 31: "${CRITERIA.retry}" goes back with "proceed", recorded as a proceed; "${OUTSIDE}" shows on the verdict line as a follow-up and raises no ask`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({ items: [item(31, 'Expired tokens are accepted and connections drop', [{ text: CRITERIA.expired, check: CHECKS.expired }, { text: CRITERIA.retry, check: CHECKS.retry }])] });
    const hub = await startHub(w);
    const s = new Session(w);
    await startOnItem(hub, s, 31, AC17);
    await s.green();
    const since = await lastPos(hub);
    const stop = await s.stop(WORDS);
    const events = await settle(hub, (all) => proceededIn(all, s, since).length > 0, 10_000);
    const reply = replyText(stop);
    must(blocked(stop) && saysProceed(stop), `${AC17} the stop whose list names the unstarted "${CRITERIA.retry}", inside the ask, goes back with "proceed": ${shown(stop)}`);
    must(names(reply, 'R2', CRITERIA.retry), `${AC17} the reply names R2 ("${CRITERIA.retry}"): ${reply.slice(0, 600)}`);
    const proceeds = proceededIn(events, s, since);
    must(proceeds.some((e) => String(e.data.question).includes(CRITERIA.retry)), `${AC17} the proceed is recorded with the list's item, as a question's is: ${listed(proceeds)}`);
    must(!proceeds.some((e) => String(e.data.question).includes(OUTSIDE)), `${AC17} "${OUTSIDE}" is outside the ask, so no "proceed" covers it: ${listed(proceeds)}`);
    const line = chatLine(stop);
    must(/follow-?up/i.test(line) && line.includes('billing exports'), `${AC17} "${OUTSIDE}" shows on the line as a follow-up: the line is ${JSON.stringify(line)}`);
    must(asksNaming(events, since, 'billing exports').length === 0, `${AC17} a follow-up is no ask: ${listed(asksNaming(events, since, 'billing exports'))}`);
  }), 600_000);
});
