// #65's routing and rendering: AC6 (no channel payload holds a secret-shaped string, a diff or evidence, on recorded
// items), AC7 (an unseen urgent item moves to the next channel after its wait; quiet hours hold what isn't urgent),
// AC8's first half (a text message carries only a link) and AC14 (an authority ask on chat arrives view only, with
// the words, and a choice arrives answerable and first). The hub's clock is the test clock (test.clock) where a wait
// or an hour matters.
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, MINUTE, SECOND, WHERE, advance, cleanup, deliveriesOf, describeItem, inTime, live, sha256, sleep, waitFor, world, type Route, type SeedAsk,
} from './helpers.ts';
import type { Item, Provider } from './fixtures/providers.ts';

afterEach(cleanup, 120_000);
const CHOICE: SeedAsk = { source: 'deep_ask.choice', question: 'Keep the cache in SQLite or in plain files?' };
const PUSH: SeedAsk = { source: 'effect.push', question: 'Push feature/channels to origin?' };
/** Urgent authority to the phone, then chat once it goes 5 minutes unseen; the rest to chat, not urgent. */
const ROUTES: Route[] = [
  { kinds: ['authority'], urgent: true, to: ['paseo'], next: ['chat'], unseen: '5m' },
  { kinds: ['choice', 'taste', 'unblock'], to: ['chat'] },
];
const todayAt = (h: number, m: number): number => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m); };

describe(`${AC[6]} No channel payload contains a secret-shaped string, a diff or evidence, checked on recorded items`, () => {
  it(`${AC[6]} the cards every channel carried, as the record holds them and as the providers got them, hold no token, no diff and no evidence hash`, async () => {
    // Built here, never written in a file: shaped like a GitHub token, with no account behind it.
    const token = `gh${'p_'}${sha256('#65 AC6').replace(/[^a-z]/g, 'Q').slice(0, 36)}`;
    const diff = `diff --git a/src/key.js b/src/key.js\n--- a/src/key.js\n+++ b/src/key.js\n@@ -1 +1 @@\n-const key = '${token}';\n+const key = process.env.KEY;\n`;
    const evidence = sha256('#65 AC6 evidence');
    const planDiff = sha256(diff);
    const w = await world({
      channels: ['paseo', 'chat', 'email', 'text'], link: true, phone: true,
      seed: [
        { source: 'deep_ask.choice', question: `Rotate the leaked key ${token} now? The fix:\n${diff}The run that found it: sha256:${evidence}` },
        { ...PUSH, question: 'Push the key fix to origin?', plan: { steps: [{ does: 'Push the key fix', changes: ['effect.push'], undo: 'Revert it', public: true, cost: 0 }], diff: planDiff } },
      ],
    });
    for (const [k, p] of Object.entries(w.providers)) for (const ask of w.asks) await waitFor(() => p!.latest(ask), MINUTE, `${ask} on the ${k} channel`);
    const recorded = await deliveriesOf(w);
    expect(recorded.length, 'the record holds what each channel carried (channel.delivered), both asks on all four').toBeGreaterThanOrEqual(8);
    const carried = [
      ...recorded.map((e) => ({ where: `record ${String(e.data.channel)} ${String(e.subject ?? e.data.thread_key)}`, text: JSON.stringify(e.data.item ?? null) })),
      ...Object.entries(w.providers).flatMap(([k, p]) => p!.posts.map((x) => ({ where: `${k} provider ${x.item.thread_key}`, text: JSON.stringify(x) }))),
    ];
    expect(recorded.every((e) => typeof e.data.item === 'object' && e.data.item !== null), 'each recorded delivery holds its item').toBe(true);
    const shapes: [string, RegExp][] = [
      ['a GitHub token', /gh[pousr]_[A-Za-z0-9]{20,}/], ['the planted token', new RegExp(token.slice(4, 24))],
      ['a diff header', /diff --git|^(---|\+\+\+) [ab]\/|@@ -\d/m], ['a diff line', /\\n[-+]const key/],
      ['the evidence hash', new RegExp(evidence)], ['the plan diff\'s hash', new RegExp(planDiff)], ['an evidence handle', /sha256:[0-9a-f]{16,}/],
    ];
    const found = carried.flatMap(({ where, text }) => shapes.filter(([, re]) => re.test(text)).map(([what]) => `${where}: ${what}`));
    expect(found, 'no payload carries a secret, a diff or evidence').toEqual([]);
  });
});

