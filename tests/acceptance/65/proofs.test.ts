// #65's proofs of an answer, checked by the hub and never taken on a channel's word: AC5 (an answer marked as signed
// with no valid signature, or naming an account link the hub doesn't hold, is refused naming the key or the link),
// AC8's second half ("I did it" from a channel with neither proof is refused), AC15 (an unpaired phone's key counts
// for nothing, and its next connection is told) and AC16 (a replayed, a stale and a changed-card answer are each
// refused naming the field). Each answer reaches the hub through a real channel plug-in from its provider's stand-in,
// so the channel faithfully carries what a forging or careless provider handed it (README, Readings).
import { afterEach, describe, expect, it } from 'vitest';
import { AC, MINUTE, cleanup, events, inboxRow, ofKind, openInNeedsYou, said, sleep, waitFor, world, type Ev, type World } from './helpers.ts';

const CHOICE = { source: 'deep_ask.choice', question: 'Keep the cache in SQLite or in plain files?' } as const;
/** The hub's refusals of channel answers for a thread, wherever it files them (README, The surface: channel.refused). */
const refused = async (w: World, thread: string): Promise<Ev[]> => (await events(w)).filter((e) => e.kind === 'channel.refused' && (e.subject === thread || e.data.thread_key === thread));
/** Nothing counted: no answer recorded, no decision saved, and the ask still open in Needs you. */
async function countedNothing(w: World, ask: string): Promise<void> {
  expect(await ofKind(w, 'ask.answered', ask), `the answer counted: ${said(await ofKind(w, 'ask.answered', ask))}`).toEqual([]);
  expect((await ofKind(w, 'decision.created')).filter((e) => e.data.ask === ask), 'no decision saved').toEqual([]);
  expect(openInNeedsYou(await inboxRow(w, ask)), `${ask} is still open in Needs you: ${JSON.stringify(await inboxRow(w, ask))}`).toBe(true);
}
const firstRefusal = (w: World, ask: string, what: string): Promise<Ev> => waitFor(async () => (await refused(w, ask))[0], 30_000, `the hub's channel.refused for ${what}`);

describe(`${AC[5]} A planted channel that returns an answer marked as signed by the paired device but carrying no valid signature, or naming an account link the hub doesn't hold, is refused, naming the device key or the link, and the answer counts as nothing; a hub that takes the channel's word for its proof accepts it and fails this test`, () => {
  afterEach(cleanup, 120_000);
  // The forged-signature case is proven by the blind redraft redraft-1579/proofs.test.ts, swapped in with the owner's
  // approval: #1579 changed what a paired device signs, so this draft's phone fails it on the format.

  it(`${AC[5]} a chat answer naming an account the hub holds no link for is refused naming that account, and counts as nothing`, async () => {
    const w = await world({ channels: ['chat'], link: true, seed: [CHOICE] });
    const [ask] = w.asks as [string];
    const chat = w.providers.chat!;
    await waitFor(() => chat.latest(ask), MINUTE, `${ask} on chat`);
    chat.give({ thread_key: ask, answer: 'sqlite', account: 'U-stranger' });
    const r = await firstRefusal(w, ask, 'the unlinked account');
    expect(r.data.field, `the refusal names the account link: ${said([r])}`).toBe('account_link_id');
    expect(String(r.data.reason), 'the refusal names the link the hub doesn\'t hold').toContain('U-stranger');
    await sleep(3000);
    await countedNothing(w, ask);
  });
});

describe(`${AC[8]} A text message carries only a link, and an "I did it" from a channel that hasn't proven a device key or a verified account link is refused`, () => {
  afterEach(cleanup, 120_000);
  it(`${AC[8]} "I did it" by email, with no device key and no account link, is refused and the task stays open`, async () => {
    const w = await world({ channels: ['email'], seed: [{ source: 'deep_ask.unblock', question: 'Sign in to the registry in your own terminal?' }] });
    const [task] = w.asks as [string];
    const email = w.providers.email!;
    await waitFor(() => email.latest(task), MINUTE, `${task} in email`);
    email.give({ thread_key: task, answer: 'done' });
    await firstRefusal(w, task, 'the unproven "I did it"');
    await sleep(3000);
    await countedNothing(w, task);
  });
});

// AC15's case (the unpaired phone's answer) and AC16's three (a replay to a second hub, one signed 11 minutes ago, a
// changed card) are proven by the blind redraft redraft-1579/proofs.test.ts, swapped in with the owner's approval:
// #1579 changed what a paired device signs, so this draft's phone fails them on the format, not on what they test.
