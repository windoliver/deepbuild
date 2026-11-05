// #82 AC1 and AC2: honest stops are judged like "done" (design: Every stop is judged, "an agent that lists what is
// still unverified, or ends with 'want me to open the PR?', is judged the same way as one that says 'done'").
//
// One hub, three sessions, each on an item of its own whose R1, "An expired token is rejected with 401", is judged by
// the drafted check expired-token.sh, which fails until FLAG. Each session fixes the unit test (FIX) and not R1, so
// R1 is unmet at every stop, and stops with different last words:
//   item 11  "… Want me to open the PR?"                                     (AC1)
//   item 12  "Done."                                                         (AC2, the control)
//   item 13  what it changed, then a "Not verified:" list                    (AC2)
// AC1: the PR offer is held and sent back: the Stop is blocked, the record has a claim.sent_back for its claim, and the
// reason names R1. AC2: the "Not verified" stop is judged the same as "Done.": both make a claim for their task, both
// get a verdict, the same outcome, and both are sent back naming R1. A gate that judges only stops that say done, or
// that answers a PR offer instead of judging it, fails here.
import { afterAll, describe, it } from 'vitest';
import {
  AC1, AC2, CRITERIA, EXPIRED, FIX, blocked, claimsOf, cleanup, handles, item, lastPos, listed, makeWorld, must, names, replyText,
  sendBacksIn, Session, settle, shown, startHub, startOnItem, verdict, verdictsIn, type Ev, type Hub, type Ran,
} from './helpers.ts';

const WORDS = {
  offer: 'checkToken now rejects a token whose exp has passed, and the unit test passes. Want me to open the PR?',
  done: 'Done.',
  unverified: 'checkToken now rejects a token whose exp has passed, and the unit test passes.\n\nNot verified:\n- the 401 status on an expired token\n- the checkout flow end to end',
} as const;
type Kind = keyof typeof WORDS;
const ITEMS: Record<Kind, number> = { offer: 11, done: 12, unverified: 13 };

interface Judged { stop: Ran; claims: Ev[]; verdicts: Ev[]; sentBack: Ev[] }
/** The three stops, driven once on one hub and read by both criteria's tests. */
let setup: Promise<Record<Kind, Judged>> | undefined;
const stops = (): Promise<Record<Kind, Judged>> => (setup ??= drive());
async function drive(): Promise<Record<Kind, Judged>> {
  const judged: Partial<Record<Kind, Judged>> = {};
  const w = makeWorld({ items: (Object.keys(ITEMS) as Kind[]).map((k) => item(ITEMS[k], 'Expired tokens are accepted', [EXPIRED])) });
  const hub: Hub = await startHub(w);
  for (const kind of Object.keys(ITEMS) as Kind[]) {
    const s = new Session(w);
    const ref = await startOnItem(hub, s, ITEMS[kind], `[${kind}]`);
    await s.edit(FIX.file, FIX.from, FIX.to);
    const since = await lastPos(hub);
    const stop = await s.stop(WORDS[kind]);
    const events = await settle(hub, (all) => { const c = claimsOf(all, ref, since); return c.length > 0 && verdictsIn(all, since).some((v) => handles(c).has(String(v.data.claim ?? v.subject))); }, 60_000);
    const claims = claimsOf(events, ref, since);
    const mine = handles(claims);
    judged[kind] = { stop, claims, verdicts: verdictsIn(events, since).filter((v) => mine.has(String(v.data.claim ?? v.subject))), sentBack: sendBacksIn(events, since).filter((e) => mine.has(String(e.data.claim))) };
  }
  return judged as Record<Kind, Judged>;
}
afterAll(cleanup, 60_000);

const outcome = (j: Judged) => String(j.verdicts[j.verdicts.length - 1]?.data.outcome ?? j.verdicts[j.verdicts.length - 1]?.data.verdict ?? 'none');

describe(`${AC1} a stop ending "want me to open the PR?" with unmet requirements is held and sent back`, () => {
  it(`${AC1} item ${ITEMS.offer}: R1 unmet, the stop ending "Want me to open the PR?" is blocked, recorded as a send-back of its claim, and names R1`, async (ctx) => verdict(ctx, async () => {
    const j = (await stops()).offer;
    must(j.claims.length > 0, `${AC1} the stop that did work (an edit) is a claim for its task: no claim.made after it`);
    must(blocked(j.stop), `${AC1} with R1 ("${CRITERIA.expired}") unmet, the stop ending "Want me to open the PR?" is held and sent back; deep-hook let it through: ${shown(j.stop)}`);
    must(j.sentBack.length > 0, `${AC1} the record holds a claim.sent_back for the stop's claim: ${listed(j.claims)}`);
    must(names(replyText(j.stop), 'R1', CRITERIA.expired) || replyText(j.stop).includes('expired-token.sh'), `${AC1} the send-back names R1, its text or its check: ${replyText(j.stop).slice(0, 500)}`);
  }), 600_000);
});

describe(`${AC2} a stop that lists what's unverified is judged the same as one that says done`, () => {
  it(`${AC2} items ${ITEMS.done} and ${ITEMS.unverified}: "Done." and a "Not verified:" list each make a claim, get the same verdict and are both sent back naming R1`, async (ctx) => verdict(ctx, async () => {
    const { done, unverified: listing } = await stops();
    for (const [what, j] of [['"Done."', done], ['the "Not verified:" list', listing]] as const) {
      must(j.claims.length > 0, `${AC2} the stop ending ${what}, after an edit, is a claim for its task: no claim.made after it`);
      must(j.verdicts.length > 0, `${AC2} the stop ending ${what} gets a verdict on its claim: none recorded`);
    }
    must(blocked(done.stop), `${AC2} (control) with R1 unmet, the stop that says "Done." is sent back: ${shown(done.stop)}`);
    must(outcome(listing) === outcome(done), `${AC2} the stop listing what's unverified gets the same verdict as the one that says done: ${outcome(listing)} against ${outcome(done)}`);
    must(blocked(listing.stop), `${AC2} the stop listing what's unverified is sent back as the "Done." stop is: deep-hook let it through: ${shown(listing.stop)}`);
    must(listing.sentBack.length > 0, `${AC2} the record holds a claim.sent_back for the listing stop's claim, as for "Done.": ${listed(listing.claims)}`);
    must(names(replyText(listing.stop), 'R1', CRITERIA.expired) || replyText(listing.stop).includes('expired-token.sh'), `${AC2} its send-back names R1, its text or its check: ${replyText(listing.stop).slice(0, 500)}`);
  }), 600_000);
});
