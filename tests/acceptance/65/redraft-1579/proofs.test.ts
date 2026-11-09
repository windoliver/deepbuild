// Blind redraft (README) of #65's proofs of a phone's answer, signed in the current format: AC5's forged-signature case
// (an answer marked as signed by the paired phone with no valid signature is refused naming the device key), AC15 (an
// unpaired phone's key counts for nothing, and its next connection is told) and AC16 (a replayed, a stale and a
// changed-card answer are each refused naming the field). Each is the earlier ../proofs.test.ts case with the phone's
// signature in the design's shape; each answer reaches the hub through the real paseo channel from its provider's
// stand-in, and the expected fields are the earlier suite's. AC5's account-link case doesn't sign and stays there.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { AC, MINUTE, cleanup, events, inboxRow, ofKind, openInNeedsYou, rpc, said, sleep, waitFor, world, type Ev, type World } from '../helpers.ts';
import type { Provider } from '../fixtures/providers.ts';
import type { Phone } from './fixtures/phone.ts';
import { phoneOf } from './helpers.ts';

const CHOICE = { source: 'deep_ask.choice', question: 'Keep the cache in SQLite or in plain files?' } as const;
/** The hub's refusals of channel answers for a thread, wherever it files them (../README, The surface: channel.refused). */
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
  it(`${AC[5]} an answer marked as signed by the paired phone with another key's signature is refused naming the phone's device, and counts as nothing`, async () => {
    const w = await world({ channels: ['paseo'], phone: true, seed: [CHOICE] });
    const [ask] = w.asks as [string];
    const phone = await phoneOf(w);
    const relay = w.providers.paseo!;
    await waitFor(() => relay.latest(ask), MINUTE, `${ask} on the phone`);
    phone.answer(relay, ask, 'sqlite', { forged: true });
    const r = await firstRefusal(w, ask, 'the forged signature');
    expect(r.data.field, `the refusal names the signature: ${said([r])}`).toBe('signature');
    expect(String(r.data.reason), 'the refusal names the paired device whose key didn\'t sign it').toContain(phone.device);
    await sleep(3000);
    await countedNothing(w, ask);
  });
});

describe(`${AC[15]} After the test phone is unpaired, an answer signed by its key is refused naming the key and counts as nothing, and its next connection is told it was unpaired; a hub that still accepts the key fails this test`, () => {
  afterEach(cleanup, 120_000);
  it(`${AC[15]} unpaired on the trusted path, the phone is told so, and its signed answer is refused naming its device`, async () => {
    const w = await world({ channels: ['paseo'], phone: true, seed: [CHOICE] });
    const [ask] = w.asks as [string];
    const phone = await phoneOf(w);
    const relay = w.providers.paseo!;
    await waitFor(() => relay.latest(ask), MINUTE, `${ask} on the phone`);
    const reply = await rpc(w, 'device.unpair', { device: phone.device });
    expect(reply.error, `device.unpair counts once the OS confirms you: ${JSON.stringify(reply)}`).toBeUndefined();
    const told = await waitFor(() => relay.posts.find((p) => p.item.unpaired?.device === phone.device), 30_000, 'the phone told it was unpaired');
    expect(String(told.item.unpaired?.by ?? ''), 'it says which Mac unpaired it').not.toBe('');
    phone.answer(relay, ask, 'sqlite');
    const r = await firstRefusal(w, ask, 'the unpaired key\'s answer');
    expect(r.data.field, `the refusal names the device: ${said([r])}`).toBe('device');
    expect(String(r.data.reason), 'the refusal names the unpaired device').toContain(phone.device);
    await sleep(3000);
    await countedNothing(w, ask);
  });
});

describe(`${AC[16]} A signed answer replayed to a second hub, one signed more than 10 minutes ago, and one whose card text was changed on the way are each refused, naming the field`, () => {
  // Two hubs, both with the paseo channel: the first holds three asks and the paired phone; the second is where a
  // signed answer is replayed. The third ask's card is changed on the way to the phone.
  let made: Promise<{ a: World; b: World; relay: Provider; asks: string[]; phone: Phone }> | undefined;
  const both = () => (made ??= (async () => {
    const a = await world({
      channels: ['paseo'], phone: true, seed: [CHOICE, { ...CHOICE, question: 'Log in JSON or in plain text?' }, { ...CHOICE, question: 'Ship the beta on Monday or on Friday?' }],
      beforeInstall: (x) => { x.providers.paseo!.tamper = (item) => (item.thread_key === x.asks[2] ? { ...item, summary: `${item.summary} Also delete the backups.` } : item); },
    });
    const b = await world({ channels: ['paseo'] });
    const relay = a.providers.paseo!;
    for (const ask of a.asks) await waitFor(() => relay.latest(ask), MINUTE, `${ask} on the phone`);
    return { a, b, relay, asks: a.asks, phone: await phoneOf(a) };
  })());
  afterAll(cleanup, 120_000);

  it(`${AC[16]} the phone's signed answer, counted by its own hub, replayed to a second hub is refused there naming hub`, async () => {
    const { a, b, relay, asks, phone } = await both();
    const { answer } = phone.answer(relay, asks[0]!, 'sqlite');
    await waitFor(async () => (await ofKind(a, 'ask.answered', asks[0]!))[0], 30_000, 'the first hub counting the phone\'s signed answer')
      .catch(async (e: Error) => { throw Error(`${e.message}; its refusals: ${said(await refused(a, asks[0]!))}`); });
    b.providers.paseo!.give(answer);
    const r = await firstRefusal(b, asks[0]!, 'the replayed answer on the second hub');
    expect(r.data.field, `the second hub names the field: ${said([r])}`).toBe('hub');
    expect(await ofKind(b, 'ask.answered'), 'the second hub counted nothing').toEqual([]);
  });

  it(`${AC[16]} an answer signed 11 minutes ago is refused naming at`, async () => {
    const { a, relay, asks, phone } = await both();
    phone.answer(relay, asks[1]!, 'sqlite', { at: Date.now() - 11 * MINUTE });
    const r = await firstRefusal(a, asks[1]!, 'the stale answer');
    expect(r.data.field, `the refusal names the field: ${said([r])}`).toBe('at');
    await countedNothing(a, asks[1]!);
  });

  it(`${AC[16]} an answer signed over a card changed on the way is refused naming card_hash`, async () => {
    const { a, relay, asks, phone } = await both();
    expect(relay.latest(asks[2]!)?.summary, 'the phone shows the changed card').toContain('Also delete the backups.');
    phone.answer(relay, asks[2]!, 'sqlite');
    const r = await firstRefusal(a, asks[2]!, 'the changed card\'s answer');
    expect(r.data.field, `the refusal names the field: ${said([r])}`).toBe('card_hash');
    await countedNothing(a, asks[2]!);
  });
});
