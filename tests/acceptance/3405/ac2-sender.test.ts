// AC2: the terminal and desktop-app recordings of a message between two sessions, replayed hook by hook through deep-hook
// into a real hub: each turn another session's message started is recorded `from: session` with its sender, the
// recorded session whose SessionStart reported the address the entry's origin.from gives; and once that pair passes
// the loop rule's count, its one ask names both sessions. The merge base finds no sender (it reads origin.from only as
// `local_<id>`) and fails, naming the address it didn't read.
import { afterAll, describe, it } from 'vitest';
import {
  AC2, TAG, asksAfter, askText, caseRef, cleanup, decision, entryOf, listed, makeWorld, must, names, prepare, promptAsk,
  promptsOfKind, needRecordings, replay, said, senderOf, sendersNamed, settle, shown, startHub, trust, type Case, type Ev, type Recording,
} from './helpers.ts';

afterAll(cleanup, 60_000);

async function replayed(rec: Recording): Promise<void> {
  const w = makeWorld();
  const r = prepare(w, rec);
  await trust(w, r.folders);
  const hub = await startHub(w);
  await replay(r);
  const ids = [...r.sessions.keys()];
  const peers = promptsOfKind(rec, 'peer').filter((c) => c.tag === TAG.message);
  // The nth recorded prompt of a session with the same text is its nth user.ask with that text.
  const nth = (c: Case): number => rec.cases.filter((x) => x.line < c.line && x.payload.session_id === c.payload.session_id && x.payload.prompt === c.payload.prompt && x.payload.hook_event_name === 'UserPromptSubmit').length;
  const events = await settle(hub, (all) => peers.every((c) => promptAsk(all, c.payload.session_id, c.payload.prompt, nth(c))), 60_000);
  for (const c of peers) {
    const receiver = String(c.payload.session_id);
    const address = String(entryOf(rec, c)?.origin?.from);
    const ask = promptAsk(events, receiver, c.payload.prompt, nth(c));
    must(ask !== undefined, `BLOCKED: ${AC2} the replayed prompt ${caseRef(rec, c)} reached no user.ask in the record: ${shown(r.fired.get(c)!)}`);
    must(ask.data.from === 'session', `${AC2} the turn ${caseRef(rec, c)} that a message from ${address} started must be recorded from: session; it is from: ${ask.data.from}`);
    const sender = senderOf(rec, c);
    const named = sendersNamed(events, ask, ids.filter((id) => id !== receiver));
    if (sender) must(named.length === 1 && named[0] === sender, `${AC2} the turn ${caseRef(rec, c)} must be recorded with its sender, session ${sender}, which reported the address ${address} at its SessionStart; the record names ${named.length ? named.join(', ') : 'no sender'}, so the address ${address} wasn't read: ${said(ask)}`);
    else must(named.length === 0, `${AC2} the turn ${caseRef(rec, c)} came from ${address}, which no recorded session reported, so it must name no sender; the record names ${named.join(', ')}: ${said(ask)}`);
  }

  // The loop rule on that pair: the receiver's turns from the sender's messages, shaped as the recorded one, until the
  // rule holds one (more than 20 in 10 minutes, with no prompt from you); its one ask names both sessions.
  const joined = peers.find((c) => senderOf(rec, c));
  if (!joined) return;
  const receiver = r.sessions.get(String(joined.payload.session_id))!;
  const sender = senderOf(rec, joined)!;
  let held: number | undefined;
  for (let k = 1; k <= 21 && held === undefined; k++) {
    const reply = await receiver.like(entryOf(rec, joined)!, joined.payload.prompt);
    if (decision(reply) === 'allow') await receiver.stop('Replied.');
    else held = k;
  }
  must(held !== undefined, `${AC2} 21 more turns of session ${receiver.id} started by messages from ${sender}'s address, with no prompt from you, must be held by the loop rule; none was`);
  const all: Ev[] = await settle(hub, (e) => asksAfter(e, 0).some((a) => names(askText(a), receiver.id)), 15_000);
  const asks = asksAfter(all, 0).filter((a) => names(askText(a), receiver.id) && /go on/i.test(askText(a)));
  must(asks.length === 1, `${AC2} the loop rule must raise one ask for session ${receiver.id}: ${asks.length} were raised: ${listed(asksAfter(all, 0))}`);
  must(names(askText(asks[0]!), sender), `${AC2} the loop rule's ask must name both sessions, ${receiver.id} and its sender ${sender} (whose address ${entryOf(rec, joined)?.origin?.from} the messages give): ${said(asks[0])}`);
}

describe(`${AC2} replayed, a session's message is recorded from: session with its sender, and the loop rule's ask names both sessions`, () => {
  it(`${AC2} the terminal recording: each message's turn names the session that reported its address, and the loop ask names both`, async (ctx) => {
    const r = needRecordings(ctx);
    if (!r) return;
    await replayed(r.terminal);
  }, 900_000);
  it(`${AC2} the desktop-app recording: each message's turn names the session that reported its address (none where no recorded session did)`, async (ctx) => {
    const r = needRecordings(ctx);
    if (!r) return;
    await replayed(r.desktop);
  }, 900_000);
});
