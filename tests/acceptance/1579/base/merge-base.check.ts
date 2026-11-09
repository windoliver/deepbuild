// What the merge base (6042ef5a) does with the signatures #1579's criteria name, signed as the base signs them
// (packages/hub/src/trusted.ts: `device` in the params, Ed25519 over every other param). Each check here asserts the
// base's behaviour, the "merge base accepts it" and "the merge base refuses it" of AC1 and AC4, and the base's taking
// of the stale and replayed signatures AC2 names (its format names no hub at all, so there is nothing to run for that one). They are proof notes,
// not the suite: they fail on the fix by design, so they are kept out of the suite's run.
import { afterEach, describe, expect, it } from 'vitest';
import { another, answerEffect, asApp, cleanup, judgeCounted, letDefault, MINUTE, outcomeOf, signOld, step, world } from '../helpers.ts';

afterEach(cleanup, 60_000);

describe('the merge base', () => {
  it('AC1 base: an undo the app signs counts, and the very same signed params, sent as an answer to the ask it opened, count too', async () => {
    const w = await world({ defaulting: 1 });
    const ask = w.asks[0]!;
    await letDefault(w, ask.handle);
    // The base's undo reads only `ask`, so the app's signature over { ask, option, device } is a good undo...
    const captured = signOld({ ask: ask.handle, option: 'green' }, w.device);
    const undone = await w.app.call('ask.undo', captured, 20_000);
    expect(undone.error, JSON.stringify(undone)).toBeUndefined();
    expect(await outcomeOf(w, ask.handle)).toBe('unanswered');
    // ...and the same bytes are a good answer: nothing in them says which method they were for.
    expect(await judgeCounted(w, ask.handle, await w.app.call('ask.answer', captured, 20_000))).toBeNull();
  }, 240_000);

  it('AC1 base: the app\'s signed undo { ask, device } passes the signature check on ask.answer; only the missing option stops it', async () => {
    const w = await world({ defaulting: 1 });
    const ask = w.asks[0]!;
    await letDefault(w, ask.handle);
    const undo = signOld({ ask: ask.handle }, w.device);
    expect((await w.app.call('ask.undo', undo, 20_000)).error).toBeUndefined();
    const reply = await w.app.call('ask.answer', undo, 20_000);
    expect(reply.error?.path, JSON.stringify(reply)).not.toBe('/params/signature');
    expect(String(reply.error?.remediation ?? ''), JSON.stringify(reply)).toMatch(/option|says something/);
  }, 240_000);

  it('AC2 base: an answer the app signed 11 minutes earlier counts', async () => {
    const w = await world({ open: 1 });
    const ask = w.asks[0]!;
    const signed = signOld({ ask: ask.handle, option: 'green' }, w.device);
    await step(w, 11 * MINUTE);
    expect(await judgeCounted(w, ask.handle, await w.app.call('ask.answer', signed, 20_000))).toBeNull();
  }, 120_000);

  it('AC2 base: a signed undo that counted, replayed from another connection once its ask defaults again, counts again', async () => {
    const w = await world({ defaulting: 1 });
    const ask = w.asks[0]!;
    await letDefault(w, ask.handle);
    const undo = signOld({ ask: ask.handle }, w.device);
    expect((await w.app.call('ask.undo', undo, 20_000)).error).toBeUndefined();
    await letDefault(w, ask.handle);
    const other = await asApp(w.hub);
    const again = await other.call('ask.undo', undo, 20_000);
    expect(again.error, JSON.stringify(again)).toBeUndefined();
    expect(await outcomeOf(w, ask.handle), 'the replayed undo opened the ask again').toBe('unanswered');
  }, 240_000);

  it('AC4 base: an unpair the app signs is refused, however it is signed, and the phone stays paired', async () => {
    const w = await world({ open: 1 });
    const phone = await another(w, 'the test phone');
    const replies = [
      await w.app.call('device.unpair', signOld({ device: phone.id! }, phone), 20_000),
      await w.app.call('device.unpair', { ...signOld({}, w.device), device: phone.id! }, 20_000),
    ];
    for (const reply of replies) expect(reply.error?.code, JSON.stringify(reply)).toBe('credential');
    const ask = w.asks[0]!;
    expect(await answerEffect(w, ask.handle)).toBeNull();
    expect(await judgeCounted(w, ask.handle, await w.app.call('ask.answer', signOld({ ask: ask.handle, option: 'green' }, phone), 20_000)), 'the phone is still paired').toBeNull();
  }, 120_000);
});
