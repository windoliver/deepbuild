// AC2: with a 404 on the message read, the reply is sent once. The send's request is lost before Gmail keeps it (the
// connection drops with no answer), so the hub settles the claim at its next tick by the source's `find`, whose
// message read the stand-in answers 404: Gmail says it isn't there, which is "not sent", and the reply goes out once,
// at that tick. Deliver's own read of the email, right after, is answered as Gmail does (README: Readings).
import { describe, expect, it } from 'vitest';
import { AC2, at, lostSend, markers, MINUTE, row, stand, tickAt } from './helpers.ts';

const T0 = at('2026-11-02T09:00');

describe(`${AC2} With a 404 on the message read, the reply is sent once`, () => {
  it(`${AC2} the first send is lost before Gmail keeps it; find's message read answers 404: the reply goes out once, at that tick`, async () => {
    const g = await stand(T0);
    const key = await lostSend(g, T0, 'dropped');
    g.plan.reads = [404];
    await tickAt(g, T0 + 4 * MINUTE);
    expect(g.failed.length, 'find read the message after the lost answer and got the 404').toBe(1);
    expect(g.sent(), 'the 404 reads not sent: the reply is sent, once').toBe(1);
    expect((await row(g, key)).outcome, 'the delivery reads sent at the tick that read the 404').toBe('sent');
    for (let i = 5; i <= 7; i++) await tickAt(g, T0 + i * MINUTE);
    expect(g.sent(), 'no later tick sends it again').toBe(1);
    expect(g.posts(), 'the lost request and the one after the 404').toBe(2);
    expect(markers(g), 'the thread holds one reply, carrying the send key').toEqual([key]);
  }, 300_000);
});
