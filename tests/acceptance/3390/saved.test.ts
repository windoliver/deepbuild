// AC1 to AC3: a saved decision runs or declines a later call of the same change action, whatever its input, and no call
// of another action of that plug-in.
//
// Your first answer is given as a person gives it, `deep inbox answer`, and is saved for the repo the session works in.
// What ran is read from the record (`action.entered`) and the plug-in's own `runs` read.
import { describe, expect, it } from 'vitest';
import {
  answerAndSave, answerOpen, applied, brief, call, callOf, deskPkg, entered, events, expectStaysOpen, hold, lastPos, named, openAsksOf, openWorld, pkg, raised, runs,
  runsOn, SET_ALERT, stateOf, TEST_MS,
} from './world.ts';

const NVDA = { symbol: 'NVDA', above: 200 };
const INTC = { symbol: 'INTC', above: 30 };

describe('AC1 #3390.69999517 In a session in a git repo, a change action\'s call is held and answered yes: a second call of that action, with another request ID and another input, returns done with its report on its first try, its one ask decided for you by the decision saved from your yes', () => {
  it('AC1 the second call returns done with its report on its first try; its one ask closes as decided for you by the decision saved from the first yes, its input enters once, and no open ask is left', async () => {
    const w = await openWorld([await pkg('stocks')]);
    const { a } = w;
    const first = await hold(w, a, SET_ALERT, NVDA);
    expect(entered(await events(w), first), `${named(first)} enters nothing before your yes`).toEqual([]);
    expect(await runs(w, a), 'no handler ran before your yes').toEqual({ set_alert: 0, send_digest: 0 });
    const decision = await answerAndSave(w, first, 'approve');
    // The control: your own yes runs the call it was given to.
    await runsOn(w, a, first, 'runs on your own yes');

    const before = lastPos(await events(w));
    const second = callOf(SET_ALERT, INTC);
    const reply = await call(w, a, second);
    expect({ isError: reply.isError, status: reply.value?.status }, `${named(second)} runs on its first try, by the decision ${decision} saved from your yes to ${first.ask}: ${brief(reply.reply)}`)
      .toEqual({ isError: false, status: 'done' });
    expect(reply.value.report, `${named(second)} returns its report: ${brief(reply.value)}`).toMatchObject({ verified: 'true' });
    expect(String(reply.value.report.checked), `the report is of ${named(second)}`).toContain('INTC');

    const all = await events(w);
    const asks = raised(all, a, before);
    expect(asks, `${named(second)} has one ask`).toHaveLength(1);
    expect(applied(all), `decision.applied names ${named(second)}'s ask and the decision saved from your yes, and nothing else was decided for you`).toEqual([{ decision, ask: asks[0] }]);
    expect(await stateOf(w, a, asks[0]!), `the ask of ${named(second)} closed as decided for you by that decision`).toBe(`decided_for_you by ${decision}`);
    expect(entered(all, second), `the input of ${named(second)} entered once`).toEqual([INTC]);
    expect(await runs(w, a), 'the handler ran once for each call').toEqual({ set_alert: 2, send_digest: 0 });
    expect(await openAsksOf(w, a), 'no open ask is left').toEqual([]);
  }, TEST_MS);
});

describe('AC2 #3390.a14577e2 The same, answered no: a second call of that action returns declined with its ask, decided for you by the decision saved from your no, and writes no action.entered', () => {
  it('AC2 the second call returns declined with its ask, which closed as decided for you by the decision saved from the first no, and nothing enters', async () => {
    const w = await openWorld([await pkg('stocks')]);
    const { a } = w;
    const first = await hold(w, a, SET_ALERT, NVDA);
    const decision = await answerAndSave(w, first, 'decline');
    // The control: your own no declines the call it was given to.
    const own = await call(w, a, first);
    expect({ isError: own.isError, status: own.value?.status, ask: own.value?.ask }, `${named(first)} is declined by your own no: ${brief(own.reply)}`).toEqual({ isError: false, status: 'declined', ask: first.ask });

    const before = lastPos(await events(w));
    const second = callOf(SET_ALERT, INTC);
    const reply = await call(w, a, second);
    expect({ isError: reply.isError, status: reply.value?.status }, `${named(second)} is declined, by the decision ${decision} saved from your no to ${first.ask}: ${brief(reply.reply)}`)
      .toEqual({ isError: false, status: 'declined' });
    const all = await events(w);
    const asks = raised(all, a, before);
    expect(asks, `${named(second)} has one ask`).toHaveLength(1);
    expect(reply.value.ask, `${named(second)} is declined with its ask`).toBe(asks[0]);
    expect(applied(all), `decision.applied names ${named(second)}'s ask and the decision saved from your no, and nothing else was decided for you`).toEqual([{ decision, ask: asks[0] }]);
    expect(await stateOf(w, a, asks[0]!), `the ask of ${named(second)} closed as decided for you by that decision`).toBe(`decided_for_you by ${decision}`);
    expect(entered(all, second), `${named(second)} enters nothing`).toEqual([]);
    expect(all.filter((e) => e.kind === 'action.entered'), 'a no, yours or saved, runs nothing').toEqual([]);
    expect(await runs(w, a), 'no handler ran').toEqual({ set_alert: 0, send_digest: 0 });
  }, TEST_MS);
});

describe('AC3 #3390.0ff85ad5 After your yes to one change action of a plug-in, the first call of another change action of that plug-in is held by an ask that stays open, nothing runs, and it runs on your yes to that ask', () => {
  it('AC3 another change action of the plug-in, given the same input, is held by an ask no saved decision closes, and runs once on your yes to it', async () => {
    const w = await openWorld([await deskPkg()]);
    const { a } = w;
    const pin = { symbol: 'NVDA', note: 'watch the earnings call' };
    const first = await hold(w, a, 'ext.desk.pin_symbol', pin);
    await answerAndSave(w, first, 'approve');
    // The control: the yes runs the action it was given to.
    await runsOn(w, a, first, 'runs on your own yes');

    // The other change action of that plug-in, its input the very same: only the action differs.
    const other = await hold(w, a, 'ext.desk.retire_symbol', pin);
    await expectStaysOpen(w, a, other, other.ask, 'desk');
    expect(other.ask, `${named(other)} has an ask of its own`).not.toBe(first.ask);
    expect(entered(await events(w), other), `${named(other)} enters nothing on your yes to ext.desk.pin_symbol`).toEqual([]);
    expect(await runs(w, a, 'desk'), 'ext.desk.retire_symbol ran nothing on your yes to ext.desk.pin_symbol').toEqual({ pin_symbol: 1, retire_symbol: 0 });

    await answerOpen(w, a, other.ask, 'approve', `your yes to ${named(other)}`);
    await runsOn(w, a, other, 'runs on your yes to its own ask');
    expect(entered(await events(w), other), `the input of ${named(other)} entered once`).toEqual([pin]);
    expect(await runs(w, a, 'desk'), 'each action ran once').toEqual({ pin_symbol: 1, retire_symbol: 1 });
  }, TEST_MS);
});
