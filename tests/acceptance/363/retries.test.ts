// AC7: retrying an identical request ID has no second effect, the same ID with different input is refused before any
// write or cursor move, and an action's target and authority never come from the focused window, the current folder
// or the last agent selected.
//
// Calls reach the host as the hub's deep-actions makes them once its gate let them through, each with its caller's
// connection and its request ID (README, Readings: the gate). "Before any write or cursor move" is read as: nothing is
// appended to the record and the handler doesn't run (README, Readings).
import { describe, expect, it } from 'vitest';
import type { ActionCall } from '../../../packages/extension-host/src/index.ts';
import { agentCall, ALERT, alerts, call, done, enteredFor, installAndLoad, openHost, openWorld, pkg, requestId, runs, sleep, storeEventsHolding, STOCKS, ulid } from './helpers.ts';

describe('AC7 #363.4e75de68 Retrying an identical request ID has no second effect, the same ID with different input is refused before any write or cursor move, and an action\'s target and authority never come from the focused window, the current folder or the last agent selected', () => {
  it('AC7 an identical retry of a request ID has no second effect; the same ID with different input is refused before anything is written or run', async () => {
    const w = await openWorld();
    const h = await openHost(w);
    await installAndLoad(h, await pkg('stocks'));
    const caller = agentCall(ulid());
    const request = requestId();
    await done(call(h, 'ext.stocks.set_alert', { symbol: 'TSLA', above: 300 }, { caller, request }), 'set-alert TSLA at 300');
    const retry = await call(h, 'ext.stocks.set_alert', { symbol: 'TSLA', above: 300 }, { caller, request });
    expect(retry.status, `the identical retry is answered, not refused: ${JSON.stringify(retry)}`).toBe('done');
    const all = await w.events();
    expect(storeEventsHolding(all, ALERT, 'TSLA').length, 'one store item for the request, not two').toBe(1);
    expect(enteredFor(all, request).length, 'the retry entered no second call').toBe(1);
    expect((await runs(h)).set_alert, 'the handler ran once').toBe(1);

    const before = await w.last();
    const other = await call(h, 'ext.stocks.set_alert', { symbol: 'TSLA', above: 350 }, { caller, request });
    expect(other.status, `the same request ID with different input is refused: ${JSON.stringify(other)}`).toBe('refused');
    await sleep(300);
    expect(await w.last(), 'the refusal came before any write: nothing was appended to the record').toBe(before);
    expect((await runs(h)).set_alert, 'the handler didn\'t run for it').toBe(1);
    expect((await alerts(h)).TSLA, 'the store holds the first input\'s alert').toEqual({ symbol: 'TSLA', above: 300 });
  }, 120_000);

  it('AC7 a call\'s target is the one it names, never the focused window, and its authority is its own caller\'s, never the last agent\'s', async () => {
    const w = await openWorld();
    const h = await openHost(w);
    await installAndLoad(h, await pkg('stocks'));
    const A = ulid();
    const B = ulid();
    // B calls last before A: B is the last agent selected.
    const fromB = requestId();
    await done(call(h, 'ext.stocks.set_alert', { symbol: 'AMD', above: 100 }, { caller: agentCall(B), request: fromB, focus: `window:ext:${STOCKS}` }), 'B\'s set-alert AMD');
    const fromA = requestId();
    await done(call(h, 'ext.stocks.set_alert', { symbol: 'INTC', above: 30 }, { caller: agentCall(A), request: fromA, focus: 'window:ext:test/reader' }), 'A\'s set-alert INTC, another window focused');
    const all = await w.events();
    const intc = storeEventsHolding(all, ALERT, 'INTC');
    expect(intc.length, 'A\'s call wrote its alert, whatever window had focus').toBe(1);
    expect({ actor: intc[0]!.actor, session: intc[0]!.session }, 'A\'s store item is written with A\'s authority, not B\'s').toEqual({ actor: 'you', session: A });
    const entered = enteredFor(all, fromA);
    expect(entered.length).toBe(1);
    expect(entered[0]!.session, 'A\'s call is recorded as A\'s, not the last agent\'s').toBe(A);
    expect(entered[0]!.data, 'A\'s call is recorded against the plug-in it named').toMatchObject({ plugin: STOCKS, action: 'ext.stocks.set_alert' });

    // A call naming no target is refused: its target never comes from the focused window or the last call.
    const before = await w.last();
    const untargeted = { action: 'ext.stocks.set_alert', input: { symbol: 'ARM', above: 90 }, request: requestId(), caller: agentCall(A), focus: `window:ext:${STOCKS}` } as unknown as ActionCall;
    const r = await h.callAction(untargeted);
    expect(r.status, `a call with no target runs nothing: ${JSON.stringify(r)}`).toBe('refused');
    await sleep(300);
    expect(await w.last(), 'nothing was written for it').toBe(before);
    expect((await runs(h)).set_alert, 'its handler didn\'t run').toBe(2);
  }, 120_000);
});
