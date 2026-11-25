// AC6: two calls of one change action held at once. The newer call's ask supersedes the older's, so the older call waits
// on the newer ask while that is open, and is decided by your answer to it once that is saved.
import { describe, expect, it } from 'vitest';
import { answerAndSave, applied, brief, call, entered, events, hold, lastPos, named, openWorld, pkg, raised, runs, runsOn, SET_ALERT, stateOf, TEST_MS } from './world.ts';

describe('AC6 #3390.51839cb2 Two calls of one change action, with different inputs, are held at once in one session, and the newer ask supersedes the older: while the newer ask is open, the older call retried returns held naming the newer ask and raises no ask; after your yes to the newer ask, it returns done and its input enters once, its ask decided for you by the decision saved from that yes', () => {
  it('AC6 the older call retried waits on the newer ask, raising none of its own, and after your yes to that one it is done, its ask decided for you by the decision saved from that yes', async () => {
    const w = await openWorld([await pkg('stocks')]);
    const { a } = w;
    const older = await hold(w, a, SET_ALERT, { symbol: 'NVDA', above: 200 });
    const newer = await hold(w, a, SET_ALERT, { symbol: 'INTC', above: 30 });
    const both = await events(w);
    expect(both.filter((e) => e.kind === 'ask.superseded').map((e) => ({ ask: e.subject, by: e.data?.by })), `the newer ask, of ${named(newer)}, supersedes the older, of ${named(older)}`)
      .toEqual([{ ask: older.ask, by: newer.ask }]);
    expect(raised(both, a), 'each call asked once').toEqual([older.ask, newer.ask]);

    // While the newer ask is open, the older call waits on it.
    const waits = await call(w, a, older);
    expect.soft({ isError: waits.isError, status: waits.value?.status, ask: waits.value?.ask }, `${named(older)}, retried while ${newer.ask} is open, is held by that ask, which superseded its own (${older.ask}): ${brief(waits.reply)}`)
      .toEqual({ isError: false, status: 'held', ask: newer.ask });
    const waiting = await events(w);
    expect.soft(raised(waiting, a), `${named(older)}, retried while ${newer.ask} is open, raises no ask`).toEqual([older.ask, newer.ask]);
    expect(await stateOf(w, a, newer.ask), `the retry of ${named(older)} leaves the newer ask open`).toBe('open');
    expect(waiting.filter((e) => e.kind === 'action.entered'), 'nothing ran before your yes').toEqual([]);

    // Your yes to the newer ask, saved as a decision, decides the older call too.
    const before = lastPos(waiting);
    const decision = await answerAndSave(w, newer, 'approve');
    const done = await call(w, a, older);
    expect({ isError: done.isError, status: done.value?.status }, `${named(older)}, retried after your yes to ${newer.ask}, runs by the decision ${decision} saved from it: ${brief(done.reply)}`)
      .toEqual({ isError: false, status: 'done' });
    const all = await events(w);
    expect(entered(all, older), `the input of ${named(older)} entered once`).toEqual([older.input]);
    const decided = applied(all);
    expect(decided.map((d) => d.decision), `one ask, that of ${named(older)}, was decided for you, by the decision saved from your yes to ${newer.ask}`).toEqual([decision]);
    const ask = decided[0]!.ask;
    expect([older.ask, ...raised(all, a, before)], `the ask decided for you is one of ${named(older)}'s, raised by this session`).toContain(ask);
    expect(await stateOf(w, a, ask), `the ask of ${named(older)} closed as decided for you by that decision`).toBe(`decided_for_you by ${decision}`);

    // The control: the newer call runs on your own yes, and the older call's retry runs nothing again.
    await runsOn(w, a, newer, `runs on your yes to ${newer.ask}`);
    await runsOn(w, a, older, 'called again, returns its result');
    const end = await events(w);
    expect(entered(end, newer), `the input of ${named(newer)} entered once`).toEqual([newer.input]);
    expect(entered(end, older), `the input of ${named(older)} entered once`).toEqual([older.input]);
    expect(await runs(w, a), 'the handler ran once for each call').toEqual({ set_alert: 2, send_digest: 0 });
  }, TEST_MS);
});
