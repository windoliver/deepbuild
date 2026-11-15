// #1577 AC1, AC2 and AC3: an answer from a paired device carries a request ID (README, The surface: `request`). Sent
// again by the same device with the same ID and params it returns the first result and writes nothing; the same ID
// with another option is refused naming the ID; and another device's answer is refused naming the first, with or
// without an ID, as #65 has it. Each test starts its own hub on a temp home, with one choice ask in its record.
import { afterEach, describe, expect, it } from 'vitest';
import { AC, cleanup, eventsOf, requestId, said, sendOnce, signedBy, tag, world, type Line, type World } from './helpers.ts';

afterEach(cleanup, 60_000);

/** A world with one open choice ask (`sqlite` or `files`), raised through the asks core before the hub starts. */
const oneChoice = async (): Promise<{ w: World; ask: string }> => {
  const w = await world({ asks: [{ source: 'deep_ask.choice', question: `Keep the cache on SQLite or plain files? (${tag()})` }] });
  return { w, ask: w.asks[0]!.handle };
};
/** The answers the record holds for an ask, in log order. */
const answers = async (w: World, ask: string): Promise<string[]> => (await eventsOf(w, 'ask.answered', ask)).map((e) => String(e.data.answer));
/** The first answer, by device A with a request ID; it must count for the test to say anything. */
async function firstAnswer(w: World, ask: string, request: string): Promise<Line> {
  const reply = await sendOnce(w, 'ask.answer', await signedBy(w, w.a, 'ask.answer', { ask, option: 'sqlite', request }));
  expect(reply.error, `${ask}'s first answer, sqlite from ${w.a.name} with the request ID ${request}, must count: the hub replied ${JSON.stringify(reply.error)}`).toBeUndefined();
  return reply;
}

describe(`${AC[1]} An answer whose reply is cut, sent again with its ID, returns the first result, and the record holds one ask.answered and no answer.refused`, () => {
  it(`${AC[1]} the same frame sent again after its reply was lost returns the first result and writes nothing`, async () => {
    const { w, ask } = await oneChoice();
    const request = requestId();
    const frame = await signedBy(w, w.a, 'ask.answer', { ask, option: 'sqlite', request });
    // The reply is cut: the frame goes on a connection the device loses once the hub has replied. The test keeps
    // that reply only to compare it with the retry's; the device never sees it.
    const cut = await sendOnce(w, 'ask.answer', frame);
    // The device sends the very same frame again, its request ID, signature and once-only ID included.
    const retry = await sendOnce(w, 'ask.answer', frame);
    expect(retry.error, `the retry of ${ask}'s answer with the request ID ${request} must return the first result; the hub refused it: ${JSON.stringify(retry.error)}; the reply that was cut: ${JSON.stringify(cut)}`).toBeUndefined();
    expect(retry.result, `the retry must return the first result exactly; the reply that was cut: ${JSON.stringify(cut)}`).toEqual(cut.result);
    const answered = await eventsOf(w, 'ask.answered', ask);
    const refused = await eventsOf(w, 'answer.refused', ask);
    expect(answered.map((e) => e.data.answer), `the record must hold one ask.answered for ${ask}: ${said(answered)}`).toEqual(['sqlite']);
    expect(refused, `the record must hold no answer.refused for ${ask}, since the retry is your own answer: ${said(refused)}`).toEqual([]);
  });
});

describe(`${AC[2]} The same ID with another option is refused, naming the ID`, () => {
  it(`${AC[2]} the same device sends the same request ID with the other option: refused at /params/request naming the ID, and the first answer stands`, async () => {
    const { w, ask } = await oneChoice();
    const request = requestId();
    await firstAnswer(w, ask, request);
    const other = await sendOnce(w, 'ask.answer', await signedBy(w, w.a, 'ask.answer', { ask, option: 'files', request }));
    expect(other.result, `files with the request ID ${request}, which sqlite already went with, must be refused: the hub replied ${JSON.stringify(other.result)}`).toBeUndefined();
    expect(other.error?.path, `the refusal must name the request ID at /params/request: ${JSON.stringify(other.error)}`).toBe('/params/request');
    expect(other.error?.actual, `the refusal must name the request ID ${request} as the refused value: ${JSON.stringify(other.error)}`).toBe(request);
    expect(await answers(w, ask), `the first answer stands alone in the record`).toEqual(['sqlite']);
  });
});

describe(`${AC[3]} A second device's answer is refused naming the first, with or without an ID`, () => {
  it(`${AC[3]} after the app's sqlite, the phone's answers with the app's request ID, with its very params, and with no ID are each refused naming sqlite`, async () => {
    const { w, ask } = await oneChoice();
    const request = requestId();
    await firstAnswer(w, ask, request);
    // A retry is the same device's; the same ID from another device is a second answer, never the first's result.
    const sends: [string, Line][] = [
      [`files with the app's request ID ${request}`, { ask, option: 'files', request }],
      [`sqlite with the app's request ID ${request}: the app's own params, from the phone`, { ask, option: 'sqlite', request }],
      ['files with no request ID', { ask, option: 'files' }],
    ];
    for (const [what, params] of sends) {
      const reply = await sendOnce(w, 'ask.answer', await signedBy(w, w.b, 'ask.answer', params));
      expect(reply.result, `${w.b.name}'s ${what} must be refused, since ${w.a.name} answered first: the hub replied ${JSON.stringify(reply.result)}`).toBeUndefined();
      expect(reply.error?.path, `${w.b.name}'s ${what} must be refused as a second answer to a closed ask (/params/ask, as #65 has it), not as a reused request ID: ${JSON.stringify(reply.error)}`).toBe('/params/ask');
      expect(JSON.stringify(reply.error), `the refusal of ${w.b.name}'s ${what} must name the first answer, sqlite`).toMatch(/\bsqlite\b/);
    }
    expect(await answers(w, ask), 'the first answer stands alone in the record').toEqual(['sqlite']);
  });
});
