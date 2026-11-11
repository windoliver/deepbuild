// #1577 AC2: the same request ID with another option is refused, naming the ID. The app answers with a request ID,
// then sends a new answer under the same ID choosing the other option, freshly signed over its own params (so the
// signature holds and only the ID is reused). Refused, the refusal naming the request ID; the first answer stands.
import { afterAll, describe, expect, it } from 'vitest';
import { AC, cleanup, eventsOf, inboxRow, newRequest, shown, signedCall, world } from './helpers.ts';

afterAll(cleanup, 120_000);

describe(`${AC[2]} The same ID with another option is refused, naming the ID`, () => {
  it(`${AC[2]} an answer under a request ID already used for sqlite, choosing files, is refused naming the ID, and sqlite stands`, async () => {
    const w = await world({ asks: [{ source: 'deep_ask.choice', question: 'Keep the 1577 queue in SQLite or in plain files?' }] });
    const ask = w.asks[0]!;
    const request = newRequest();
    const first = await signedCall(w, w.device, 'ask.answer', { ask: ask.handle, option: 'sqlite', request });
    expect(first.error, `${AC[2]} the first answer with request ID ${request} must count: ${shown(first)}`).toBeUndefined();
    const other = await signedCall(w, w.device, 'ask.answer', { ask: ask.handle, option: 'files', request });
    expect(other.error, `${AC[2]} the same request ID ${request} with another option must be refused; it was taken: ${shown(other)}`).toBeDefined();
    expect(JSON.stringify(other.error), `${AC[2]} the refusal must name the request ID ${request}: ${shown(other.error)}`).toContain(request);
    expect((await eventsOf(w, 'ask.answered', ask.handle)).map((e) => e.data.answer), `${AC[2]} the first answer stands, alone`).toEqual(['sqlite']);
    expect((await inboxRow(w, ask.handle))?.outcome).toBe('answered');
  }, 600_000);
});
