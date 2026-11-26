// AC8: a change call held in one session is decided by your yes in another session of the repo, unless you overrule that
// decision before the held call runs.
//
// Two agent stand-ins work in one git repo, each with its own session, thread, hooks and MCP servers. The overrule is
// the person's, `decision.overrule` on a cli connection, which takes the decision out of force and saves no other.
import { describe, expect, it, vi } from 'vitest';
import {
  answerAndSave, applied, brief, call, entered, events, expectStaysOpen, hold, lastPos, named, openSession, openWorld, overrule, pkg, raised, runs, SET_ALERT, stateOf, TEST_MS,
  type Actor, type Held, type World,
} from './world.ts';

interface Decided { w: World; a: Actor; b: Actor; held: Held; other: Held; decision: string }
/** A change held in session A, then the same action held in session B of the same repo, and your yes to B's ask. */
async function decidedElsewhere(): Promise<Decided> {
  const w = await openWorld([await pkg('stocks')]);
  const { a } = w;
  const b = await openSession(w);
  const held = await hold(w, a, SET_ALERT, { symbol: 'NVDA', above: 200 });
  const other = await hold(w, b, SET_ALERT, { symbol: 'INTC', above: 30 });
  // Each session has its own ask, and neither closes the other: two threads.
  expect({ a: raised(await events(w), a), b: raised(await events(w), b) }, 'each session\'s call raised an ask of its own').toEqual({ a: [held.ask], b: [other.ask] });
  expect({ a: await stateOf(w, a, held.ask), b: await stateOf(w, b, other.ask) }, 'both asks are open before your yes').toEqual({ a: 'open', b: 'open' });
  const decision = await answerAndSave(w, other, 'approve');
  const closed = await vi.waitFor(async () => {
    const state = await stateOf(w, a, held.ask);
    if (state === 'open') throw Error(`${held.ask}, of ${named(held)} in session A, is still open after your yes to ${other.ask} in session B`);
    return state;
  }, { timeout: 60_000, interval: 250 });
  expect(closed, `the ask of ${named(held)} in session A closes as decided for you by the decision saved from your yes in session B`).toBe(`decided_for_you by ${decision}`);
  expect(applied(await events(w)), 'decision.applied names the decision and the ask').toContainEqual({ decision, ask: held.ask });
  expect((await events(w)).filter((e) => e.kind === 'action.entered'), 'nothing ran before a retry').toEqual([]);
  return { w, a, b, held, other, decision };
}

describe('AC8 #3390.b1f77607 A change call held in one session of a repo has its ask closed as decided for you when you answer yes to the same action\'s ask in another session of that repo, and its retry returns done; with that decision overruled before the retry, the retry writes no action.entered and is held by a new open ask', () => {
  it('AC8 the call held in session A, its ask decided for you by your yes in session B, is done on its retry and enters once', async () => {
    const { w, a, held, decision } = await decidedElsewhere();
    const o = await call(w, a, held);
    expect({ isError: o.isError, status: o.value?.status }, `${named(held)} in session A, decided for you by ${decision}, runs on its retry: ${brief(o.reply)}`).toEqual({ isError: false, status: 'done' });
    expect(entered(await events(w), held), `the input of ${named(held)} entered once`).toEqual([held.input]);
    expect(await runs(w, a), 'the handler ran once').toEqual({ set_alert: 1, send_digest: 0 });
  }, TEST_MS);

  it('AC8 with the decision overruled before the retry, the retry enters nothing and is held by a new ask, which stays open', async () => {
    const { w, a, held, decision } = await decidedElsewhere();
    await overrule(w, decision);
    const over = (await events(w)).filter((e) => e.kind === 'decision.overruled').map((e) => e.data?.decision);
    expect(over, 'the decision is overruled on the record before the retry').toEqual([decision]);

    const before = lastPos(await events(w));
    const o = await call(w, a, held);
    const all = await events(w);
    expect(entered(all, held), `${named(held)} enters nothing once ${decision}, which had decided its ask, is overruled: ${brief(o.reply)}`).toEqual([]);
    expect({ isError: o.isError, status: o.value?.status }, `${named(held)} is held once ${decision} is overruled: ${brief(o.reply)}`).toEqual({ isError: false, status: 'held' });
    const asked = raised(all, a, before);
    expect(asked, `${named(held)} asks again, once, in its own session, since ${held.ask} was decided by a decision you overruled`).toHaveLength(1);
    expect(o.value.ask, `${named(held)} is held by the new ask, not by ${held.ask}`).toBe(asked[0]);
    await expectStaysOpen(w, a, held, asked[0]!);
    expect(await runs(w, a), 'no handler ran').toEqual({ set_alert: 0, send_digest: 0 });
  }, TEST_MS);
});
