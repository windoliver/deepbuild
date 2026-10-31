// AC1: a plug-in action whose schema uses a keyword one model API rejects is left out at install with the reason, and
// every session still lists deep_ask and deep_claim.
// AC5: a declared action reaches agents through deep-actions, typed from its schema: a read runs, a change without a
// standing rule raises an ask, and a send always asks; the deep server lists only the core tools.
//
// The reason is read from the host (`actions()`); what an agent sees is read through a real hub, the plug-ins installed
// with `deep install`, and an agent stand-in's own two servers, `deep` and `deep-actions` (README, The surface under test).
import { describe, expect, it } from 'vitest';
import { hubWorld, type HubWorld, type Line, type Outcome } from './hub.ts';
import { ALERT, installAndLoad, openHost, openWorld, pkg, requestId, sleep } from './helpers.ts';

const names = (tools: { name: string }[]): string[] => tools.map((t) => t.name).sort();
const valueOf = (o: Outcome, what: string): any => {
  expect(o.isError, `${what} must succeed: ${JSON.stringify(o.reply).slice(0, 1500)}`).toBe(false);
  return o.value;
};
const find = async (w: HubWorld): Promise<Line[]> => {
  const value = valueOf(await w.agent.callTool('deep-actions', 'find_actions', { query: null }), 'find_actions with no query');
  expect(Array.isArray(value?.actions), `find_actions returns { actions: [...] }: ${JSON.stringify(value)}`).toBe(true);
  return value.actions as Line[];
};
const callAction = (w: HubWorld, action: string, input: unknown, timeoutMs?: number): Promise<Outcome> =>
  w.agent.callTool('deep-actions', 'call_action', { action, request: requestId(), input: JSON.stringify(input) }, timeoutMs);
/** The design's core tools, which every session lists (README, Readings: the core tools). */
const CORE = ['deep_ask', 'deep_claim'];

describe('AC1 #363.126cded2 A plug-in action whose schema uses a keyword one model API rejects is left out at install with the reason, and every session still lists `deep_ask` and `deep_claim`', () => {
  it('AC1 at install, the actions whose input schemas use minimum and oneOf are left out, each with a reason naming its keyword; the plug-in loads and its other action is exposed', async () => {
    const w = await openWorld();
    const h = await openHost(w);
    await installAndLoad(h, await pkg('picky'));
    const listed = await h.actions();
    const of = (action: string) => listed.find((l) => l.action === action);
    expect(of('ext.picky.ok'), `the action whose schema every model API takes is exposed: ${JSON.stringify(listed)}`)
      .toMatchObject({ action: 'ext.picky.ok', extension: 'test/picky', declares: 'read', exposed: true });
    for (const [action, keyword] of [['ext.picky.min', 'minimum'], ['ext.picky.union', 'oneOf']] as const) {
      const entry = of(action);
      expect(entry?.exposed, `${action}, whose input schema uses ${keyword}, is left out: ${JSON.stringify(entry)}`).toBe(false);
      expect(entry?.reason ?? '', `${action}'s reason names the keyword ${keyword}`).toContain(keyword);
    }
  }, 120_000);

  it('AC1 a session lists deep_ask and deep_claim from deep, while deep-actions finds the plug-in\'s good action and neither left-out one, and calls neither', async () => {
    const w = await hubWorld([await pkg('picky')]);
    await w.agent.initialize('deep');
    expect(names(await w.agent.tools('deep')), 'the deep server lists the core tools').toEqual(expect.arrayContaining(CORE));
    await w.agent.initialize('deep-actions');
    expect(names(await w.agent.tools('deep-actions')), 'deep-actions has one tool that finds actions and one that calls them').toEqual(['call_action', 'find_actions']);
    const found = (await find(w)).map((a) => a.action);
    expect(found, 'the action whose schema every model API takes is found').toContain('ext.picky.ok');
    expect(found, 'the actions left out at install are never found').not.toContain('ext.picky.min');
    expect(found).not.toContain('ext.picky.union');
    const min = await callAction(w, 'ext.picky.min', { count: 1 }, 30_000);
    expect(min.isError, `a left-out action can't be called: ${JSON.stringify(min.reply).slice(0, 800)}`).toBe(true);
    // The deep server still lists the core tools after deep-actions served its plug-in.
    expect(names(await w.agent.tools('deep'))).toEqual(expect.arrayContaining(CORE));
  }, 240_000);
});

