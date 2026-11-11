// #1577 AC4: the hub killed after a note's reply and before delivery loses nothing. The app's session.note gets its
// reply; the hub is then killed with SIGKILL by the PID this test started it with, before any prompt or waiter could
// carry the note; it starts again on the same home. The session's next prompt, the waiter that follows its stop and
// the wake it starts must give the agent the note's words. The merge base keeps a note in memory only: it loses it.
import { afterAll, describe, expect, it } from 'vitest';
import { AC, cleanup, events, kill, newRequest, note, restart, session, shown, timesGiven, turn, waiter, wake, world } from './helpers.ts';

afterAll(cleanup, 120_000);

describe(`${AC[4]} The hub killed after a note's reply and before delivery loses nothing`, () => {
  it(`${AC[4]} a note the hub said it has, then a SIGKILL before delivery and a restart: the agent is still given its words`, async () => {
    const w = await world();
    const h = await session(w);
    await turn(w, h, 'Fix the login bug in src/login.ts.');
    const request = newRequest();
    const words = `Also add a dark mode toggle, named theme ${request.slice(-6)}.`;
    const reply = await note(w, h, words, request);
    expect(reply.error, `${AC[4]} session.note must be taken: ${shown(reply)}`).toBeUndefined();
    expect(reply.result?.request, `${AC[4]} the note's reply names its request ID`).toBe(request);
    const since = h.replies.length;

    await kill(w);
    await restart(w);

    await turn(w, h, 'Is the login bug fixed?');
    const handed = await waiter(w, h, 15_000);
    if (handed) await wake(w, h, handed);
    await turn(w, h, 'Anything else waiting for you?');
    const recorded = (await events(w)).filter((e) => JSON.stringify(e.data ?? {}).includes(words)).map((e) => e.kind);
    expect(timesGiven(h, words, since), `${AC[4]} the note "${words}" (request ${request}), which the hub said it had before it was killed, was lost: after the restart no prompt's reply, waiter or wake gave the agent its words (events naming the words: ${JSON.stringify(recorded)})`).toBeGreaterThanOrEqual(1);
  }, 600_000);
});
