// #1577 AC3: a second device's answer is refused naming the first, with or without an ID (#65: the first appended
// stands). The app answers first, signed by this Mac's device with its request ID. Then your paired phone answers the
// same ask with the other option, signed by its own device: with no request ID, with an ID of its own, and with the
// app's very ID (a replay from another device is not a retry, so it never gets the app's first result).
import { afterAll, describe, expect, it } from 'vitest';
import { AC, cleanup, eventsOf, inboxRow, newRequest, shown, signedCall, world, type Line } from './helpers.ts';

afterAll(cleanup, 120_000);

describe(`${AC[3]} A second device's answer is refused naming the first, with or without an ID`, () => {
  it(`${AC[3]} the app answers sqlite; the phone's files, with no ID, its own ID, or the app's ID, is refused naming sqlite, and sqlite stands`, async () => {
    const w = await world({ asks: [{ source: 'deep_ask.choice', question: 'Keep the 1577 log in SQLite or in plain files?' }] });
    const ask = w.asks[0]!;
    const appRequest = newRequest();
    const first = await signedCall(w, w.device, 'ask.answer', { ask: ask.handle, option: 'sqlite', request: appRequest });
    expect(first.error, `${AC[3]} the app's first answer, request ${appRequest}, must count: ${shown(first)}`).toBeUndefined();

    const tries: [string, Line][] = [
      ['with no request ID', { ask: ask.handle, option: 'files' }],
      ['with a request ID of its own', { ask: ask.handle, option: 'files', request: newRequest() }],
      [`with the app's request ID ${appRequest}`, { ask: ask.handle, option: 'files', request: appRequest }],
    ];
    for (const [how, params] of tries) {
      const reply = await signedCall(w, w.phone, 'ask.answer', params);
      expect(reply.error, `${AC[3]} the phone's answer files ${how} must be refused, since the app answered first; it was taken: ${shown(reply)}`).toBeDefined();
      expect(JSON.stringify(reply.error), `${AC[3]} the refusal of the phone's answer ${how} must name the first answer, sqlite: ${shown(reply.error)}`).toMatch(/\bsqlite\b/);
      expect(reply.result, `${AC[3]} the phone's answer ${how} must not get the app's first result`).toBeUndefined();
    }
    expect((await eventsOf(w, 'ask.answered', ask.handle)).map((e) => e.data.answer), `${AC[3]} the first answer appended stands, alone`).toEqual(['sqlite']);
    expect((await inboxRow(w, ask.handle))?.outcome).toBe('answered');
  }, 600_000);
});
