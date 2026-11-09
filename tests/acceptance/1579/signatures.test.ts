// #1579 AC1, AC2, AC4 and AC5's kit half, against a real hub process: a paired device's signature covers the method,
// the hub's ID, the time, a once-only ID and the hash of the params, is good for 10 minutes and is checked by one
// verifier (design: Socket roles and contract versions, The trusted path is a device you paired). Every hub here runs
// with the OS confirmation's stand-in saying no unless a test says yes (#34's Confirmer), so nothing counts on the OS
// confirming you: only the signature can make an answer, an undo or an unpair count. README, Pinned here, says the format.
import { afterEach, describe, expect, it } from 'vitest';
import {
  another, answerEffect, asApp, asCli, cleanup, confirmEnv, hubNow, judgeCounted, judgeRefused, letDefault, MINUTE, outcomeOf, sha256, signFor,
  signOld, startHub, step, stopHub, undoEffect, verifierKit, world,
} from './helpers.ts';

afterEach(cleanup, 60_000);

describe('AC1 #1579 a signature captured on an undo is refused on another method, naming the method', () => {
  it('AC1 the app\'s signed undo counts; the same signature sent as an answer to the ask it opened is refused naming the method, and the ask stays open', async () => {
    const w = await world({ defaulting: 1 });
    const ask = w.asks[0]!;
    await letDefault(w, ask.handle);
    const undo = signFor('ask.undo', { ask: ask.handle }, w.device, w.hubId, await hubNow(w));
    const undone = await w.app.call('ask.undo', undo, 20_000);
    expect(undone.error, `the signed undo counts: ${JSON.stringify(undone)}`).toBeUndefined();
    expect(await outcomeOf(w, ask.handle), 'the undo opened the ask again').toBe('unanswered');
    // Captured, and sent on another method with the very params it signs.
    const reply = await w.app.call('ask.answer', undo, 20_000);
    expect(judgeRefused('method', reply, await answerEffect(w, ask.handle))).toBeNull();
    expect(String(reply.error.remediation), 'the refusal names the method the signature was made for').toContain('ask.undo');
  }, 180_000);

  it('AC1 a signature made for ask.undo over a full answer\'s params is refused on ask.answer, naming the method, though every other field holds', async () => {
    const w = await world({ open: 2 });
    const [ask, twin] = [w.asks[0]!, w.asks[1]!];
    const params = { ask: ask.handle, option: 'green' };
    const reply = await w.app.call('ask.answer', signFor('ask.undo', params, w.device, w.hubId, await hubNow(w)), 20_000);
    expect(judgeRefused('method', reply, await answerEffect(w, ask.handle))).toBeNull();
    expect(String(reply.error.remediation), 'the refusal names the method the signature was made for').toContain('ask.undo');
    // The same answer, signed for ask.answer, counts: the refusal was the method's.
    expect(await judgeCounted(w, twin.handle, await w.app.call('ask.answer', signFor('ask.answer', { ask: twin.handle, option: 'green' }, w.device, w.hubId, await hubNow(w)), 20_000))).toBeNull();
  }, 120_000);
});

