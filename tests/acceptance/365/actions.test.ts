// AC5: a `set-alert` call its schema refuses records no `action.entered` and reaches the agent as did not run; a
// handler that writes the alert and then throws records `action.reported` with that write in `changed`, `verified:
// unverified` and the error; and a send whose test provider never answers before the hub is stopped reads unknown after
// the restart, with no second request reaching the provider. A hub that reports the throwing call as did not run, or
// sends again, fails, naming the call.
//
// set-alert is the market plug-in's `ext.market.set_alert` (the manifest's own-name rule takes no hyphen, #363's
// reading). An agent's call reaches the host as deep-actions makes it once its gate let the call through (#363). The
// send is the brief plug-in's `ext.brief.send_digest`, called by you from a panel, under a standing rule for it.
import { describe, expect, it } from 'vitest';
import type { ActionCall, ActionResult, ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import {
  agentCall, ALERT, at, BRIEF_ID, briefPackage, carrying, clock, grantFor, installAndLoad, MAIL, marketWorld, MARKET_ID, ME, memoryStore, openHost,
  openWorld, priceProvider, provider, routedClient, sendOf, sleep, startHub, step, stopHub, waitUntil, YOU, type HostSeams,
} from './helpers.ts';
import { judgeRefusedBySchema, judgeThrew, judgeUnanswered } from './judges.ts';
import { asDidNotRun, resendsUnanswered } from './twins.ts';

const setAlert = (input: unknown, request: string): ActionCall => ({
  action: 'ext.market.set_alert', target: { handle: `ext:${MARKET_ID}`, version: '1.0.0' }, input, caller: agentCall('s-365'), request,
});

describe('AC5 #365.5e6c187d A `set-alert` call its schema refuses records no `action.entered` and reaches the agent as did not run; a handler that writes the alert and then throws records `action.reported` with that write in `changed`, `verified: unverified` and the error; and a send whose test provider never answers before the hub is stopped reads unknown after the restart, with no second request reaching the provider. A hub that reports the throwing call as did not run, or sends again, fails, naming the call', () => {
  it('AC5 a set-alert call whose input its schema refuses records no action.entered and reaches the agent as did not run', async () => {
    const { w, h } = await marketWorld(at('2026-11-03T10:00'), { watch: false, cadence: { cron: '0 0 1 1 *' } }, (c) => priceProvider(c));
    const result = await h.callAction(setAlert({ symbol: 'NVDA', above: 'two hundred' }, 'req-schema'));
    expect(judgeRefusedBySchema(result, await w.events('action.entered'), 'req-schema')).toEqual([]);
    expect(await w.events(ALERT), 'no alert was written').toEqual([]);
  }, 120_000);

  /** set-alert planted to write NVDA's alert and then throw, called by an agent through the host or a twin wrapping it. */
  async function threw(through?: (h: ExtensionHost) => (c: ActionCall) => Promise<ActionResult>) {
    const { w, h } = await marketWorld(at('2026-11-03T10:00'), { watch: false, cadence: { cron: '0 0 1 1 *' }, setAlert: 'write-then-throw' }, (c) => priceProvider(c));
    const call = through ? through(h) : (c: ActionCall) => h.callAction(c);
    const result = await call(setAlert({ symbol: 'NVDA', above: 200 }, 'req-throw'));
    const entered = (await w.events('action.entered')).filter((e) => (e.data as { request: string }).request === 'req-throw');
    expect(entered.length, 'the call was entered once, before its handler ran').toBe(1);
    const writes = await w.events(ALERT);
    expect(writes.length, 'the handler wrote NVDA\'s alert before it threw').toBe(1);
    return { result, call: (entered[0]!.data as { call: string }).call, reported: await w.events('action.reported'), wrote: [`${ALERT}:NVDA`, writes[0]!.id] };
  }

  it('AC5 a set-alert handler that writes the alert and then throws records action.reported with the write in changed, verified unverified and the error, and reaches the agent as a call that ran', async () => {
    const r = await threw();
    expect(judgeThrew(r.call, r.result, r.reported, r.wrote)).toEqual([]);
  }, 120_000);

  it('AC5 (wrong program) a hub that reports the throwing call as did not run fails, naming the call', async () => {
    const r = await threw(asDidNotRun);
    const problems = judgeThrew(r.call, r.result, r.reported, r.wrote);
    expect(problems.join('\n')).toMatch(new RegExp(`the call ${r.call}, whose handler wrote and then threw, reached the agent as .*: as did not run`));
  }, 120_000);

  /**
   * The send: you call send_digest under a standing rule for it; the provider takes the request and never answers;
   * the hub stops while it waits, and starts again on the same files.
   */
  async function unanswered(twin = false) {
    const c = clock(at('2026-11-03T10:00'));
    const mail = await provider(c, (req) => (req.url.startsWith('/send') ? 'hang' : { status: 404 }));
    const routes = { [MAIL]: mail };
    const seams: HostSeams = { secrets: memoryStore(), http: routedClient(routes).client };
    const w = await openWorld(c);
    const h = await openHost(w, seams);
    await installAndLoad(h, await briefPackage({ schedules: [], to: [ME], key: 'day' }), grantFor(MAIL));
    await h.setSendRule(YOU, { sentence: 'my digest, to me', piece: BRIEF_ID, recipients: [ME], schedule: null });
    const key = 'digest-2026-11-03';
    void h.callAction({ action: 'ext.brief.send_digest', target: { handle: `ext:${BRIEF_ID}`, version: '1.0.0' }, input: { key, to: ME }, caller: YOU, request: 'req-digest' }).catch(() => undefined);
    await waitUntil(() => carrying(mail, key).length > 0, 20_000, 'the send\'s request reaching the provider');
    const entered = (await w.events('action.entered')).find((e) => (e.data as { request: string }).request === 'req-digest');
    const call = (entered?.data as { call?: string } | undefined)?.call ?? 'req-digest';
    // The hub stops with the request unanswered; the provider never answers it.
    const stopping = stopHub(h, w);
    await sleep(2_000);
    mail.drop();
    await stopping;
    c.set(at('2026-11-03T10:01'));
    const again = await startHub(w, seams);
    if (twin) await resendsUnanswered(routes, [...mail.seen]);
    await again.h.idle();
    await step(again.h, c, at('2026-11-03T10:02'), at('2026-11-03T10:10'));
    await sleep(1_000);
    return { call, key, row: await sendOf(again.h, key), reached: carrying(mail, key).length };
  }

  it('AC5 a send whose provider never answers before the hub is stopped reads unknown after the restart, and no second request reaches the provider', async () => {
    const r = await unanswered();
    expect(judgeUnanswered(r.call, r.key, r.row, r.reached)).toEqual([]);
  }, 180_000);

  it('AC5 (wrong program) a hub that sends the unanswered send again at its next start fails, naming the call', async () => {
    const r = await unanswered(true);
    const problems = judgeUnanswered(r.call, r.key, r.row, r.reached);
    expect(problems.join('\n')).toMatch(new RegExp(`the call ${r.call}'s send ${r.key} reached the provider 2 times: it was sent again`));
  }, 180_000);
});

