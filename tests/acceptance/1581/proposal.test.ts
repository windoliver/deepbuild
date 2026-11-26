// AC1 and AC3 of #1581 through the real hub, a real chat channel plug-in and the real `deep mcp` (the world of
// tests/acceptance/65, imported as it is). Chat is the stand-in provider; the linked account is yours (channel.link).
import { afterEach, describe, expect, it } from 'vitest';
import { Mcp, cleanup, describeItem, events, inboxRow, live, ofKind, openInNeedsYou, paseoAgent, refusalsOf, said, turnStarts, waitFor, within, world, MINUTE, WHERE, YOU } from '../65/helpers.ts';

afterEach(cleanup, 120_000);

describe('AC1 #1581.e1bcacd3 A proposal answered through a linked chat account is refused, naming the trusted path, and arrives there with no buttons. The merge base accepts it', () => {
  it('AC1 #1581.e1bcacd3 chat\'s "apply" to an agent\'s deep_propose is refused naming the trusted path, counts as nothing, and the card chat got had no answer buttons', async () => {
    const w = await world({ channels: ['chat'], link: true });
    const a = paseoAgent(w.repo);
    await turnStarts(w, a);
    const mcp = await Mcp.start(w, a);
    const proposed = await mcp.call('deep_propose', { target: 'wiki:repos/api#start-port', change: 'api starts on port 3002', evidence: null });
    const ask = String(proposed.ask ?? '');
    if (!/^ask:[0-9A-Za-z]+$/.test(ask)) throw Error(`BLOCKED: deep_propose returned no ask handle: ${JSON.stringify(proposed)}`);
    const chat = w.providers.chat!;
    const card = await waitFor(() => chat.latest(ask), MINUTE, `the proposal ${ask} on chat`);

    // A person (or anyone holding the linked account) answers "Apply it" on chat, whatever the card offered.
    chat.give({ thread_key: ask, answer: 'apply', account: YOU });
    await within(30_000, async () => (await refusalsOf(w, ask))[0] ?? (await ofKind(w, 'ask.answered', ask))[0]);
    const answered = await ofKind(w, 'ask.answered', ask);
    expect(answered, `the hub took chat's "apply" for the proposal ${ask} as an answer (${said(answered)}); the card chat showed carried ${describeItem(card)}`).toEqual([]);
    expect((await ofKind(w, 'decision.created')).filter((e) => e.data.ask === ask), 'chat\'s "apply" saved a decision').toEqual([]);

    const refusals = await refusalsOf(w, ask);
    expect(refusals.length, `the hub refused chat's answer on ${ask}: ${said(await events(w).then((e) => e.filter((x) => x.kind.startsWith('channel.'))))}`).toBeGreaterThan(0);
    expect(refusals[0]!.data.channel, 'the refusal names the channel').toBe('chat');
    expect(String(refusals[0]!.data.reason), 'the refusal names the trusted path').toMatch(/trusted path/i);
    expect(openInNeedsYou(await inboxRow(w, ask)), 'the proposal is still open in Needs you').toBe(true);

    // Every card chat ever got for the proposal: no answer buttons, and where to answer (#65).
    const cards = chat.delivered(ask);
    expect(cards.filter((c) => live(c)).map(describeItem), 'cards chat got for the proposal with answer buttons').toEqual([]);
    expect(cards.every((c) => c.options.length === 0 && c.answerable !== 'answer'), `no answer buttons on any card: ${cards.map(describeItem).join(' | ')}`).toBe(true);
    expect(card.summary.toLowerCase(), 'the first card says where to answer').toContain(WHERE);
  });
});

describe('AC3 #1581.ecbb919c A taste ask still takes a verified channel\'s answer', () => {
  it('AC3 #1581.ecbb919c a taste call arrives on chat with buttons and is answered from the linked account, recorded as a channel answer', async () => {
    const w = await world({ channels: ['chat'], link: true, seed: [{ source: 'deep_ask.taste', question: 'Which header colour for the settings page?' }] });
    const [ask] = w.asks as [string];
    const chat = w.providers.chat!;
    const card = await waitFor(() => chat.latest(ask), MINUTE, `the taste call ${ask} on chat`);
    expect(live(card), `the taste call is answerable on chat with buttons: ${describeItem(card)}`).toBe(true);
    chat.give({ thread_key: ask, answer: 'green', account: YOU });
    const got = await waitFor(async () => (await ofKind(w, 'ask.answered', ask))[0], 30_000, `the taste call ${ask} answered from chat; refusals: ${said(await refusalsOf(w, ask))}`);
    expect([got.data.option, got.data.answer], `the answer is the option pressed: ${said([got])}`).toContain('green');
    expect(got.data.via, 'it is a channel answer').toBe('channel');
    expect(await refusalsOf(w, ask), 'the hub refused nothing').toEqual([]);
  });
});
