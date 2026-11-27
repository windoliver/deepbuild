// AC5: the channel's recording replayed hook by hook through deep-hook into a real hub: its event is recorded
// `from: channel` with the server's name as its entry gives it, opens no ask, and adds nothing to the count of another
// session's messages. The count is read through the loop rule: after the replay and three more of the channel's events
// shaped as the recorded one, a live sibling's 20 messages to the same session all go through, with no ask. The merge
// base records the event `session` and fails, naming the event.
import { afterAll, describe, it } from 'vitest';
import {
  AC5, ClaudeSession, TAG, allEvents, asksAfter, askText, caseRef, cleanup, decision, entryOf, lastPos, listed, makeWorld, must, names,
  needRecordings, prepare, promptAsk, promptsOfKind, replay, said, senderRecord, serverOf, settle, shown, startHub, trust, worktree,
  type Case,
} from './helpers.ts';

afterAll(cleanup, 60_000);

describe(`${AC5} replayed, the channel's event is recorded from: channel with its server's name, opens no ask and adds nothing to another session's count`, () => {
  it(`${AC5} the channel recording's event is from: channel naming its server, opens no ask, and a sibling's 20 messages after it all go through`, async (ctx) => {
    const recs = needRecordings(ctx);
    if (!recs) return;
    const rec = recs.channel;
    const w = makeWorld();
    const r = prepare(w, rec);
    const wb = worktree(w, 'wb', 'b/talk');
    await trust(w, [...r.folders, wb]);
    const hub = await startHub(w);
    await replay(r);
    const channel = promptsOfKind(rec, 'channel').filter((c) => c.tag === TAG.channel);
    const nth = (c: Case): number => rec.cases.filter((x) => x.line < c.line && x.payload.session_id === c.payload.session_id && x.payload.prompt === c.payload.prompt && x.payload.hook_event_name === 'UserPromptSubmit').length;
    const events = await settle(hub, (all) => channel.every((c) => promptAsk(all, c.payload.session_id, c.payload.prompt, nth(c))), 60_000);
    for (const c of channel) {
      const ask = promptAsk(events, c.payload.session_id, c.payload.prompt, nth(c));
      const what = `the channel's event ${caseRef(rec, c)} (prompt ${c.payload.prompt_id})`;
      must(ask !== undefined, `BLOCKED: ${AC5} ${what} reached no user.ask in the record: ${shown(r.fired.get(c)!)}`);
      must(ask.data.from === 'channel', `${AC5} ${what} must be recorded from: channel; it is from: ${ask.data.from}`);
      const server = serverOf(entryOf(rec, c));
      must(server !== undefined, `BLOCKED: ${AC5} ${what}: its entry gives no server's name: ${JSON.stringify(entryOf(rec, c)?.origin)}`);
      must(senderRecord(events, ask).includes(server.name), `${AC5} ${what} must be recorded with its server's name, ${JSON.stringify(server.name)} (the entry's ${server.field}): ${said(ask)}`);
      must(Array.isArray(ask.data.tasks) && ask.data.tasks.length === 0, `${AC5} ${what} must open no ask; it opened ${JSON.stringify(ask.data.tasks)}`);
      const opened = asksAfter(events, 0).filter((x) => askText(x).includes(ask.id));
      must(opened.length === 0, `${AC5} ${what} must open no ask: ${listed(opened)}`);
    }

    // Its count is its own: three more of the channel's events, then 20 messages from a live sibling, which reported its
    // inbox, to the same session, with no prompt from you: none is held and no loop ask is raised.
    const c = channel[0]!;
    const receiver = r.sessions.get(String(c.payload.session_id))!;
    const b = await ClaudeSession.withInbox(w, wb, 'wb');
    await b.start();
    const since = await lastPos(hub);
    for (let k = 1; k <= 3; k++) {
      const e = await receiver.like(entryOf(rec, c)!, c.payload.prompt);
      must(decision(e) === 'allow', `${AC5} the channel's event ${k} after the replay, the receiver's ${k}th such in 10 minutes, must go through: ${shown(e)}`);
      await receiver.stop('Noted.');
    }
    for (let k = 1; k <= 20; k++) {
      const m = await receiver.message(b.peer, `Cart question ${k}: does the total round each line?`);
      must(decision(m) === 'allow', `${AC5} session ${receiver.id}'s turn ${k} from ${b.id}'s messages was held: with the channel's events counted on their own, 20 messages are within the limit, so they added to the count of another session's messages: ${shown(m)}`);
      await receiver.stop('Replied.');
    }
    const asks = asksAfter(await allEvents(hub), since).filter((x) => names(askText(x), receiver.id) || names(askText(x), b.id));
    must(asks.length === 0, `${AC5} 20 messages and 3 channel events raise no loop ask: ${listed(asks)}`);
  }, 900_000);
});
