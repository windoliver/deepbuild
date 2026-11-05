// #82 AC7: a stop that ends on "No response requested" after work, with requirements open, gets a completion prompt
// within one hook, and a fourth such stop becomes a stalled claim (Scope: "A stop that did work but ends on an empty
// or near-empty message gets a completion prompt, at most three times, and then becomes a stalled claim").
//
// The requirement is open but not failing, so a completion prompt can't be mistaken for a send-back: item 61's R1,
// "The checkout journey accepts a valid token", is judged by checkout-journey.sh, handed with an expected time of 10
// minutes, so it never fits a stop's fast lane and stays pending at every stop (design: Fast and slow lanes). Its
// control, item 62, with the same definition, stops after the same edit with words; that stop goes through, pending.
// In item 61 the agent edits src/auth.js and then ends its turn four times on Claude Code's synthetic "No response
// requested." with no call between: each of the first three gets a completion prompt in the Stop's own reply (the
// turn goes on), no claim.stalled is recorded before the fourth, and the fourth becomes a stalled claim
// (claim.stalled on the session's claim) and is let through.
import { afterAll, describe, it } from 'vitest';
import { verdict, FIX,
  AC7, CHECKS, CRITERIA, NO_RESPONSE, SLOW_MS, blocked, claimsOf, cleanup, handles, item, lastPos, listed, makeWorld, must, replyText,
  Session, settle, shown, startHub, startOnItem, type Ev,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const JOURNEY = [{ text: CRITERIA.journey, check: CHECKS.journey, on_base: 'passes' as const, expected_ms: SLOW_MS }];
const stalledOn = (events: readonly Ev[], claims: Set<string>, since: number) => events.filter((e) => e.kind === 'claim.stalled' && e.log_pos > since && (claims.has(String(e.data.claim)) || claims.has(String(e.subject))));

describe(`${AC7} "No response requested" after work gets a completion prompt, three times at most, and then a stalled claim`, () => {
  it(`${AC7} item 61: R1 pending, three stops on "${NO_RESPONSE}" each get a completion prompt in the Stop's reply, and the fourth becomes a stalled claim; item 62's worded stop goes through`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld({ items: [item(61, 'The checkout journey', JOURNEY), item(62, 'The checkout journey', JOURNEY)] });
    const hub = await startHub(w);

    const control = new Session(w);
    await startOnItem(hub, control, 62, `${AC7} [item 62]`);
    await control.edit(FIX.file, FIX.from, FIX.to);
    const worded = await control.stop('checkToken now rejects a token whose exp has passed. The checkout journey still has to run.');
    must(!blocked(worded), `BLOCKED: ${AC7} [item 62, the control] a stop with words whose only requirement is pending goes through, so a kept-going stop below is a completion prompt, not a send-back: ${shown(worded)}`);

    const s = new Session(w);
    const ref = await startOnItem(hub, s, 61, `${AC7} [item 61]`);
    await s.edit(FIX.file, FIX.from, FIX.to);
    const since = await lastPos(hub);
    for (let n = 1; n <= 3; n++) {
      const stop = await s.stop(NO_RESPONSE, { synthetic: true });
      must(blocked(stop) && replyText(stop).length > 0, `${AC7} stop ${n} after work ends on "${NO_RESPONSE}" with R1 open, so it gets a completion prompt within one hook, its own Stop reply (${n} of at most 3); deep-hook let it through: ${shown(stop)}`);
      const events = await settle(hub, () => true);
      const early = stalledOn(events, handles(claimsOf(events, ref, since)), since);
      must(early.length === 0, `${AC7} no stalled claim before the fourth such stop; after stop ${n}: ${listed(early)}`);
    }
    const fourth = await s.stop(NO_RESPONSE, { synthetic: true });
    const events = await settle(hub, (all) => stalledOn(all, handles(claimsOf(all, ref, since)), since).length > 0, 20_000);
    const stalled = stalledOn(events, handles(claimsOf(events, ref, since)), since);
    must(stalled.length > 0, `${AC7} the fourth stop on "${NO_RESPONSE}" becomes a stalled claim: no claim.stalled on the session's claims (${listed(claimsOf(events, ref, since))}); the fourth stop's reply: ${shown(fourth)}`);
    must(!blocked(fourth), `${AC7} the fourth stop is no fourth completion prompt: it is let through as a stalled claim: ${shown(fourth)}`);
  }), 600_000);
});
