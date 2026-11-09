// #65's answers through channels: AC1 (an answer on one channel closes the item everywhere and in Needs you within
// 10 s), AC2 (an authority answer from chat is refused, pointing to the trusted path), AC3 (the phone's signed yes
// reaches the waiting session as a decision; unsigned, it counts as nothing) and AC10 (B on the phone, then C in the
// app: B stands, C is refused naming B and its channel). The hub, the record, the asks core and the channel plug-ins
// are real; the providers and the phone are stand-ins (README, The worlds).
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, MINUTE, YOU, cleanup, inboxRow, live, ofKind, openInNeedsYou, paseoAgent, permission, refusalsOf, said, sleep, turnStarts, waitFor, world,
} from './helpers.ts';

afterEach(cleanup, 120_000);

// AC1's case (a choice answered on the paired phone, closed everywhere within 10 s), AC3's signed approve and AC10's
// case (B on the phone, then C in the app) are proven by the blind redraft redraft-1579/answers.test.ts, swapped in
// with the owner's approval: #1579 changed what a paired device signs, so this draft's phone and app signers fail
// them on the format, not on what they test.

describe(`${AC[2]} An authority answer arriving through a chat channel is refused and points to the trusted path`, () => {
  it(`${AC[2]} an approve from your linked chat account on an authority ask is refused naming the trusted path, the ask stays open, and chat gets the card back with the reason`, async () => {
    const w = await world({ channels: ['chat'], link: true, seed: [{ source: 'effect.push', question: 'Push feature/channels to origin?' }] });
    const [ask] = w.asks as [string];
    const chat = w.providers.chat!;
    await waitFor(() => chat.latest(ask), MINUTE, `${ask} on chat`);
    const before = chat.delivered(ask).length;
    chat.give({ thread_key: ask, answer: 'approve', account: YOU });
    const refused = await waitFor(async () => (await refusalsOf(w, ask))[0], 30_000, `the hub's channel.refused for the chat answer to ${ask}`);
    expect(refused.data.channel, 'the refusal names the channel').toBe('chat');
    expect(String(refused.data.reason), 'the refusal points to the trusted path').toMatch(/trusted path/i);
    const back = await waitFor(() => chat.delivered(ask).slice(before).find((i) => /trusted path/i.test(String(i.refused ?? ''))), 30_000, `${ask}'s card back on chat with the reason`);
    expect(live(back), 'the card that comes back still has no answer buttons for an authority ask').toBe(false);
    expect(await ofKind(w, 'ask.answered', ask), `chat's approve counted for nothing: ${said(await ofKind(w, 'ask.answered', ask))}`).toEqual([]);
    expect(openInNeedsYou(await inboxRow(w, ask)), 'the ask is still open in Needs you').toBe(true);
  });
});

describe(`${AC[3]} An answer given in paseo's phone app, signed with the phone's paired device key, reaches the waiting session and is saved as a decision; the same answer with no valid signature counts as nothing for an authority ask and points to the trusted path`, () => {
  it(`${AC[3]} the same approve with no signature counts as nothing for the authority ask and points to the trusted path`, async () => {
    const w = await world({ channels: ['paseo'], phone: true });
    const a = paseoAgent(w.repo);
    await turnStarts(w, a);
    const { ask, held } = await permission(w, a, 'git push origin main');
    const relay = w.providers.paseo!;
    await waitFor(() => relay.latest(ask), MINUTE, `${ask} on the phone`);
    w.phone.answer(relay, ask, 'approve', { sign: 'none' });
    const refused = await waitFor(async () => (await refusalsOf(w, ask))[0], 30_000, `the hub's channel.refused for the unsigned answer to ${ask}`);
    expect(String(refused.data.reason), 'the refusal points to the trusted path').toMatch(/trusted path/i);
    expect(await Promise.race([held.reply, sleep(10_000).then(() => 'none')]), 'the waiting session got no answer').toBe('none');
    expect(await ofKind(w, 'ask.answered', ask)).toEqual([]);
    expect((await ofKind(w, 'decision.created')).filter((e) => e.data.ask === ask)).toEqual([]);
    expect(openInNeedsYou(await inboxRow(w, ask)), 'the ask is still open in Needs you').toBe(true);
  });

  it(`${AC[3]} on paseo's own phone app, on a real phone`, () => {
    throw Error('BLOCKED: paseo\'s phone app runs only on a real phone paired through paseo\'s relay, which no test here can reach; the stand-in phone (fixtures/providers.ts) proves the hub\'s side (README, Readings)');
  });
});
