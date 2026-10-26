// AC2: a test adapter with steer set to false gets answers through its stop hold or its next prompt, never in the
// middle of a turn.
//
// The route is chosen from the adapter's flags (README, Readings: routes): `steer` lets an answer into a running
// turn; without it, an answer that arrives mid-turn waits, and goes through the stop hold when the adapter can
// hold a stop (`holdStop`), else at the session's next prompt. The host asks the owning adapter to deliver by that
// route; the test adapter writes each call it gets. The first adapter is registered under the name of an agent
// whose shipped adapter can steer, so a host that routed by name would steer it.
import { describe, expect, it } from 'vitest';
import { adapterPackage, answerFor, hooks } from './adapting.ts';
import { loadInHub, openWorld, sessionId, sleep, until } from './helpers.ts';

describe('AC2 #349.009ae072 a test adapter with steer false gets answers through its stop hold or its next prompt, never in the middle of a turn', () => {
  it('AC2 steer false, holdStop true: an answer that arrives mid-turn waits, and is delivered once in the stop hold, by the route `hold`', async () => {
    const w = await openWorld();
    const a = await adapterPackage('claude-code', { steer: false, holdStop: true });
    const h = await loadInHub(w, a.dir);
    const s = sessionId();
    await hooks(h, a.name, s, 'SessionStart', 'UserPromptSubmit', 'PreToolUse');
    const answer = await answerFor(w, s);
    const out = await h.deliverAnswer(answer);
    expect(out.status, `mid-turn, the answer waits: ${JSON.stringify(out)}`).toBe('held');
    await sleep(300);
    expect(a.saw(), 'nothing is delivered in the middle of a turn').toEqual([]);
    await hooks(h, a.name, s, 'PostToolUse', 'Stop');
    expect(await until(() => a.saw().length >= 1), 'the stop hold delivers the waiting answer').toBe(true);
    expect(a.saw().map((x) => ({ route: x.route, ask: x.answer.ask, session: x.session })), 'once, in the stop hold').toEqual([{ route: 'hold', ask: answer.ask, session: s }]);
  }, 120_000);

  it('AC2 steer false, holdStop false: an answer that arrives mid-turn waits through the stop, and is delivered once at the next prompt, by the route `prompt`', async () => {
    const w = await openWorld();
    const a = await adapterPackage('waiter', { steer: false, holdStop: false });
    const h = await loadInHub(w, a.dir);
    const s = sessionId();
    await hooks(h, a.name, s, 'SessionStart', 'UserPromptSubmit', 'PreToolUse');
    const answer = await answerFor(w, s);
    expect((await h.deliverAnswer(answer)).status).toBe('held');
    await hooks(h, a.name, s, 'PostToolUse', 'Stop');
    await sleep(300);
    expect(a.saw(), 'an adapter that can\'t hold a stop gets nothing at the stop').toEqual([]);
    await hooks(h, a.name, s, 'UserPromptSubmit');
    expect(await until(() => a.saw().length >= 1), 'the next prompt delivers the waiting answer').toBe(true);
    expect(a.saw().map((x) => ({ route: x.route, ask: x.answer.ask })), 'once, at the next prompt').toEqual([{ route: 'prompt', ask: answer.ask }]);
  }, 120_000);

  it('AC2 steer true: the same answer is delivered in the middle of the turn, by the route `steer`, so the flag and not the name decides', async () => {
    const w = await openWorld();
    const a = await adapterPackage('steerer', { steer: true, holdStop: true });
    const h = await loadInHub(w, a.dir);
    const s = sessionId();
    await hooks(h, a.name, s, 'SessionStart', 'UserPromptSubmit', 'PreToolUse');
    const answer = await answerFor(w, s);
    const out = await h.deliverAnswer(answer);
    expect(out, JSON.stringify(out)).toMatchObject({ status: 'delivered', adapter: 'steerer', route: 'steer', session: s });
    expect(a.saw().map((x) => ({ route: x.route, ask: x.answer.ask })), 'delivered once, mid-turn').toEqual([{ route: 'steer', ask: answer.ask }]);
  }, 120_000);
});
