// #65's sends and connections: AC11 (a card sent while the app answers ends showing the answer with no buttons; a
// press on a closed card changes nothing; a failed send closes nothing), AC12 (a second client on the bot token: the
// channel reads conflict and the hub sends nothing through it) and AC13 (the phone going silent for 2 minutes is
// reconnected alone: chat is neither delayed nor sent anything twice). The providers are stand-ins that hold, fail,
// go silent or report a second client on cue (README, The worlds).
import { afterEach, describe, expect, it } from 'vitest';
import { canonicalize, type JsonValue } from '../../../packages/contracts/src/index.ts';
import {
  AC, MINUTE, SECOND, YOU, appAnswer, cleanup, closed, describeItem, inTime, inboxRow, live, ofKind, openInNeedsYou, paseoAgent, permission, sleep, turnStarts, waitFor, world,
} from './helpers.ts';
import type { Provider } from './fixtures/providers.ts';

afterEach(cleanup, 180_000);
const CHOICE = { source: 'deep_ask.choice', question: 'Keep the cache in SQLite or in plain files?' } as const;

describe(`${AC[11]} An ask answered in the app while its chat card is still being sent ends with the card showing the app's answer and no buttons; a press on a card whose ask has closed changes neither the card nor the decision; and a send that fails leaves the ask open in Needs you and on every other channel. A hub that posts the card with live buttons after the answer, or closes the ask on a failed send, fails this test, naming the channel`, () => {
  it(`${AC[11]} answered in the app while chat's card is in flight: chat's card ends showing "Plain files" with no buttons`, async () => {
    const w = await world({ channels: ['chat'], link: true, app: true, seed: [CHOICE], beforeInstall: (x) => x.providers.chat!.holds.set(x.asks[0]!, 6000) });
    const [ask] = w.asks as [string];
    const chat = w.providers.chat!;
    await waitFor(() => chat.posts.find((p) => p.item.thread_key === ask && p.status === 0), MINUTE, `${ask}'s card in flight to chat`);
    const reply = await appAnswer(w, ask, 'files');
    expect(reply.error, `the app's answer counts: ${JSON.stringify(reply)}`).toBeUndefined();
    const card = await waitFor(() => (chat.posts.every((p) => p.item.thread_key !== ask || p.status !== 0) ? chat.latest(ask) : undefined), MINUTE, `chat's sends for ${ask} to end`);
    await waitFor(() => { const now = chat.latest(ask); return closed(now) && now!.summary.includes('Plain files') ? now : undefined; }, 30_000, `chat's card for ${ask} closed showing the app's answer`)
      .catch(() => { throw Error(`chat: the card for ${ask} ends ${describeItem(chat.latest(ask))}, not closed showing "Plain files" with no buttons (it was ${describeItem(card)} once its send ended)`); });
  });

  it(`${AC[11]} a press on chat's card after its ask closed changes neither the card nor the decision`, async () => {
    const w = await world({ channels: ['chat'], link: true, app: true, seed: [CHOICE] });
    const [ask] = w.asks as [string];
    const chat = w.providers.chat!;
    await waitFor(() => live(chat.latest(ask)), MINUTE, `${ask}'s answerable card on chat`);
    expect((await appAnswer(w, ask, 'files')).error).toBeUndefined();
    await waitFor(() => closed(chat.latest(ask)), 30_000, `chat's card for ${ask} closed after the app's answer`);
    await sleep(2000);
    const cards = chat.delivered(ask).length;
    const answers = await ofKind(w, 'ask.answered', ask);
    const decisions = (await ofKind(w, 'decision.created')).filter((e) => e.data.ask === ask);
    const press = chat.give({ thread_key: ask, answer: 'sqlite', account: YOU });
    await waitFor(() => press.picked(), 30_000, 'the chat channel taking the press');
    await sleep(5000);
    expect(chat.delivered(ask).length, `chat: the closed card changed after the press: ${describeItem(chat.latest(ask))}`).toBe(cards);
    expect((await ofKind(w, 'ask.answered', ask)).map((e) => e.data.answer), 'the answer stands').toEqual(answers.map((e) => e.data.answer));
    expect((await ofKind(w, 'decision.created')).filter((e) => e.data.ask === ask).length, 'no decision changed').toBe(decisions.length);
  });

  it(`${AC[11]} a send to chat that fails leaves the ask open in Needs you, on the phone and in email`, async () => {
    const w = await world({ channels: ['paseo', 'chat', 'email'], link: true, phone: true, seed: [CHOICE], beforeInstall: (x) => { x.providers.chat!.failing.add(x.asks[0]!); } });
    const [ask] = w.asks as [string];
    const { paseo, chat, email } = w.providers as Record<'paseo' | 'chat' | 'email', Provider>;
    await waitFor(() => chat.posts.find((p) => p.item.thread_key === ask && p.status === 500), MINUTE, `chat failing ${ask}'s send`);
    await waitFor(() => paseo.latest(ask) && email.latest(ask), MINUTE, `${ask} on the phone and in email`);
    await sleep(10_000);
    expect(openInNeedsYou(await inboxRow(w, ask)), `chat: its failed send closed ${ask} in Needs you: ${JSON.stringify(await inboxRow(w, ask))}`).toBe(true);
    for (const [name, p] of [['phone', paseo], ['email', email]] as const) expect(closed(p.latest(ask)), `chat: its failed send closed ${ask} on the ${name}: ${describeItem(p.latest(ask))}`).toBe(false);
    expect(await ofKind(w, 'ask.cancelled', ask), 'chat').toEqual([]);
  });
});

