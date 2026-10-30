// AC6 #25.6367a6a9 An answer given 20 minutes after a stop wakes the idle Claude Code session within 2 s at p95, and
// the waiter entry setup wrote carries a timeout at least as long as the longest ask deadline in your settings.
//
// Your settings (~/.deepbuild/config.json's asks block, #318) give every kind of ask at most 30 minutes, so an answer
// 20 minutes on is inside its ask's deadline. Twenty sessions ask through deep_ask and stop; each hold ends with no
// answer and each session is idle with its waiter waiting. Then 20 minutes pass (README: Time): Claude Code's timer
// for its background entries moves on 20 minutes (the stand-in's expire(1200) stops each one whose timeout is at
// most 1200 s, as Claude Code would), and the hub is started again with its test clock 20 minutes on (#16). You
// answer each in turn; each session wakes with its answer, p95 within 2 s, judged as in AC2. Setup's waiter entry
// carries a timeout of at least 30 minutes, and Claude Code ran each waiter with it; with a 2-hour deadline in your
// settings, setup again gives it at least 2 hours.
//
// Amended Oct 29 (#85): setup writes the waiter's entry under Stop and under StopFailure, with the same command and
// timeout, and the design's waiter guardrail holds for each of them. So both entries are read and each must carry the
// timeout; a setup that writes the waiter under Stop only (the merge base; the plant `waiter-under-stop-only`) fails
// here, naming that cause.

import { afterAll, describe, expect, it } from 'vitest';
import {
  MINUTE, answerEach, cleanup, editConfig, idleSessions, judgeP95, makeHome, readSettings, setup, startHub, stopHub, waiterEntries,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'waiter-gives-up-at-600s';
const STOP_ONLY = 'waiter-under-stop-only';
const SAMPLES = 20;
const deadlines = (longest: string) => ({ taste: longest, authority: '10m', unblock: '15m', exception: '15m', choice: longest, definition: '4m' });

async function scenario(n: number, plant?: string): Promise<number[]> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { home } = makeHome();
  editConfig(home, (config) => { config.asks = { ...(config.asks ?? {}), deadline: deadlines('30m') }; });
  let hub = await startHub(home, { plant });
  await setup(home, env);
  const written = waiterEntries(readSettings(home));
  for (const { event, hook: entry } of [written.stop, written.failure]) {
    expect(entry.timeout, `AC6 the waiter entry setup wrote under ${event} carries a timeout at least as long as your longest ask deadline, 30 minutes: ${JSON.stringify(entry)}`).toBeGreaterThanOrEqual(30 * 60);
  }

  const sessions = await idleSessions(hub, home, n, env);
  for (const a of sessions) {
    const [waiter] = await a.claude.liveWaiters(a.s.id);
    expect(waiter!.timeout, `Claude Code runs ${a.s.id}'s waiter with the entry's timeout`).toBeGreaterThanOrEqual(30 * 60);
  }

  // 20 minutes pass.
  for (const a of sessions) await a.claude.expire(20 * 60);
  await stopHub(hub);
  hub = await startHub(home, { plant, clock: Date.now() + 20 * MINUTE });
  const ms = await answerEach('AC6', home, sessions, plant);

  // A longer deadline in your settings: setup again gives the waiter at least as long.
  editConfig(home, (config) => { config.asks = { ...(config.asks ?? {}), deadline: deadlines('2h') }; });
  await setup(home, env);
  const again = waiterEntries(readSettings(home));
  for (const { event, hook: longer } of [again.stop, again.failure]) {
    expect(longer.timeout, `AC6 with a 2-hour deadline in your settings, setup's waiter entry under ${event} carries at least 2 hours: ${JSON.stringify(longer)}`).toBeGreaterThanOrEqual(2 * 3600);
  }
  return ms;
}

describe('AC6 #25.6367a6a9 An answer given 20 minutes after a stop wakes the idle Claude Code session within 2 s at p95, and the waiter entry setup wrote carries a timeout at least as long as the longest ask deadline in your settings', () => {
  it(`AC6 #25.6367a6a9 ${SAMPLES} idle sessions answered 20 minutes after their stops each wake with their answer, p95 within 2 s; setup's waiter timeout covers your longest deadline`, async (ctx) => {
    const ms = await scenario(SAMPLES);
    expect(ms).toHaveLength(SAMPLES);
    judgeP95(ctx, 'AC6 an idle session\'s wake after an answer given 20 minutes after its stop', ms, 2000);
  }, 1_200_000);

  it(`AC6 #25.6367a6a9 (wrong program) a waiter that gives up 600 s after its stop, Claude Code's default (${PLANT}), fails this test`, async () => {
    let failure = '';
    try { await scenario(2, PLANT); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the 20-minute wake check must fail on ${PLANT}`).toMatch(/AC6 idle session \S+ \(1 of 2 answered\) never woke within 30 s of its answer to ask:/);
  }, 900_000);

  it(`AC6 #25.6367a6a9 (wrong program) a setup that writes the waiter's entry under Stop only (${STOP_ONLY}) fails this test, naming that cause`, async () => {
    let failure = '';
    try { await scenario(2, STOP_ONLY); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the waiter entry check must fail on ${STOP_ONLY}, naming the missing StopFailure entry`).toMatch(/setup wrote the waiter's entry under Stop only: a turn that ends on an API error fires only StopFailure/);
  }, 900_000);
});
