// #1577 AC5: a note retried after delivery reaches the agent once. The app's note is handed to the session's waiter,
// which wakes it with the note's words; the agent's turn ends. Then the app sends the same session.note again (the same
// session, words and request ID), as a client that lost the first reply would. The session's later prompts, waiters
// and wakes must not give the agent the words again. The merge base forgets a delivered note and delivers it twice.
import { afterAll, describe, expect, it } from 'vitest';
import { AC, cleanup, newRequest, note, session, shown, sleep, timesGiven, turn, waiter, wake, world } from './helpers.ts';

afterAll(cleanup, 120_000);

describe(`${AC[5]} A note retried after delivery reaches the agent once`, () => {
  it(`${AC[5]} a note delivered by the waiter's wake, then sent again with its request ID, reaches the agent once`, async () => {
    const w = await world();
    const h = await session(w);
    await turn(w, h, 'Fix the login bug in src/login.ts.');
    const request = newRequest();
    const words = `Also add a dark mode toggle, named theme ${request.slice(-6)}.`;
    const waiting = waiter(w, h, 60_000);
    await sleep(1500);
    const first = await note(w, h, words, request);
    expect(first.error, `${AC[5]} session.note must be taken: ${shown(first)}`).toBeUndefined();
    const handed = await waiting;
    if (!handed?.includes(words)) throw Error(`BLOCKED: setup: the session's waiter wasn't handed the note "${words}": ${shown(handed)}`);
    await wake(w, h, handed);
    expect(timesGiven(h, words), `${AC[5]} the note reached the agent by the waiter`).toBe(1);

    // The late retry.
    const again = await note(w, h, words, request);
    expect(again.error, `${AC[5]} the same note sent again with its request ID ${request} is a retry, not a refusal: ${shown(again)}`).toBeUndefined();
    await sleep(1000);
    await turn(w, h, 'Is the login bug fixed?');
    const late = await waiter(w, h, 10_000);
    if (late) await wake(w, h, late);
    await turn(w, h, 'Anything else waiting for you?');
    const where = h.replies.filter((r) => r.text.includes(words)).map((r) => r.event);
    expect(timesGiven(h, words), `${AC[5]} the note "${words}" (request ${request}), retried after it was delivered, must reach the agent once; it was delivered twice or more, by ${where.join(', ')}`).toBe(1);
  }, 600_000);
});