describe(`${AC[12]} With a provider fixture that reports a second client on the same bot token, the channel reads conflict and delivers nothing; a hub whose two copies keep taking turns at the token's messages loses answers and fails this test, naming the channel`, () => {
  it(`${AC[12]} once the chat provider reports a second client, the hub records chat's conflict and calls chat no more, a new item included`, async () => {
    const w = await world({ channels: ['chat'], link: true, seed: [CHOICE] });
    const chat = w.providers.chat!;
    await waitFor(() => chat.latest(w.asks[0]!), MINUTE, 'the first card on chat');
    chat.secondClient(true);
    const since = await waitFor(() => chat.conflictSince, 30_000, 'the hub calling chat after the second client came');
    const conflict = await waitFor(async () => (await ofKind(w, 'channel.conflict')).find((e) => e.data.channel === 'chat'), 30_000, 'channel.conflict naming chat');
    expect(String(conflict.data.conflict ?? ''), 'it says what the provider said').toMatch(/another client/);
    const a = paseoAgent(w.repo);
    await turnStarts(w, a);
    await permission(w, a, 'git push origin main');
    await sleep(15_000);
    const after = chat.callsAfter(since + SECOND);
    expect(after.length, `chat: the hub kept calling the bot token's provider after it reported a second client, taking turns at its messages so answers given to the other client are lost: ${after.map((c) => `${c.method} ${c.path} ${c.status}`).join(', ')}`).toBe(0);
  });
});

describe(`${AC[13]} With the phone and a chat channel connected, the phone's connection going silent for 2 minutes reconnects, delays and resends nothing on the chat channel, whose items still arrive within 10 s; a hub that reconnects every channel when one stalls fails this test, naming the chat channel`, () => {
  it(`${AC[13]} the phone silent for 2 minutes: an item raised meanwhile reaches chat within 10 s, the phone gets it once it's back, and chat is sent nothing twice`, async (ctx) => {
    const w = await world({ channels: ['paseo', 'chat'], link: true, phone: true, seed: [CHOICE] });
    const { paseo, chat } = w.providers as Record<'paseo' | 'chat', Provider>;
    const [first] = w.asks as [string];
    await waitFor(() => paseo.latest(first) && chat.latest(first), MINUTE, 'the first card on the phone and on chat');
    const a = paseoAgent(w.repo);
    await turnStarts(w, a);
    const silence = Date.now();
    paseo.silent(2 * MINUTE);
    await sleep(5000);
    const since = Date.now();
    const { ask } = await permission(w, a, 'git push origin main');
    await inTime(ctx, `chat: ${ask}, raised while the phone is silent, on chat`, since, 10_000, () => chat.latest(ask));
    await waitFor(() => paseo.posts.some((p) => p.item.thread_key === ask && p.status === 200 && p.at >= silence + 2 * MINUTE), 2 * MINUTE + MINUTE - (Date.now() - silence), `${ask} reaching the phone once its connection is back (the paseo channel reconnected)`);
    await sleep(5000);
    const sent = new Map<string, number>();
    for (const p of chat.posts.filter((x) => x.status === 200)) {
      const key = new TextDecoder().decode(canonicalize(p.item as unknown as JsonValue));
      sent.set(key, (sent.get(key) ?? 0) + 1);
    }
    const twice = [...sent].filter(([, n]) => n > 1).map(([key]) => key.slice(0, 200));
    expect(twice, `chat: the hub sent chat the same card again while the phone was silent: ${twice.join('; ')}`).toEqual([]);
  });
});
