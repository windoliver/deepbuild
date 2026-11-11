// #1577 AC8: an undo sent from a view at log position P, for a default whose ask another device answered after P, is
// refused naming that answer, and the answer stands. The app reads the inbox (its reply's log_pos is P) and shows the
// ask defaulted. After P, your phone undoes that default and answers the ask green, each signed by its own device.
// Then the app's undo, made from the view at P, arrives carrying `view: P`. It must be refused naming the phone's
// answer (its option green), and the answer stands. A hub that applies the undo opens the ask again: it fails here.
import { afterAll, describe, expect, it } from 'vitest';
import { AC, cleanup, defaulted, eventsOf, inboxRow, newRequest, result, shown, signedCall, SHORT_WAIT_MS, world } from './helpers.ts';

afterAll(cleanup, 120_000);

describe(`${AC[8]} An undo from a view at P, for a default another device answered after P, is refused naming that answer`, () => {
  it(`${AC[8]} the app's undo from the view at P is refused naming the phone's answer green, made after P, and green stands`, async () => {
    const w = await world({ asks: [{ source: 'deep_ask.taste', question: 'Which header colour on the 1577 settings page?', waitMs: SHORT_WAIT_MS }] });
    const ask = w.asks[0]!;
    await defaulted(w, ask.handle);
    // What the app was shown: the inbox at P, the ask defaulted.
    const view = result(await w.app.call('inbox.read', {}, 60_000));
    const P = Number(view.log_pos);
    const row = (view.asks as { ask: string; outcome: string }[]).find((r) => r.ask === ask.handle);
    if (!Number.isSafeInteger(P) || row?.outcome !== 'defaulted') throw Error(`BLOCKED: setup: the app's view shows no defaulted ${ask.handle} at a log position: ${shown({ log_pos: view.log_pos, row })}`);

    // After P, on the phone: the default undone, and the ask answered green.
    const undone = await signedCall(w, w.phone, 'ask.undo', { ask: ask.handle, view: P, request: newRequest() });
    expect(undone.error, `${AC[8]} the phone's undo of ${ask.handle}, from the current view, with its request ID, must count: ${shown(undone)}`).toBeUndefined();
    const answered = await signedCall(w, w.phone, 'ask.answer', { ask: ask.handle, option: 'green', request: newRequest() });
    expect(answered.error, `${AC[8]} the phone's answer green, with its request ID, must count: ${shown(answered)}`).toBeUndefined();
    const opened = (await eventsOf(w, 'default.undone', ask.handle)).length;

    // The app's undo, made from the view at P.
    const stale = await signedCall(w, w.device, 'ask.undo', { ask: ask.handle, view: P, request: newRequest() });
    expect(stale.error, `${AC[8]} the app's undo from the view at log position ${P} must be refused, since the phone answered ${ask.handle} after it; it was taken: ${shown(stale)}`).toBeDefined();
    expect(JSON.stringify(stale.error), `${AC[8]} the refusal must name the answer made after ${P}, green: ${shown(stale.error)}`).toMatch(/\bgreen\b/);
    expect((await eventsOf(w, 'default.undone', ask.handle)).length, `${AC[8]} the undo must not be applied: ${ask.handle} was opened again`).toBe(opened);
    expect((await eventsOf(w, 'ask.answered', ask.handle)).map((e) => e.data.answer), `${AC[8]} the phone's answer stands`).toEqual(['green']);
    expect((await inboxRow(w, ask.handle))?.outcome, `${AC[8]} ${ask.handle} still reads answered`).toBe('answered');
  }, 600_000);
});
