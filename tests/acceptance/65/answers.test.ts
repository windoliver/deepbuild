// #65's answers through channels: AC1 (an answer on one channel closes the item everywhere and in Needs you within
// 10 s), AC2 (an authority answer from chat is refused, pointing to the trusted path), AC3 (the phone's signed yes
// reaches the waiting session as a decision; unsigned, it counts as nothing) and AC10 (B on the phone, then C in the
// app: B stands, C is refused naming B and its channel). The hub, the record, the asks core and the channel plug-ins
// are real; the providers and the phone are stand-ins (README, The worlds).
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, MINUTE, YOU, appAnswer, cleanup, closed, describeItem, inTime, inboxRow, live, ofKind, openInNeedsYou, paseoAgent, permission, refusalsOf, said, sleep, turnStarts, waitFor, world, type Line,
} from './helpers.ts';

afterEach(cleanup, 120_000);
const CHOICE = { source: 'deep_ask.choice', question: 'Keep the cache in SQLite or in plain files?' } as const;

describe(`${AC[1]} An ask answered on one channel is gone from every other channel and from Needs you within 10 seconds`, () => {
  it(`${AC[1]} a choice answered on the paired phone is closed on chat, email and text, and in Needs you, within 10 s`, async (ctx) => {
    const w = await world({ channels: ['paseo', 'chat', 'email', 'text'], link: true, phone: true, seed: [CHOICE] });
    const [ask] = w.asks as [string];
    const p = w.providers;
    for (const k of ['paseo', 'chat', 'email', 'text'] as const) await waitFor(() => p[k]!.latest(ask), MINUTE, `${ask} on the ${k} channel`);
    const since = Date.now();
    w.phone.answer(p.paseo!, ask, 'sqlite');
    const still = async (): Promise<string[]> => [
      ...(['chat', 'email', 'text'] as const).filter((k) => !closed(p[k]!.latest(ask))).map((k) => `${k} still shows ${describeItem(p[k]!.latest(ask))}`),
      ...((await inboxRow(w, ask))?.status === 'closed' ? [] : [`Needs you still holds it: ${JSON.stringify(await inboxRow(w, ask))}`]),
    ];
    await inTime(ctx, `${ask}, answered on the phone, gone from chat, email, text and Needs you`, since, 10_000, async () => (await still()).length === 0, async () => (await still()).join('; '));
    expect((await ofKind(w, 'ask.answered', ask)).map((e) => e.data.answer), 'the phone\'s answer is the one recorded').toEqual(['sqlite']);
  });
});

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
  it(`${AC[3]} the phone's signed approve of a held permission request reaches the session as allow and is saved as a decision`, async () => {
    const w = await world({ channels: ['paseo'], phone: true });
    const a = paseoAgent(w.repo);
    await turnStarts(w, a);
    const { ask, held } = await permission(w, a, 'git push origin main');
    const relay = w.providers.paseo!;
    const card = await waitFor(() => relay.latest(ask), MINUTE, `${ask} on the phone`);
    expect(live(card), `the phone can answer the authority ask: ${describeItem(card)}`).toBe(true);
    w.phone.answer(relay, ask, 'approve');
    const reply = await Promise.race([held.reply, sleep(MINUTE).then(() => undefined)]);
    expect(reply, 'the waiting session got an answer').toBeDefined();
    expect((JSON.parse(String(reply!.stdout)) as Line).decision, `the session's reply: ${JSON.stringify(reply)}`).toBe('allow');
    const decisions = (await ofKind(w, 'decision.created')).filter((e) => e.data.ask === ask);
    expect(decisions.map((e) => e.data.answer), `the phone's answer saved as a decision: ${said(decisions)}`).toEqual(['approve']);
  });

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

describe(`${AC[10]} One choice ask answered B on the paired phone and C in the app 2 s later records B, the first appended, refuses C naming B and its channel, and delivers one answer; a last-writer-wins hub delivers C after B and fails this test, naming both channels`, () => {
  it(`${AC[10]} B on the phone, then C in the app 2 s later: B is the one answer, and C is refused naming B and the paseo channel`, async () => {
    const options = [{ id: 'A', label: 'Retry once' }, { id: 'B', label: 'Retry three times' }, { id: 'C', label: 'Never retry' }];
    const w = await world({ channels: ['paseo'], phone: true, app: true, seed: [{ source: 'deep_ask.choice', question: 'How often should the upload retry?', options }] });
    const [ask] = w.asks as [string];
    const relay = w.providers.paseo!;
    await waitFor(() => relay.latest(ask), MINUTE, `${ask} on the phone`);
    const t0 = Date.now();
    const b = w.phone.answer(relay, ask, 'B');
    await waitFor(() => b.picked(), 30_000, 'the paseo channel taking B from the relay');
    await sleep(Math.max(0, t0 + 2000 - Date.now()));
    const c = await appAnswer(w, ask, 'C');
    await sleep(5000);
    const answered = await ofKind(w, 'ask.answered', ask);
    const recorded = answered.map((e) => String(e.data.answer));
    expect(recorded, `one answer, B from the phone (paseo); recorded: ${recorded.join(' then ') || 'none'}, so a hub that took the app's C after the phone's B fails here`).toEqual(['B']);
    expect(c.error, `the app's C is refused: ${JSON.stringify(c)}`).toBeDefined();
    const why = JSON.stringify(c.error);
    expect(why, 'the refusal names B').toMatch(/\bB\b/);
    expect(why, 'the refusal names the channel B came by').toMatch(/paseo/);
  });
});
