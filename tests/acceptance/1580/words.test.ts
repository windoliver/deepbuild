// #1580 AC4: a signature over a card whose words changed is refused, naming the revision. The card is an open choice's
// on the chat channel: before you link your chat account it is the item view, saying where to answer, and once you
// link it (channel.link) it is the question with its buttons (README, Surfaces: a card whose words changed). The
// paired phone's signature over the earlier card reaches the hub through the chat channel, which carries an answer's
// proof unchanged. On the merge base the revision is always 1, so the refusal names the card's hash instead.
import { afterEach, describe, expect, it } from 'vitest';
import { AC, MINUTE, YOU, answeredOf, cleanup, describeItem, inboxRow, lastPos, ok, openInNeedsYou, outcomeOf, said, signedAnswer, sleep, waitFor, world } from './helpers.ts';

afterEach(cleanup, 120_000);

const CHOICE = { source: 'deep_ask.choice', question: 'Keep the cache in SQLite or in plain files?' } as const;

describe(`${AC[4]} A signature over a card whose words changed is refused, naming the revision`, () => {
  it(`${AC[4]} the phone's signature over the chat card as it read before your account was linked is refused naming revision and counts for nothing; one over the card as it reads now counts`, async () => {
    const w = await world({ channels: ['chat'], seed: [CHOICE] });
    const [ask] = w.asks as [typeof w.asks[0]];
    const relay = w.relays.chat!;
    const before = await waitFor(() => relay.latest(ask.handle), MINUTE, `${ask.handle} on the chat channel`);
    const old = signedAnswer(w.phone, w.hubId, before, 'sqlite');

    await ok(w, 'channel.link', { channel: 'chat', account: YOU });
    await waitFor(() => { const c = relay.latest(ask.handle); return c && c.summary !== before.summary ? c : undefined; }, MINUTE, `${ask.handle}'s chat card changing its words once your account is linked`)
      .catch((e: Error) => { throw Error(`BLOCKED: setup: ${e.message}; it shows ${describeItem(relay.latest(ask.handle))}, as before: ${describeItem(before)}`); });

    const since = await lastPos(w);
    relay.give(old);
    const r = await outcomeOf(w, ask.handle, since, 'the hub refusing or counting the signature over the card as it read before');
    expect(r.kind, `the signature over the card's earlier words is refused: ${said([r])}`).toBe('channel.refused');
    expect(r.data.field, `the refusal names the revision: ${said([r])}`).toBe('revision');
    await sleep(2000);
    expect(await answeredOf(w, ask.handle), 'it counted for nothing').toEqual([]);
    expect(openInNeedsYou(await inboxRow(w, ask.handle)), `${ask.handle} is still open in Needs you`).toBe(true);

    const now = relay.latest(ask.handle)!;
    const again = await lastPos(w);
    relay.give(signedAnswer(w.phone, w.hubId, now, 'sqlite'));
    const counted = await outcomeOf(w, ask.handle, again, 'the hub counting the signature over the card as it reads now');
    expect(counted.kind, `a signature over the card as it reads now counts: ${said([counted])}; the card was ${describeItem(now)}`).toBe('ask.answered');
  });
});
