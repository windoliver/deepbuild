// #1579 AC2: a signature 11 minutes old, one for another hub and one replayed are each refused, naming the field.
// Design: Socket roles and contract versions (`at` milliseconds since the epoch, good for 10 minutes by the hub's
// clock; `hub` the ID the hub's hello names; `once` an ID the device never uses again, kept spent across restarts).
// Through the hub's socket, as the DeepBuild app calls it; the hub's clock is read and stepped with test.clock.
import { afterEach, describe, expect, it } from 'vitest';
import { AC, asApp, cleanup, defaulted, inboxRow, refusedSignature, signNew, signing, signOld, undoneCount, world, holds } from './helpers.ts';
import { caseAt, caseFresh, caseHub, caseOnce, caseWithinWindow, PAST_WAIT_MS, UNDO_WAIT_MS } from './scenarios.ts';

afterEach(cleanup, 60_000);

describe(`${AC[2]} A signature 11 minutes old, one for another hub and one replayed are each refused, naming the field`, () => {
  it(`${AC[2]} an approval signed 11 minutes ago by the hub's clock is refused naming at and answers nothing; one signed 9 minutes ago counts, and so does a fresh one for the refused ask`, async () => {
    const w = await world({ asks: [{ source: 'effect.push', question: 'Push feature/1579-old to origin?' }, { source: 'effect.push', question: 'Push feature/1579-nine to origin?' }] });
    const [old, nine] = [w.asks[0]!, w.asks[1]!];
    holds(await caseAt(w, old));
    holds(await caseWithinWindow(w, nine));
    holds(await caseFresh(w, old));
  }, 300_000);

  it(`${AC[2]} an approval signed for another hub is refused naming hub and answers nothing; the same approval signed for this hub's ID counts`, async () => {
    const w = await world({ asks: [{ source: 'effect.push', question: 'Push feature/1579-hub to origin?' }] });
    holds(await caseHub(w, w.asks[0]!));
    holds(await caseFresh(w, w.asks[0]!));
  }, 300_000);

  it(`${AC[2]} a signed undo that counted, replayed once its ask defaults again, is refused naming once, before and after the hub restarts, and opens nothing`, async () => {
    const w = await world({ asks: [{ source: 'effect.push', question: 'Push release/1579-again to origin?', waitMs: UNDO_WAIT_MS }] });
    holds(await caseOnce(w, w.asks[0]!, { restart: true }));
  }, 300_000);

  it(`${AC[2]} the merge base's format: a signed undo replayed once its ask defaults again is refused at the signature (the merge base opens the ask again each time)`, async () => {
    // The issue's account of the merge base: `{ask, device}` signed once is good each time that ask defaults.
    const w = await world({ asks: [{ source: 'effect.push', question: 'Push release/1579-old-again to origin?', waitMs: UNDO_WAIT_MS }] });
    const x = w.asks[0]!;
    await defaulted(w, x.handle, PAST_WAIT_MS);
    const old = signOld({ ask: x.handle }, w.device);
    await asApp(w, 'ask.undo', old);
    // Whether or not this hub took it the first time, the ask is defaulted when the same undo comes back.
    await defaulted(w, x.handle, PAST_WAIT_MS);
    const before = await undoneCount(w, x.handle);
    const reply = await asApp(w, 'ask.undo', old);
    const path = String(reply.error?.path ?? '');
    holds(path === '/params/device' ? null : refusedSignature(reply, `the merge base's signed undo of ${x.handle}, replayed`));
    expect(await undoneCount(w, x.handle), `the replayed undo opened ${x.handle} again`).toBe(before);
    expect((await inboxRow(w, x.handle))?.outcome).toBe('defaulted');
    // The design's format for the same undo, fresh, counts: the refusal above was the old signature's.
    const fresh = await asApp(w, 'ask.undo', signNew('ask.undo', { ask: x.handle }, w.device, await signing(w)));
    expect('result' in fresh, `a fresh undo of ${x.handle} in the design's format counts: ${JSON.stringify(fresh)}`).toBe(true);
  }, 300_000);
});
