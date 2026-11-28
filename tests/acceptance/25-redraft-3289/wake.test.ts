// AC2 #25.ee0f30b0 An idle session wakes within 2 s of an answer at p95.
//
// Redraft of ../25/routes/wake.test.ts (README). Same worlds, same expected values: twenty sessions, each its own
// Claude Code, ask through deep_ask and stop; each hold ends with no answer, so each is idle with its waiter waiting.
// You answer them one at a time with `deep inbox answer`. A session wakes when Claude Code starts a turn because
// DeepBuild's waiter exited 2; its time runs from the answer command's exit to the start of that turn, which must carry
// the answer. p95 over the twenty is at most 2 s. A session that never wakes within 30 s fails whatever the load; a p95
// over 2 s on a machine loaded past its core count is INCONCLUSIVE, with the load. Twenty more sessions end their turn
// on an API error (StopFailure, no Stop) and must wake the same way (amended Oct 29, #85).
//
// What changed: every failure the criterion names is Vitest's own assertion failure (./helpers.ts); a world that
// can't be set up or run (the hub unreachable, a waiter not up within 30 s) reads BLOCKED, never a failure the
// criterion names. Each wrong-program test first runs the same world unplanted as its control, so a program that is
// itself the plant fails it there, at that assertion; it compares only an assertion failure with its expected text.

import { afterAll, describe, expect, it } from 'vitest';
import {
  API_ERROR, type Asking, type Hub, apiError, beginAsk, cleanup, idleSessions, isDeepBuild, makeHome, payload, setup, startHub, waitFor,
} from '../25/routes/helpers.ts';
import { answerEach, assertionFailureOf, blockedUnlessAsserted, judgeP95 } from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'waiter-never-wakes';
const STOP_ONLY = 'waiter-under-stop-only';
const SAMPLES = 20;

async function scenario(n: number, plant?: string): Promise<number[]> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { home } = makeHome();
  // The world the criterion starts from, idle sessions with their waiters waiting: one that can't be set up is BLOCKED.
  const sessions = await blockedUnlessAsserted((async () => {
    const hub = await startHub(home, { plant, noAskWait: true, shortHold: true });
    await setup(home, env);
    return await idleSessions(hub, home, n, env);
  })());
  return await blockedUnlessAsserted(answerEach('AC2', home, sessions, plant));
}

/**
 * `n` sessions, each of its own Claude Code, asking through deep_ask, whose turn then ends on an API error: its
 * transcript entry, then StopFailure. Gives the sessions and those Claude Code started no DeepBuild waiter for at their
 * StopFailure; for each of the others, its waiter is running before it returns.
 */
async function failedSessions(hub: Hub, home: string, n: number, env: Record<string, string>): Promise<{ sessions: Asking[]; waiterless: Set<string> }> {
  const begun = [];
  for (let i = 0; i < n; i++) begun.push(await beginAsk(hub, home, env));
  const sessions = await Promise.all(begun.map((b) => b.finish()));
  const fired = await Promise.all(sessions.map((a) => { apiError(a.s); return a.claude.hook('StopFailure', payload(a.s, 'StopFailure')); }));
  const waiterless = new Set(sessions.filter((_, i) => !fired[i]!.background.some((r) => r.asyncRewake && isDeepBuild(r.command))).map((a) => a.s.id));
  for (const a of sessions) {
    if (waiterless.has(a.s.id)) continue;
    await waitFor(async () => (await a.claude.liveWaiters(a.s.id)).length > 0 || undefined, 30_000, `the waiter Claude Code started at ${a.s.id}'s StopFailure`);
  }
  return { sessions, waiterless };
}

async function failureScenario(n: number, plant?: string): Promise<number[]> {
  const env: Record<string, string> = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { home } = makeHome();
  const { sessions, waiterless } = await blockedUnlessAsserted((async () => {
    const hub = await startHub(home, { plant });
    await setup(home, env);
    return await failedSessions(hub, home, n, env);
  })());
  const cause = waiterless.size
    ? `Claude Code started no waiter at the StopFailure of ${waiterless.size} of ${n} sessions (${[...waiterless].join(', ')}): DeepBuild's settings hold no waiter entry under StopFailure`
    : 'Claude Code started a waiter at every StopFailure';
  return await blockedUnlessAsserted(answerEach('AC2', home, sessions, plant, `each turn ended on an API error (StopFailure, error ${API_ERROR}, no Stop), and ${cause}`));
}

describe('AC2 #25.ee0f30b0 An idle session wakes within 2 s of an answer at p95', () => {
  it(`AC2 #25.ee0f30b0 ${SAMPLES} idle sessions, answered one at a time, each wake with their answer, p95 within 2 s`, async (ctx) => {
    const ms = await scenario(SAMPLES);
    expect(ms).toHaveLength(SAMPLES);
    judgeP95(ctx, 'AC2 an idle session\'s wake after your answer', ms, 2000);
  }, 900_000);

  it(`AC2 #25.ee0f30b0 (wrong program) a waiter that never wakes the session, so answers wait for the next prompt (${PLANT}), fails this test`, async () => {
    // The control: unplanted, two idle sessions each wake with their answer within 30 s.
    expect(await scenario(2), 'AC2 the control: unplanted, each of two idle sessions wakes with its answer within 30 s').toHaveLength(2);
    const failure = await assertionFailureOf(scenario(2, PLANT));
    expect(failure, `the wake check must fail on ${PLANT}`).toMatch(/AC2 idle session \S+ \(1 of 2 answered\) never woke within 30 s of its answer to ask:/);
  }, 900_000);

  it(`AC2 #25.ee0f30b0 ${SAMPLES} sessions idle after a turn that ended on an API error (StopFailure, no Stop), answered one at a time, each wake with their answer, p95 within 2 s`, async (ctx) => {
    const ms = await failureScenario(SAMPLES);
    expect(ms).toHaveLength(SAMPLES);
    judgeP95(ctx, 'AC2 a wake after your answer, for a session whose turn ended on an API error', ms, 2000);
  }, 900_000);

  it(`AC2 #25.ee0f30b0 (wrong program) a setup that writes the waiter's entry under Stop only (${STOP_ONLY}) leaves a session whose turn ended on an API error with no waiter, and fails this test, naming that cause`, async () => {
    // The control: unplanted, two sessions whose turn ended on an API error each wake with their answer within 30 s.
    expect(await failureScenario(2), 'AC2 the control: unplanted, each of two sessions idle after an API error wakes with its answer within 30 s').toHaveLength(2);
    const failure = await assertionFailureOf(failureScenario(2, STOP_ONLY));
    expect(failure, `the StopFailure wake check must fail on ${STOP_ONLY}: the session never wakes, for want of a waiter entry under StopFailure`)
      .toMatch(/AC2 idle session \S+ \(1 of 2 answered\) never woke within 30 s of its answer to ask:\S+; each turn ended on an API error .*Claude Code started no waiter at the StopFailure of 2 of 2 sessions .*DeepBuild's settings hold no waiter entry under StopFailure/);
  }, 900_000);
});