describe('AC2 #1579 a signature 11 minutes old, one for another hub and one replayed are each refused, naming the field', () => {
  it('AC2 an answer signed on the hub\'s clock and sent 11 minutes later is refused naming at; signed 9 minutes before, it counts', async () => {
    const w = await world({ open: 2 });
    const [stale, fresh] = [w.asks[0]!, w.asks[1]!];
    const signedStale = signFor('ask.answer', { ask: stale.handle, option: 'green' }, w.device, w.hubId, await hubNow(w));
    await step(w, 11 * MINUTE);
    expect(judgeRefused('at', await w.app.call('ask.answer', signedStale, 20_000), await answerEffect(w, stale.handle))).toBeNull();
    // Inside the 10 minutes, it counts.
    const signedFresh = signFor('ask.answer', { ask: fresh.handle, option: 'green' }, w.device, w.hubId, (await hubNow(w)) - 9 * MINUTE);
    expect(await judgeCounted(w, fresh.handle, await w.app.call('ask.answer', signedFresh, 20_000))).toBeNull();
  }, 120_000);

  it('AC2 an answer signed with a time 11 minutes before the hub\'s now is refused naming at', async () => {
    const w = await world({ open: 1 });
    const ask = w.asks[0]!;
    const signed = signFor('ask.answer', { ask: ask.handle, option: 'green' }, w.device, w.hubId, (await hubNow(w)) - 11 * MINUTE);
    expect(judgeRefused('at', await w.app.call('ask.answer', signed, 20_000), await answerEffect(w, ask.handle))).toBeNull();
  }, 120_000);

  it('AC2 an answer signed for another hub is refused naming hub, and the refusal says which hub it was signed for', async () => {
    const w = await world({ open: 1 });
    const ask = w.asks[0]!;
    const elsewhere = sha256(`another hub than ${w.hubId}`);
    const reply = await w.app.call('ask.answer', signFor('ask.answer', { ask: ask.handle, option: 'green' }, w.device, elsewhere, await hubNow(w)), 20_000);
    expect(judgeRefused('hub', reply, await answerEffect(w, ask.handle))).toBeNull();
    expect(String(reply.error.remediation), 'the refusal names the hub the signature was made for').toContain(elsewhere);
  }, 120_000);

  it('AC2 a signed undo that counted, replayed from another connection once its ask defaults again, is refused naming once, and the ask stays defaulted', async () => {
    const w = await world({ defaulting: 1 });
    const ask = w.asks[0]!;
    await letDefault(w, ask.handle);
    const undo = signFor('ask.undo', { ask: ask.handle }, w.device, w.hubId, await hubNow(w));
    const first = await w.app.call('ask.undo', undo, 20_000);
    expect(first.error, `the first signed undo counts: ${JSON.stringify(first)}`).toBeUndefined();
    await letDefault(w, ask.handle);
    const other = await asApp(w.hub);
    expect(judgeRefused('once', await other.call('ask.undo', undo, 20_000), await undoEffect(w, ask.handle))).toBeNull();
    // A fresh signature for the same undo counts: the refusal was the replay's.
    const again = await other.call('ask.undo', signFor('ask.undo', { ask: ask.handle }, w.device, w.hubId, await hubNow(w)), 20_000);
    expect(again.error, `a freshly signed undo counts: ${JSON.stringify(again)}`).toBeUndefined();
    expect(await outcomeOf(w, ask.handle)).toBe('unanswered');
  }, 240_000);

  it('AC2 a spent once-only ID stays spent across a restart of the hub (README, Pinned here: 3)', async () => {
    const w = await world({ defaulting: 1 });
    const ask = w.asks[0]!;
    await letDefault(w, ask.handle);
    const undo = signFor('ask.undo', { ask: ask.handle }, w.device, w.hubId, await hubNow(w));
    expect((await w.app.call('ask.undo', undo, 20_000)).error).toBeUndefined();
    await letDefault(w, ask.handle);
    // Restarted on the same root and clock: the table of spent IDs is the record's, not the process's.
    const now = await hubNow(w);
    await stopHub(w.hub);
    const hub = await startHub({ home: w.hub.home, clock: now, env: { ...confirmEnv(w.confirm), DEEP_HUB_TEST_CLOCK_STEPS: '1' } });
    const app = await asApp(hub);
    const w2 = { ...w, hub, app, cli: await asCli(hub) };
    expect(await outcomeOf(w2, ask.handle), 'the ask is still defaulted after the restart').toBe('defaulted');
    expect(judgeRefused('once', await app.call('ask.undo', undo, 20_000), await undoEffect(w2, ask.handle))).toBeNull();
  }, 240_000);
});

describe('AC2 #1579 a signature in the base\'s format no longer counts: every signature covers the method, hub, time and once-only ID', () => {
  it('AC2 an answer signed as the base signs one (device in the params, a string signature) is refused and leaves the ask open', async () => {
    const w = await world({ open: 1 });
    const ask = w.asks[0]!;
    const reply = await w.app.call('ask.answer', signOld({ ask: ask.handle, option: 'green' }, w.device), 20_000);
    expect('error' in reply, `the base-format answer is refused: ${JSON.stringify(reply)}`).toBe(true);
    expect(await answerEffect(w, ask.handle)).toBeNull();
  }, 120_000);
});

