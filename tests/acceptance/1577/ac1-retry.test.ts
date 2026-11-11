// #1577 AC1: an answer whose reply is cut, sent again with its ID, returns the first result, and the record holds one
// ask.answered and no answer.refused. The app's signed answer carries its request ID (`request`); the hub's reply to
// it is cut by a socket in front of the hub (helpers.ts, `cutter`), so the app never sees it; the app then sends the
// very same line again, as a client retries a write it got no reply to. The merge base fails, naming the refusal.
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC, appThrough, cleanup, events, cutReply, cutter, eventsOf, inboxRow, lineOf, logEnd, newRequest, sendLine, shown, signedBy, world,
} from './helpers.ts';

afterAll(cleanup, 120_000);

describe(`${AC[1]} An answer whose reply is cut, sent again with its ID, returns the first result`, () => {
  it(`${AC[1]} the retry of a cut answer gets the first result, writes nothing, and the record holds one ask.answered and no answer.refused`, async () => {
    const w = await world({ asks: [{ source: 'deep_ask.choice', question: 'Keep the 1577 cache in SQLite or in plain files?' }] });
    const ask = w.asks[0]!;
    const request = newRequest();
    const params = await signedBy(w, w.device, 'ask.answer', { ask: ask.handle, option: 'sqlite', request });
    const line = lineOf('answer-1577-a', 'ask.answer', params);

    // The first send: the hub writes its reply, and the link drops it.
    const cut = await cutter(w.hub.socket, line.id);
    const phoneSide = await appThrough(w, cut);
    phoneSide.send(line);
    const first = await cutReply(cut, 60_000);
    if (!first) throw Error(`BLOCKED: setup: the hub wrote no reply to the first ask.answer within 60 s`);
    expect(phoneSide.received.some((r) => r.json?.id === line.id), 'the cut reply never reached the client').toBe(false);
    const before = await logEnd(w);

    // The same line again: the same device, request ID and params.
    const retry = await sendLine(w.app, line);
    expect(retry.error, `${AC[1]} the answer sent again with its request ID ${request} must return the first result, not a refusal; it was refused: ${shown(retry.error)} (the first reply, cut: ${shown(first)})`).toBeUndefined();
    expect(retry.result, `${AC[1]} the retry must return the first result, field by field (the first reply, cut: ${shown(first)})`).toEqual(first.result);

    const answered = await eventsOf(w, 'ask.answered', ask.handle);
    const refused = await eventsOf(w, 'answer.refused', ask.handle);
    expect(refused.map((e) => e.data), `${AC[1]} the record must hold no answer.refused for ${ask.handle}: the retry is your own write, not a later answer`).toEqual([]);
    expect(answered.map((e) => e.data.answer), `${AC[1]} the record must hold one ask.answered for ${ask.handle}, sqlite`).toEqual(['sqlite']);
    const after = (await events(w, before)).filter((e) => e.subject === ask.handle || JSON.stringify(e.data).includes(ask.handle));
    expect(after.map((e) => e.kind), `${AC[1]} the retry must write no event about ${ask.handle}: the log ended at ${before} before it`).toEqual([]);
    expect((await inboxRow(w, ask.handle))?.outcome, `${AC[1]} ${ask.handle} reads answered`).toBe('answered');
  }, 600_000);
});

describe(`${AC[1]} (control) without its ID, a second send is another answer`, () => {
  it(`${AC[1]} the same answer sent twice with no request ID: the second is refused naming the first, and recorded answer.refused, as the design's ask table says`, async () => {
    const w = await world({ asks: [{ source: 'deep_ask.choice', question: 'Keep the 1577 index in SQLite or in plain files?' }] });
    const ask = w.asks[0]!;
    const one = await w.app.call('ask.answer', await signedBy(w, w.device, 'ask.answer', { ask: ask.handle, option: 'sqlite' }), 60_000);
    expect(one.error, `the first answer counts: ${shown(one)}`).toBeUndefined();
    const two = await w.app.call('ask.answer', await signedBy(w, w.device, 'ask.answer', { ask: ask.handle, option: 'sqlite' }), 60_000);
    expect(two.error, `a second answer with no request ID is a later answer to a closed ask, refused: ${shown(two)}`).toBeDefined();
    expect((await eventsOf(w, 'answer.refused', ask.handle)).length, 'and recorded as answer.refused').toBe(1);
    expect((await eventsOf(w, 'ask.answered', ask.handle)).length, 'one ask.answered').toBe(1);
  }, 600_000);
});
