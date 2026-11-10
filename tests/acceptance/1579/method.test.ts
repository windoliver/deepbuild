// #1579 AC1: a signature captured on an undo is refused on another method, naming the method; the merge base accepts
// it. Design: Socket roles and contract versions (a paired device's signature covers the method, the hub's ID, the
// time, a once-only ID and the hash of the params; a signature that names another method is refused, naming that
// field). Through the hub's socket, as the DeepBuild app calls it.
import { afterEach, describe, it } from 'vitest';
import { AC, answeredNothing, asApp, cleanup, defaulted, inboxRow, refusedSignature, signing, signNew, signOld, world, type Seeded, holds } from './helpers.ts';
import { caseMethod, PAST_WAIT_MS, UNDO_WAIT_MS } from './scenarios.ts';

afterEach(cleanup, 60_000);

describe(`${AC[1]} A signature captured on an undo is refused on another method, naming the method. The merge base accepts it`, () => {
  it(`${AC[1]} the app's undo, signed for ask.undo, counts; sent again on ask.answer it is refused naming method and ask.undo, and answers nothing`, async () => {
    const w = await world({ asks: [{ source: 'effect.push', question: 'Push release/1579 to origin?', waitMs: UNDO_WAIT_MS }] });
    holds(await caseMethod(w, w.asks[0]!));
  }, 300_000);

  it(`${AC[1]} the merge base's format: an undo's signature over {ask, device} alone, sent on ask.answer, is refused at the signature (the merge base takes it and refuses only for the missing option)`, async () => {
    // On the merge base the app signs an undo as {ask, device} with `signature` a string over those params, the
    // same bytes for every method that takes them. The ask is opened again by whichever undo this hub counts (the
    // design's format first, the merge base's if that one didn't), so ask.answer reaches its signature check.
    const w = await world({ asks: [{ source: 'effect.push', question: 'Push release/1579-old to origin?', waitMs: UNDO_WAIT_MS }] });
    const x: Seeded = w.asks[0]!;
    await defaulted(w, x.handle, PAST_WAIT_MS);
    const old = signOld({ ask: x.handle }, w.device);
    await asApp(w, 'ask.undo', signNew('ask.undo', { ask: x.handle }, w.device, await signing(w)));
    if ((await inboxRow(w, x.handle))?.outcome === 'defaulted') await asApp(w, 'ask.undo', old);
    const row = await inboxRow(w, x.handle);
    if (row?.outcome !== 'unanswered') throw Error(`BLOCKED: setup: neither format's undo opened ${x.handle} again: ${JSON.stringify(row)}`);
    const reply = await asApp(w, 'ask.answer', old);
    // A hub may refuse it at the signature or at the signer's `device` it carries beside it; either way not past it.
    const path = String(reply.error?.path ?? '');
    holds(path === '/params/device' ? null : refusedSignature(reply, `the merge base's undo signature for ${x.handle}, sent on ask.answer`));
    holds(await answeredNothing(w, x.handle));
  }, 300_000);
});