describe('AC4 #1579 a signed unpair works', () => {
  it('AC4 the app signs an unpair of the phone: the hub unpairs it, with no OS prompt, and what the phone signs then counts for nothing, naming its device', async () => {
    const w = await world({ open: 2 });
    const phone = await another(w, 'the test phone');
    const [before, after] = [w.asks[0]!, w.asks[1]!];
    // The phone's signature counts while it is paired.
    expect(await judgeCounted(w, before.handle, await w.app.call('ask.answer', signFor('ask.answer', { ask: before.handle, option: 'green' }, phone, w.hubId, await hubNow(w)), 20_000))).toBeNull();
    const prompts = w.confirm.prompts().length;
    const reply = await w.app.call('device.unpair', signFor('device.unpair', { device: phone.id! }, w.device, w.hubId, await hubNow(w)), 20_000);
    expect(reply.error, `the signed unpair counts: ${JSON.stringify(reply)}`).toBeUndefined();
    expect(reply.result?.unpaired, 'the reply names the device unpaired').toBe(phone.id);
    expect(w.confirm.prompts().length, 'the signature was the trusted path: the OS wasn\'t asked').toBe(prompts);
    const late = await w.app.call('ask.answer', signFor('ask.answer', { ask: after.handle, option: 'green' }, phone, w.hubId, await hubNow(w)), 20_000);
    expect(judgeRefused('device', late, await answerEffect(w, after.handle))).toBeNull();
    // The app, which signed the unpair, is still paired.
    expect(await judgeCounted(w, after.handle, await w.app.call('ask.answer', signFor('ask.answer', { ask: after.handle, option: 'green' }, w.device, w.hubId, await hubNow(w)), 20_000))).toBeNull();
  }, 120_000);

  it('AC4 a device signs its own unpair, and its next signature counts for nothing', async () => {
    const w = await world({ open: 1 });
    const phone = await another(w, 'the test phone');
    const reply = await w.app.call('device.unpair', signFor('device.unpair', { device: phone.id! }, phone, w.hubId, await hubNow(w)), 20_000);
    expect(reply.error, `the phone's signed unpair of itself counts: ${JSON.stringify(reply)}`).toBeUndefined();
    const ask = w.asks[0]!;
    expect(judgeRefused('device', await w.app.call('ask.answer', signFor('ask.answer', { ask: ask.handle, option: 'green' }, phone, w.hubId, await hubNow(w)), 20_000), await answerEffect(w, ask.handle))).toBeNull();
  }, 120_000);

  it('AC4 an unpair signed for another device than the one it names is refused naming params_hash, and both stay paired', async () => {
    const w = await world({ open: 1 });
    const [phone, tablet] = [await another(w, 'the test phone'), await another(w, 'the test tablet')];
    const signedForPhone = signFor('device.unpair', { device: phone.id! }, w.device, w.hubId, await hubNow(w));
    const reply = await w.app.call('device.unpair', { ...signedForPhone, device: tablet.id! }, 20_000);
    expect(judgeRefused('params_hash', reply, null)).toBeNull();
    const ask = w.asks[0]!;
    expect(await judgeCounted(w, ask.handle, await w.app.call('ask.answer', signFor('ask.answer', { ask: ask.handle, option: 'green' }, tablet, w.hubId, await hubNow(w)), 20_000)), 'the tablet is still paired').toBeNull();
  }, 120_000);
});

describe('AC5 #1579 the verifier\'s kit: the real hub passes it, and a planted verifier that skips the time fails it', () => {
  it('AC5 the real hub passes every case of the kit', async () => {
    const cases = await verifierKit(await world({ open: 5, defaulting: 1 }));
    expect(cases.map((c) => c.case), 'the kit runs every case').toEqual(['good', 'method', 'hub', 'params_hash', 'at', 'once']);
    expect(cases.filter((c) => c.failure !== null), 'every case passes').toEqual([]);
  }, 300_000);

  it('AC5 (wrong program) the hub planted with signature-skips-time fails the kit at its at case, and only there', async () => {
    const cases = await verifierKit(await world({ open: 5, defaulting: 1, plant: 'signature-skips-time' }));
    const failed = cases.filter((c) => c.failure !== null);
    expect(failed.map((c) => c.case), `the planted verifier fails the at case alone: ${JSON.stringify(failed)}`).toEqual(['at']);
    expect(failed[0]!.failure, 'the kit names what the plant let through').toMatch(/wrong at counted/);
  }, 300_000);
});
