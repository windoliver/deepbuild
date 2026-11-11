// #1577 AC7: the hub killed after reading an answer with its request ID and before its commit: the same ID sent again
// after the restart applies once, and the record holds one ask.answered. The hub is started with the base's test cut
// point DEEP_HUB_TEST_CRASH=before:ask.answered, under which it SIGKILLs itself just before it appends an ask.answered:
// the answer was read, checked and on its way to the record, with nothing committed. The hub is started again without
// it, and the app sends the very same line again (the same device, signature, request ID and params). A hub that keeps
// a pending mark for the ID across the restart answers it is still in progress, a refusal, which fails here.
import { afterAll, describe, expect, it } from 'vitest';
import { AC, cleanup, eventsOf, gone, inboxRow, lineOf, newRequest, restart, sendLine, shown, signedBy, world } from './helpers.ts';

afterAll(cleanup, 120_000);

describe(`${AC[7]} The hub killed before an answer's commit: the same ID sent again after the restart applies once`, () => {
  it(`${AC[7]} an answer with its request ID, the hub killed before ask.answered commits, the same line after the restart: it applies, once`, async () => {
    const w = await world({ asks: [{ source: 'deep_ask.choice', question: 'Keep the 1577 journal in SQLite or in plain files?' }], env: { DEEP_HUB_TEST_CRASH: 'before:ask.answered' } });
    const ask = w.asks[0]!;
    const request = newRequest();
    const line = lineOf('answer-1577-crash', 'ask.answer', await signedBy(w, w.device, 'ask.answer', { ask: ask.handle, option: 'files', request }));
    w.app.send(line);
    const reply = await w.app.seek((l) => l.id === line.id, 1, 60_000);
    expect(await gone(w, 60_000), `${AC[7]} the answer with request ID ${request} must be read and on its way to its commit when the hub dies at its cut point before ask.answered; the hub stayed up and replied ${shown(reply?.json)}`).toBe(true);
    await restart(w);
    expect((await eventsOf(w, 'ask.answered', ask.handle)).length, 'nothing of the first send was committed').toBe(0);

    const retry = await sendLine(w.app, line);
    expect(retry.error, `${AC[7]} the answer sent again with its request ID ${request} after the restart must apply, not be refused (a mark that it is in progress must not outlive the hub): ${shown(retry.error)}`).toBeUndefined();
    expect(retry.result?.answer, `${AC[7]} the retry's result is the answer files: ${shown(retry.result)}`).toBe('files');
    expect((await eventsOf(w, 'ask.answered', ask.handle)).map((e) => e.data.answer), `${AC[7]} the record must hold one ask.answered for ${ask.handle}`).toEqual(['files']);
    expect((await eventsOf(w, 'answer.refused', ask.handle)).length, `${AC[7]} and no answer.refused`).toBe(0);
    expect((await inboxRow(w, ask.handle))?.outcome).toBe('answered');

    // Once more: now it is the first result, and still one ask.answered.
    const third = await sendLine(w.app, line);
    expect(third.result, `${AC[7]} a third send gets the first result: ${shown(third)}`).toEqual(retry.result);
    expect((await eventsOf(w, 'ask.answered', ask.handle)).length, `${AC[7]} still one ask.answered`).toBe(1);
  }, 600_000);
});
