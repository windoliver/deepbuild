// AC4: messages to session A from an inbox address no live session reported (a socket of a process with no hook of
// ours) are recorded `from: session` with no sender, while another live session B reported an address of its own; the
// messages' own words even give B's address, which nothing may read. At the 21st in 10 minutes the loop rule holds A,
// and its one ask says the sender is no session DeepBuild knows, naming A and never B. A hub that names any other
// session for them fails, naming that session.
import { afterAll, describe, it } from 'vitest';
import {
  AC4, ClaudeSession, PLANT, asksAfter, askText, cleanup, decision, heldMust, inbox, lastPos, listed, makeWorld, must, names,
  needRecordings, promptAsk, said, sendersNamed, settle, shown, startHub, trust, worktree, wrap, type Ran,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/**
 * The ask's words saying its sender is no session DeepBuild knows (chosen; README, Surfaces): "no session", "not a
 * session", "unknown sender", "a sender DeepBuild doesn't know", and the like.
 */
const UNKNOWN_SENDER = /\b(no|not an?|isn't an?|is not an?|unknown|unrecognized)\s+(\w+\s+){0,3}(session|sender)|\bsender\b[^.?]{0,80}\b(unknown|not known|doesn't know|does not know|no session|isn't one|is not one)/i;

async function unknownSender(plant?: string): Promise<void> {
  const w = makeWorld();
  const wa = worktree(w, 'wa', 'a/talk');
  const wb = worktree(w, 'wb', 'b/talk');
  await trust(w, [wa, wb]);
  const hub = await startHub(w, plant);
  const a = await ClaudeSession.withInbox(w, wa, 'wa');
  const b = await ClaudeSession.withInbox(w, wb, 'wb');
  // An inbox no session of ours reported: this test process's own socket, as a sender with no hook of ours would have.
  const stranger = { address: `uds:${await inbox(w, process.pid)}`, pid: process.pid, name: 'elsewhere' };
  await a.start();
  await b.start();
  await a.typed('Answer any session that writes about the cart.');
  await a.stop('Waiting.');
  await b.typed('Work on the cart alone.');
  await b.stop('On it.');
  const since = await lastPos(hub);
  const texts: string[] = [];
  let held: Ran | undefined;
  for (let k = 1; k <= 21; k++) {
    const text = `Cart question ${k} (from the session at ${b.peer.address}): does the total round each line?`;
    texts.push(text);
    const r = await a.message(stranger, text);
    if (k < 21) {
      must(decision(r) === 'allow', `BLOCKED: ${AC4} session ${a.id}'s turn ${k} from ${stranger.address} is within the limit and must go through: ${shown(r)}`);
      await a.stop('Replied.');
    } else held = r;
  }
  const events = await settle(hub, (e) => texts.every((t) => promptAsk(e, a.id, wrap(stranger, t))), 30_000);
  for (const [k, t] of texts.entries()) {
    const ask = promptAsk(events, a.id, wrap(stranger, t));
    must(ask !== undefined, `BLOCKED: ${AC4} session ${a.id}'s turn ${k + 1} from ${stranger.address} reached no user.ask in the record`);
    must(ask.data.from === 'session', `${AC4} the turn ${k + 1} a message from ${stranger.address} started must be recorded from: session; it is from: ${ask.data.from}`);
    const named = sendersNamed(events, ask, [b.id]);
    must(named.length === 0, `${AC4} the turn ${k + 1} came from ${stranger.address}, an address no live session reported, so it has no sender; the record names another session, ${b.id}, as its sender: ${said(ask)}`);
  }
  heldMust(held!, `${AC4} session ${a.id}'s 21st turn in 10 minutes from messages of ${stranger.address}, with no prompt from you, must be held at its submit`);
  const all = await settle(hub, (e) => asksAfter(e, since).some((x) => names(askText(x), a.id)), 15_000);
  const asks = asksAfter(all, since).filter((x) => names(askText(x), a.id) && /go on/i.test(askText(x)));
  must(asks.length === 1, `${AC4} the loop rule must raise one ask for session ${a.id}: ${asks.length} were raised: ${listed(asksAfter(all, since))}`);
  must(!names(askText(asks[0]!), b.id), `${AC4} the ask names another session, ${b.id}, which never reported ${stranger.address}: ${said(asks[0])}`);
  must(UNKNOWN_SENDER.test(askText(asks[0]!)), `${AC4} the ask must say its sender is no session DeepBuild knows: ${said(asks[0])}`);
}

describe(`${AC4} a message whose address no live session reported is recorded from: session with no sender, and the ask says so`, () => {
  it(`${AC4} 21 messages from an unreported address: each recorded from: session naming no sender, the 21st held, one ask naming no other session and saying the sender is none DeepBuild knows`, async (ctx) => {
    if (!needRecordings(ctx)) return;
    await unknownSender();
  }, 900_000);

  it(`${AC4} the planted hub that names another session for an unreported address (${PLANT.namesOther}) fails this test, naming that session`, async (ctx) => {
    if (!needRecordings(ctx)) return;
    const failure = await unknownSender(PLANT.namesOther).then(() => undefined, (e: Error) => e);
    must(failure !== undefined, `${AC4} the planted hub ${PLANT.namesOther} must fail this test; it passed`);
    must(/names another session, \S+,/.test(failure.message) && !/^(BLOCKED|INCONCLUSIVE)/.test(failure.message), `${AC4} the planted hub ${PLANT.namesOther} must fail naming the other session; it failed with: ${failure.message}`);
  }, 900_000);
});