describe(`${AC[7]} An unseen urgent item moves to the next channel after its wait, and quiet hours hold everything you didn't mark urgent`, () => {
  it(`${AC[7]} an urgent authority ask unseen on the phone reaches chat only after its 5-minute wait`, async (ctx) => {
    const w = await world({ channels: ['paseo', 'chat'], routes: ROUTES, clock: todayAt(12, 0), seed: [PUSH] });
    const [ask] = w.asks as [string];
    const { paseo, chat } = w.providers as Record<'paseo' | 'chat', Provider>;
    await waitFor(() => paseo.latest(ask), MINUTE, `${ask} on the phone`);
    await sleep(10 * SECOND);
    expect(chat.latest(ask), `chat got ${ask} before its wait: ${describeItem(chat.latest(ask))}`).toBeUndefined();
    await advance(w, 5 * MINUTE + SECOND);
    const since = Date.now();
    await inTime(ctx, `${ask}, unseen for 5 minutes, on chat`, since, 10 * SECOND, () => chat.latest(ask));
  });

  it(`${AC[7]} at 23:00 inside quiet hours 22:00 to 07:00 the urgent ask goes out and the choice waits, then goes once quiet hours end`, async (ctx) => {
    const w = await world({ channels: ['paseo', 'chat'], routes: ROUTES, quiet: { from: '22:00', to: '07:00' }, clock: todayAt(23, 0), seed: [PUSH, CHOICE] });
    const [push, choice] = w.asks as [string, string];
    const { paseo, chat } = w.providers as Record<'paseo' | 'chat', Provider>;
    await waitFor(() => paseo.latest(push), MINUTE, `the urgent ${push} on the phone in quiet hours`);
    await sleep(15 * SECOND);
    expect(chat.latest(choice), `quiet hours let the choice through: ${describeItem(chat.latest(choice))}`).toBeUndefined();
    await advance(w, 8 * 60 * MINUTE + MINUTE);
    const since = Date.now();
    await inTime(ctx, `the held choice ${choice} on chat once quiet hours ended`, since, 10 * SECOND, () => chat.latest(choice));
  });
});

describe(`${AC[8]} A text message carries only a link, and an "I did it" from a channel that hasn't proven a device key or a verified account link is refused`, () => {
  it(`${AC[8]} every text message is the item's link alone, the same link chat got, with no summary, no buttons and no words`, async () => {
    const w = await world({ channels: ['chat', 'text'], link: true, seed: [CHOICE, PUSH] });
    const { chat, text } = w.providers as Record<'chat' | 'text', Provider>;
    for (const ask of w.asks) await waitFor(() => text.latest(ask) && chat.latest(ask), MINUTE, `${ask} on text and on chat`);
    const recorded = (await deliveriesOf(w, 'text')).map((e) => e.data.item as Item);
    expect(recorded.length, 'the record holds what the text channel carried').toBeGreaterThan(0);
    for (const item of [...text.posts.map((p) => p.item), ...recorded]) {
      expect({ summary: item.summary, options: item.options, refused: item.refused ?? null }, `a text message is only its link: ${JSON.stringify(item)}`).toEqual({ summary: '', options: [], refused: null });
      expect(item.link, 'one link, nothing else').toMatch(/^[a-z][a-z0-9+.-]*:\/\/\S+$/);
      expect(item.link, 'the link carries none of the question').not.toMatch(/SQLite|feature\/channels/);
      expect(item.link, 'the same link chat carries').toBe(chat.latest(item.thread_key)!.link);
    }
  });
});

describe(`${AC[14]} An authority ask sent to a chat channel arrives with no answer buttons and the words "answer in the app or on your paired phone", and a choice ask on the same channel arrives answerable and first; a hub that hands the chat channel live buttons for the authority ask fails this test, naming the ask`, () => {
  it(`${AC[14]} on chat, the authority ask raised first arrives view only with the words; the choice raised after it arrives answerable, and first`, async () => {
    const w = await world({ channels: ['chat'], link: true, seed: [PUSH, CHOICE] });
    const [push, choice] = w.asks as [string, string];
    const chat = w.providers.chat!;
    const authority = await waitFor(() => chat.latest(push), MINUTE, `${push} on chat`);
    const pick = await waitFor(() => chat.latest(choice), MINUTE, `${choice} on chat`);
    expect(live(authority), `${push}: chat got live buttons for the authority ask: ${describeItem(authority)}`).toBe(false);
    expect({ answerable: authority.answerable, options: authority.options }, `${push} arrives view only`).toEqual({ answerable: 'view', options: [] });
    expect(authority.summary, `${push} says where it can be answered`).toContain(WHERE);
    expect(live(pick), `${choice} arrives answerable: ${describeItem(pick)}`).toBe(true);
    const order = chat.posts.filter((p) => p.status === 200).map((p) => p.item.thread_key);
    expect(order.indexOf(choice), `the answerable ${choice} arrives first: ${order.join(', ')}`).toBeLessThan(order.indexOf(push));
  });
});
