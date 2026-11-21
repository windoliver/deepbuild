// AC1: Gmail accepts the send, its answer is lost, and then Gmail answers 503 (also 429 and 500) to the message read the
// source's `find` makes before a retry: the delivery ends with one message sent and the retry held. On the merge base
// `find` reads the 503 as "not sent", and the hub sends the reply again: two are sent.
// AC3: a planted `find` that reads every failure as `false` (twins/failure-reads-false) fails the first criterion: the
// same check, on the 503, run by the proof lanes against that twin.
//
// The delivery goes through the shipped Gmail source in a real extension host, under your reply rule. The send's
// request reaches the stand-in, which keeps the reply, and the connection drops before the answer, so the hub records
// no answer and settles the claim at its next tick by the source's `find`. The stand-in answers that tick's first
// message read with the failure, once per tick, for three ticks; then it answers as Gmail does again.
import { describe, expect, it } from 'vitest';
import { AC1, AC3, at, lostSend, markers, MINUTE, row, stand, tickAt } from './helpers.ts';

const T0 = at('2026-11-02T09:00');
const HELD = ['unknown', 'queued'];

async function heldThrough(status: number): Promise<void> {
  const g = await stand(T0);
  const key = await lostSend(g, T0, 'kept');
  for (let i = 1; i <= 3; i++) {
    g.plan.reads = [status];
    await tickAt(g, T0 + (3 + i) * MINUTE);
    expect(g.failed.length, `find read the message at tick ${i} after the lost answer and got the ${status}`).toBe(i);
    expect(g.sent(), `one message sent: Gmail kept the first send, and its ${status} to the message read at tick ${i} is no "not sent"`).toBe(1);
    expect(g.posts(), `no second send request after the ${status} at tick ${i}`).toBe(1);
    expect(HELD, `the retry is held after the ${status} at tick ${i}, not settled by a second send`).toContain((await row(g, key)).outcome);
  }
  await tickAt(g, T0 + 7 * MINUTE);
  expect((await row(g, key)).outcome, 'once Gmail answers again, the marker is found: the delivery reads sent').toBe('sent');
  expect(g.sent(), 'the delivery ends with one message sent').toBe(1);
  expect(markers(g), 'the thread holds one reply, carrying the send key').toEqual([key]);
}

describe(`${AC1} With a stand-in Gmail that accepts the send and then answers 503 to the message read, the delivery ends with one message sent and the retry held. On the merge base two are sent`, () => {
  it(`${AC1} the send is kept and its answer lost; find's message read answers 503: one message sent, the retry held`, () => heldThrough(503), 300_000);
  it(`${AC1} the same with a rate limit, 429, on the message read: one message sent, the retry held`, () => heldThrough(429), 300_000);
  it(`${AC1} the same with a 500 on the message read: one message sent, the retry held`, () => heldThrough(500), 300_000);
});

describe(`${AC3} A planted \`find\` that reads every failure as \`false\` fails the first criterion`, () => {
  it(`${AC3} the first criterion's check on the 503 (fails on twins/failure-reads-false, two sent)`, () => heldThrough(503), 300_000);
});
