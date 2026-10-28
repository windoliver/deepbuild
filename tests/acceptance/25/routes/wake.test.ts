// AC2 #25.ee0f30b0 An idle session wakes within 2 s of an answer at p95.
//
// Twenty sessions, each its own Claude Code, ask through deep_ask and stop; each hold ends with no answer, so each
// session is idle with its waiter waiting. You answer them one at a time with `deep inbox answer`. A session wakes
// when Claude Code starts a turn because DeepBuild's waiter exited 2 (#80: a UserPromptSubmit whose prompt is a
// task-notification carrying the waiter's stderr); its time is from the answer command's exit to the start of that
// turn, and the turn must carry the answer. p95 over the twenty samples is at most 2 s. A session that never wakes
// within 30 s fails whatever the load; a p95 over 2 s on a machine loaded past its core count is INCONCLUSIVE, with
// the load reading (README: Timing).

import { afterAll, describe, expect, it } from 'vitest';
import { answerEach, cleanup, idleSessions, judgeP95, makeHome, setup, startHub } from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'waiter-never-wakes';
const SAMPLES = 20;

async function scenario(n: number, plant?: string): Promise<number[]> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { home } = makeHome();
  const hub = await startHub(home, { plant });
  await setup(home, env);
  const sessions = await idleSessions(hub, home, n, env);
  return await answerEach('AC2', home, sessions, plant);
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
});
