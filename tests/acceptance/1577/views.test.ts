// #1577 AC8: a write names the view it was made from (README, The surface: `view`). An authority ask waits 3 minutes;
// the hub's clock steps 4 (test.clock), so it takes its default. This Mac's app reads the inbox showing the default
// at log position P. Then your phone undoes the default and approves: an answer after P. The app's undo from its view
// at P must be refused naming that answer, and the answer stands. The planted applies-stale-undo hub fails this test.
import { afterEach, describe, expect, it } from 'vitest';
import { AC, cleanup, defaulted, eventsOf, inboxRow, MINUTE, requestId, result, said, sendOnce, signedBy, tag, world } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC[8]} An undo sent from a view at log position P, for a default whose ask another device answered after P, is refused naming that answer, and the answer stands`, () => {
  it(`${AC[8]} the app's undo from its view at P, after the phone undid the default and approved, is refused at /params/view naming the approval`, async () => {
    const w = await world({ asks: [{ source: 'effect.push', question: `Push release/${tag()} to origin?`, waitMs: 3 * MINUTE }] });
    const x = w.asks[0]!;
    await defaulted(w, x.handle, 4 * MINUTE);
    // What the app was shown: the inbox, with the default, at log position P.
    const shown = result(await sendOnce(w, 'inbox.read', {}));
    const P = shown.log_pos as number;
    expect((shown.asks as { ask: string; outcome: string }[]).find((r) => r.ask === x.handle)?.outcome, `setup: the app's view at ${P} shows ${x.handle}'s default`).toBe('defaulted');
    // After P, your phone undoes the default from its own view and approves the push: an answer from another device.
    const phoneView = result(await sendOnce(w, 'inbox.read', {})).log_pos as number;
    const undone = await sendOnce(w, 'ask.undo', await signedBy(w, w.b, 'ask.undo', { ask: x.handle, view: phoneView }));
    expect(undone.error, `setup: ${w.b.name}'s undo of ${x.handle}'s default, from its view at ${phoneView}, must count: ${JSON.stringify(undone.error)}`).toBeUndefined();
    const approve = { ask: x.handle, option: 'approve', plan_hash: x.plan_hash, token: `click-${tag()}` };
    const approved = await sendOnce(w, 'ask.answer', await signedBy(w, w.b, 'ask.answer', approve));
    expect(approved.error, `setup: ${w.b.name}'s approval of ${x.handle} must count: ${JSON.stringify(approved.error)}`).toBeUndefined();
    const [answer] = await eventsOf(w, 'ask.answered', x.handle);
    expect(answer && answer.log_pos > P, `setup: the phone's answer is after the app's view at ${P}: ${said(answer ? [answer] : [])}`).toBe(true);
    // The app, still showing the default it read at P, sends its undo.
    const stale = await sendOnce(w, 'ask.undo', await signedBy(w, w.a, 'ask.undo', { ask: x.handle, view: P, request: requestId() }));
    expect(stale.result, `${w.a.name}'s undo from its view at ${P} must be refused, since ${x.handle} was answered at ${String(answer!.log_pos)} after it: the hub replied ${JSON.stringify(stale.result)}`).toBeUndefined();
    expect(stale.error?.path, `the refusal must name the view the undo was made from, at /params/view: ${JSON.stringify(stale.error)}`).toBe('/params/view');
    expect(stale.error?.actual, `the refusal must name the change, the phone's answer, by its log position ${String(answer!.log_pos)}: ${JSON.stringify(stale.error)}`).toBe(String(answer!.log_pos));
    expect(String(stale.error?.remediation), `the refusal must say what the change was: the answer approve`).toMatch(/\bapprove\b/);
    // The answer stands: the default was undone once, by the phone, the approval is the one answer, and it reads answered.
    const undos = await eventsOf(w, 'default.undone', x.handle);
    expect(undos.length, `the default must have been undone once, by the phone, never by the refused undo: ${said(undos)}`).toBe(1);
    expect((await eventsOf(w, 'ask.answered', x.handle)).map((e) => e.data.answer), 'the phone\'s answer is the one answer').toEqual(['approve']);
    expect((await inboxRow(w, x.handle))?.outcome, `${x.handle} must still read answered`).toBe('answered');
  });
});
