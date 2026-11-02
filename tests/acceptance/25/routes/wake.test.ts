// AC2 #25.ee0f30b0 An idle session wakes within 2 s of an answer at p95.
//
// Twenty sessions, each its own Claude Code, ask through deep_ask and stop; each hold ends with no answer, so each
// session is idle with its waiter waiting. You answer them one at a time with `deep inbox answer`. A session wakes
// when Claude Code starts a turn because DeepBuild's waiter exited 2 (#80: a UserPromptSubmit whose prompt is a
// task-notification carrying the waiter's stderr); its time is from the answer command's exit to the start of that
// turn, and the turn must carry the answer. p95 over the twenty samples is at most 2 s. A session that never wakes
// within 30 s fails whatever the load; a p95 over 2 s on a machine loaded past its core count is INCONCLUSIVE, with
// the load reading (README: Timing).
//
// Amended Oct 29 (#85): a turn that ends on an API error fires StopFailure and no Stop, so setup writes the waiter's
// entry under StopFailure too, with the same command and timeout, and Claude Code starts it there. A session left that
// way is idle as well, and its answer must wake it the same way. Twenty more sessions each ask through deep_ask, and
// their turn then ends on an API error: Claude Code writes the error's entry into the transcript and fires StopFailure
// with its error type. Nothing holds that stop (Claude Code reads nothing from a StopFailure entry's output), so the
// session's only way back in is the waiter Claude Code started at the StopFailure. The error is `invalid_request`
// (helpers' API_ERROR), a cause the design gives no automatic continue and no unblock task, so no other wake of the
// session can come before your answer's. You answer them one at a time; each must wake with a turn carrying its
// answer, timed and judged as above. A setup that writes the waiter under Stop only (the plant
// `waiter-under-stop-only`; the merge base) leaves these sessions with no waiter: the first never wakes, and the
// failure names that cause.

import { afterAll, describe, expect, it } from 'vitest';
import {
  API_ERROR, type Asking, type Hub, answerEach, apiError, beginAsk, cleanup, idleSessions, isDeepBuild, judgeP95, makeHome, payload, setup, startHub, waitFor,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'waiter-never-wakes';
const STOP_ONLY = 'waiter-under-stop-only';
const SAMPLES = 20;

async function scenario(n: number, plant?: string): Promise<number[]> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { home } = makeHome();
  const hub = await startHub(home, { plant, noAskWait: true, shortHold: true });
  await setup(home, env);
  const sessions = await idleSessions(hub, home, n, env);
  return await answerEach('AC2', home, sessions, plant);
}

/**
 * `n` sessions, each of its own Claude Code, asking through deep_ask (begun one at a time, finished together, as
 * idleSessions does), whose turn then ends on an API error: its transcript entry, then StopFailure. Gives the sessions
 * and those Claude Code started no DeepBuild waiter for at their StopFailure; for each of the others, its waiter is
 * running before it returns.
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
  const hub = await startHub(home, { plant });
  await setup(home, env);
  const { sessions, waiterless } = await failedSessions(hub, home, n, env);
  try {
    return await answerEach('AC2', home, sessions, plant);
  } catch (error) {
    const cause = waiterless.size
      ? `Claude Code started no waiter at the StopFailure of ${waiterless.size} of ${n} sessions (${[...waiterless].join(', ')}): DeepBuild's settings hold no waiter entry under StopFailure`
      : 'Claude Code started a waiter at every StopFailure';
    throw Error(`${(error as Error).message}; each turn ended on an API error (StopFailure, error ${API_ERROR}, no Stop), and ${cause}`);
  }
}

describe('AC2 #25.ee0f30b0 An idle session wakes within 2 s of an answer at p95', () => {
  it(`AC2 #25.ee0f30b0 ${SAMPLES} idle sessions, answered one at a time, each wake with their answer, p95 within 2 s`, async (ctx) => {
    const ms = await scenario(SAMPLES);
    expect(ms).toHaveLength(SAMPLES);
    judgeP95(ctx, 'AC2 an idle session\'s wake after your answer', ms, 2000);
  }, 900_000);

  it(`AC2 #25.ee0f30b0 (wrong program) a waiter that never wakes the session, so answers wait for the next prompt (${PLANT}), fails this test`, async () => {
    let failure = '';
    try { await scenario(2, PLANT); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the wake check must fail on ${PLANT}`).toMatch(/AC2 idle session \S+ \(1 of 2 answered\) never woke within 30 s of its answer to ask:/);
  }, 900_000);

  it(`AC2 #25.ee0f30b0 ${SAMPLES} sessions idle after a turn that ended on an API error (StopFailure, no Stop), answered one at a time, each wake with their answer, p95 within 2 s`, async (ctx) => {
    const ms = await failureScenario(SAMPLES);
    expect(ms).toHaveLength(SAMPLES);
    judgeP95(ctx, 'AC2 a wake after your answer, for a session whose turn ended on an API error', ms, 2000);
  }, 900_000);

  it(`AC2 #25.ee0f30b0 (wrong program) a setup that writes the waiter's entry under Stop only (${STOP_ONLY}) leaves a session whose turn ended on an API error with no waiter, and fails this test, naming that cause`, async () => {
    let failure = '';
    try { await failureScenario(2, STOP_ONLY); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the StopFailure wake check must fail on ${STOP_ONLY}: the session never wakes, for want of a waiter entry under StopFailure`)
      .toMatch(/AC2 idle session \S+ \(1 of 2 answered\) never woke within 30 s of its answer to ask:\S+; each turn ended on an API error .*Claude Code started no waiter at the StopFailure of 2 of 2 sessions .*DeepBuild's settings hold no waiter entry under StopFailure/);
  }, 900_000);
});