describe('AC5 #363.f25b4886 A declared action reaches agents through `deep-actions`, typed from its schema: a read runs, a change without a standing rule raises an ask, and a send always asks; the `deep` server lists only the core tools', () => {
  it('AC5 deep-actions finds each stocks action typed from its schema; a read runs; input its schema refuses is an error; a change raises an ask and a send raises an ask, neither handler running', async () => {
    const w = await hubWorld([await pkg('stocks')]);
    await w.agent.initialize('deep-actions');
    const found = await find(w);
    const of = (action: string) => found.find((a) => a.action === action);
    expect(of('ext.stocks.set_alert'), `set-alert is found, typed from its declared input schema: ${JSON.stringify(found)}`).toMatchObject({
      action: 'ext.stocks.set_alert', extension: 'test/stocks', declares: 'change',
      input: { type: 'object', properties: { symbol: { type: 'string' }, above: { type: 'number' } }, required: ['symbol', 'above'], additionalProperties: false },
    });
    expect(of('ext.stocks.list_alerts')).toMatchObject({ declares: 'read', input: { type: 'object', properties: {} } });
    expect(of('ext.stocks.send_digest')).toMatchObject({ declares: 'send', input: { type: 'object', properties: { to: { type: 'string' } } } });

    // A read runs, with no ask.
    const read = valueOf(await callAction(w, 'ext.stocks.list_alerts', {}), 'list-alerts, a read');
    expect(Array.isArray(read?.output?.alerts), `a read's result carries its output: ${JSON.stringify(read)}`).toBe(true);

    // Typed from its schema: input it refuses is an error, before any ask.
    const typed = await callAction(w, 'ext.stocks.set_alert', { symbol: 'NVDA', above: 'two hundred' }, 30_000);
    expect(typed.protocolError, 'an error is a tool result').toBe(false);
    expect(typed.isError, `set-alert with above as text is refused: ${JSON.stringify(typed.reply).slice(0, 800)}`).toBe(true);

    const asksAfter = async (from: number): Promise<Line[]> => (await w.events()).filter((e) => e.kind === 'ask.created' && e.session === w.session.id && e.log_pos > from);
    const lastPos = async (): Promise<number> => { const all = await w.events(); return all.length ? all[all.length - 1]!.log_pos : 0; };
    const waitAsk = async (from: number, what: string): Promise<void> => {
      const deadline = Date.now() + 20_000;
      while (!(await asksAfter(from)).length) {
        if (Date.now() > deadline) expect.fail(`${what} raised no ask under the agent's session within 20 s`);
        await sleep(200);
      }
    };

    // A change without a standing rule raises an ask, and its handler doesn't run while the ask is open.
    let from = await lastPos();
    const change = callAction(w, 'ext.stocks.set_alert', { symbol: 'NVDA', above: 200 }).catch((e: unknown) => e);
    await waitAsk(from, 'set-alert, a change, with no standing rule');
    // A send always asks.
    from = await lastPos();
    const send = callAction(w, 'ext.stocks.send_digest', { to: 'you@example.invalid' }).catch((e: unknown) => e);
    await waitAsk(from, 'send-digest, a send');
    await sleep(1000);
    expect((await w.events()).filter((e) => e.kind === ALERT), 'the change wrote nothing while its ask is open').toEqual([]);
    const ran = valueOf(await callAction(w, 'ext.stocks.runs', {}), 'runs, a read');
    expect(ran?.output, 'neither the change\'s nor the send\'s handler ran while its ask is open').toEqual({ set_alert: 0, send_digest: 0 });
    void change;
    void send;
  }, 240_000);

  it('AC5 the deep server lists only the core tools: the same list as a hub with no plug-in, with no action, plug-in or deep-actions tool in it', async () => {
    const bare = await hubWorld([]);
    await bare.agent.initialize('deep');
    const core = names(await bare.agent.tools('deep'));
    const w = await hubWorld([await pkg('stocks'), await pkg('picky')]);
    await w.agent.initialize('deep');
    const listed = names(await w.agent.tools('deep'));
    expect(listed, 'the deep server lists the same tools with plug-ins installed as with none').toEqual(core);
    expect(listed).toEqual(expect.arrayContaining(CORE));
    for (const name of listed) {
      expect(name, 'each tool deep lists is a core deep_* tool').toMatch(/^deep_[a-z_]+$/);
      expect(['find_actions', 'call_action'], 'deep-actions\' tools are deep-actions\' alone').not.toContain(name);
      expect(name, 'no plug-in action is a deep tool').not.toMatch(/stocks|picky|alert/);
    }
    // And deep-actions answers beside it: the plug-ins' actions are there, not in deep.
    await w.agent.initialize('deep-actions');
    expect((await find(w)).map((a) => a.action)).toEqual(expect.arrayContaining(['ext.stocks.set_alert', 'ext.picky.ok']));
  }, 240_000);
});
