// AC8: what changed comes from the record: an agent's call to a test stocks plug-in's set-alert for NVDA at 200 while
// that alert exists records one action.entered and then one action.reported with changed: []. A planted handler that
// writes nothing but reports the alert as changed still gets changed: [], and handlers that return no report, a
// string, or verified: "yes" each get verified: unverified; a hub that copies the report into changed or keeps a
// malformed verified fails this test, naming the call.
//
// The agent's call reaches the host as deep-actions makes it once the hub's gate let the change through (README,
// Readings: the gate). The judge (judges.ts) reads the record alone.
import { describe, expect, it } from 'vitest';
import type { ExtensionHost, Plant } from '../../../packages/extension-host/src/index.ts';
import { judgeCall } from './judges.ts';
import { agentCall, ALERT, call, done, enteredFor, installAndLoad, openHost, openWorld, pkg, reportedFor, requestId, STOCKS, storeEventsHolding, ulid, type World } from './helpers.ts';

const SET_ALERT = 'ext.stocks.set_alert';
async function stocksWorld(handler?: string, plant?: Plant): Promise<{ w: World; h: ExtensionHost; session: string }> {
  const w = await openWorld();
  const h = await openHost(w, plant ? { plant } : {});
  await installAndLoad(h, await pkg('stocks', handler ? { probe: { plant: handler } } : {}));
  return { w, h, session: ulid() };
}
/** An agent's set-alert call with its own request ID; resolves with the request ID once the call is done. */
async function setAlert(h: ExtensionHost, session: string, symbol: string, above: number): Promise<string> {
  const request = requestId();
  await done(call(h, SET_ALERT, { symbol, above }, { caller: agentCall(session), request }), `the agent's set-alert ${symbol} at ${above}`);
  return request;
}
/** The same call on a planted twin, whatever it answers: the judge reads the record. */
async function setAlertOnTwin(h: ExtensionHost, session: string, symbol: string, above: number): Promise<string> {
  const request = requestId();
  await call(h, SET_ALERT, { symbol, above }, { caller: agentCall(session), request }).catch(() => undefined);
  return request;
}

describe('AC8 #363.33062d5b What changed comes from the record: an agent\'s call to a test stocks plug-in\'s `set-alert` for NVDA at 200 while that alert exists records one `action.entered` and then one `action.reported` with `changed: []`. A planted handler that writes nothing but reports the alert as changed still gets `changed: []`, and handlers that return no report, a string, or `verified: "yes"` each get `verified: unverified`; a hub that copies the report into `changed` or keeps a malformed `verified` fails this test, naming the call', () => {
  it('AC8 set-alert NVDA at 200 while the alert exists records one action.entered, then one action.reported with changed: []; the call that made it names the one item', async () => {
    const { w, h, session } = await stocksWorld();
    const made = await setAlert(h, session, 'NVDA', 200);
    const again = await setAlert(h, session, 'NVDA', 200);
    const all = await w.events();

    // The control: the first call wrote the alert, between its action.entered and its action.reported.
    const items = storeEventsHolding(all, ALERT, 'NVDA');
    expect(items.length, 'the first call wrote one store item, the second none').toBe(1);
    expect(judgeCall(all, made, { changed: { item: 'NVDA', event: items[0]!.id } })).toEqual([]);
    const entered = enteredFor(all, made)[0]!;
    const reported = reportedFor(all, String((entered.data as { call: unknown }).call))[0]!;
    expect(entered.log_pos < items[0]!.log_pos && items[0]!.log_pos < reported.log_pos, 'action.entered is recorded before the handler writes, action.reported after').toBe(true);

    expect(judgeCall(all, again, { changed: 'none' })).toEqual([]);
    const second = enteredFor(all, again)[0]!;
    expect(second.data, 'action.entered names the plug-in, the action, the request and the input').toMatchObject({ plugin: STOCKS, action: SET_ALERT, request: again, input: { symbol: 'NVDA', above: 200 } });
    expect(second.writer, 'only the core appends action.entered').toBe('core');
  }, 120_000);

  it('AC8 a planted handler that writes nothing but reports the alert as changed still gets changed: []', async () => {
    const { w, h, session } = await stocksWorld('claims-changed');
    const request = await setAlert(h, session, 'NVDA', 200);
    const all = await w.events();
    expect(storeEventsHolding(all, ALERT, 'NVDA'), 'the planted handler wrote nothing').toEqual([]);
    expect(judgeCall(all, request, { changed: 'none' })).toEqual([]);
  }, 120_000);

  for (const handler of ['no-report', 'string-report', 'yes-report']) {
    it(`AC8 a handler that returns ${handler === 'no-report' ? 'no report' : handler === 'string-report' ? 'a string for its report' : 'verified: "yes"'} gets verified: unverified, and changed from the record`, async () => {
      const { w, h, session } = await stocksWorld(handler);
      const request = await setAlert(h, session, 'AAPL', 150);
      const all = await w.events();
      const items = storeEventsHolding(all, ALERT, 'AAPL');
      expect(items.length, 'the handler wrote its alert').toBe(1);
      expect(judgeCall(all, request, { changed: { item: 'AAPL', event: items[0]!.id }, verified: 'unverified' })).toEqual([]);
    }, 120_000);
  }

  it('AC8 (wrong program) a hub that copies the report into changed fails this test, naming the call', async () => {
    const { w, h, session } = await stocksWorld('claims-changed', 'copies-report-changed');
    const request = await setAlertOnTwin(h, session, 'NVDA', 200);
    const problems = judgeCall(await w.events(), request, { changed: 'none' });
    expect(problems.some((p) => p.includes(request) && p.includes('says changed')), `the twin fails, naming the call: ${JSON.stringify(problems)}`).toBe(true);
  }, 120_000);

  it('AC8 (wrong program) a hub that keeps a malformed verified fails this test, naming the call', async () => {
    const { w, h, session } = await stocksWorld('yes-report', 'keeps-malformed-verified');
    const request = await setAlertOnTwin(h, session, 'AAPL', 150);
    const all = await w.events();
    const items = storeEventsHolding(all, ALERT, 'AAPL');
    const problems = judgeCall(all, request, { changed: { item: 'AAPL', event: items[0]?.id ?? '-' }, verified: 'unverified' });
    expect(problems.length, 'the twin fails the criterion').toBeGreaterThan(0);
    expect(problems.every((p) => p.includes(request)), `each failure names the call: ${JSON.stringify(problems)}`).toBe(true);
  }, 120_000);
});
