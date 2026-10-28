// AC11 #25.185becde An answer delivered by the waiter exiting with code 2, where the session's next hook and the
// transcript tail show no turn carrying the answer's ID, reads stalled, never delivered and acknowledged, and goes by
// the next route once the transcript is read; a delivery recorded from the waiter's exit alone fails this test,
// naming the ask.
//
// The session asks through deep_ask and stops; the hold ends with no answer, and the session is idle with its waiter
// waiting. This Claude Code doesn't start a turn when the waiter exits 2 (the stand-in's wake:false: the exit is
// seen, no turn, no transcript entry). You answer; the waiter exits 2 with it. No turn carries the answer's ID, so
// the record's delivery.outcome@1 for the ask must never read `delivered` from that exit. You then type a prompt:
// the session's next hook. Its transcript tail shows no turn carrying the answer, so the delivery reads `stalled`, and
// the answer goes by the next route: DeepBuild's reply to that UserPromptSubmit carries it.

import { afterAll, describe, expect, it } from 'vitest';
import {
  answer, askingSession, carries, cleanup, firedShown, makeHome, outcomes, ours, payload, setup, sleep, startHub, typedPrompt, waitFor,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'delivered-on-waiter-exit';

async function scenario(plant?: string): Promise<void> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { home } = makeHome();
  const hub = await startHub(home, { plant });
  await setup(home, env);
  const a = await askingSession(hub, home, env);
  await a.claude.configure({ wake: false });

  // The stop's hold ends with no answer; the session is idle and its waiter waits.
  const fired = await a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' }));
  expect(fired.blocked, `nothing is answered yet, so the stop goes through: ${firedShown(fired)}`).toBeUndefined();
  const [waiter] = await waitFor(async () => { const live = await a.claude.liveWaiters(a.s.id); return live.length ? live : undefined; }, 30_000, `the waiter of ${a.s.id}, waiting once its stop went through`);

  // You answer; the waiter exits 2 with it, and no turn starts.
  await answer(home, a.handle, a.green.id, plant);
  const exit = await waitFor(() => a.claude.wakes.find((w) => w.session === a.s.id), 30_000, `the waiter (pid ${waiter!.pid}) exiting 2 with ${a.handle}`).catch(() => undefined);
  if (!exit) throw Error(`AC11 the idle session's waiter (pid ${waiter!.pid}) must deliver ${a.handle} by exiting 2; it didn't within 30 s`);
  expect(exit.code).toBe(2);
  expect(carries(exit.stderr, a.green), `the waiter's exit 2 carries the answer on stderr: ${JSON.stringify(exit.stderr)}`).toBe(true);

  // No turn carries the answer: the waiter's exit alone is never a delivery delivered and acknowledged.
  await sleep(3000);
  const early = (await outcomes(hub, a.id)).filter((e) => e.data.outcome === 'delivered');
  if (early.length) throw Error(`AC11 ${a.handle} was recorded delivered and acknowledged from the waiter's exit alone, with no turn in the session carrying it: ${JSON.stringify(early.map((e) => ({ id: e.id, log_pos: e.log_pos, data: e.data })))}`);

  // The session's next hook: a prompt you type. Its transcript tail shows no turn carrying the answer.
  typedPrompt(a.s, 'Anything new for me?');
  const next = await a.claude.hook('UserPromptSubmit', payload(a.s, 'UserPromptSubmit', { prompt: 'Anything new for me?' }));
  const replies = ours(next).filter((r) => !r.async);
  if (!replies.some((r) => r.code === 0 && carries(r.stdout, a.green))) {
    throw Error(`AC11 once the transcript is read and shows no turn carrying it, ${a.handle} must go by the next route, DeepBuild's reply to this UserPromptSubmit: ${firedShown(next)}`);
  }
  const all = await waitFor(async () => { const o = await outcomes(hub, a.id); return o.some((e) => e.data.outcome === 'stalled') ? o : undefined; }, 15_000, `a stalled delivery.outcome for ${a.handle}`).catch(async () => outcomes(hub, a.id));
  const stalled = all.find((e) => e.data.outcome === 'stalled');
  if (!stalled) throw Error(`AC11 the waiter's delivery of ${a.handle}, with no turn carrying it, must read stalled once the transcript is read; the record holds ${JSON.stringify(all.map((e) => e.data))}`);
  const before = all.filter((e) => e.data.outcome === 'delivered' && e.log_pos < stalled.log_pos);
  if (before.length) throw Error(`AC11 ${a.handle} was recorded delivered and acknowledged before it read stalled: ${JSON.stringify(all.map((e) => ({ log_pos: e.log_pos, data: e.data })))}`);
}

describe('AC11 #25.185becde An answer delivered by the waiter exiting with code 2, where the session\'s next hook and the transcript tail show no turn carrying the answer\'s ID, reads stalled, never delivered and acknowledged, and goes by the next route once the transcript is read; a delivery recorded from the waiter\'s exit alone fails this test, naming the ask', () => {
  it('AC11 #25.185becde the waiter exits 2 with the answer and no turn carries it: never delivered from the exit, stalled once the next hook reads the transcript, then sent by the next prompt', async () => {
    await scenario();
  }, 900_000);

  it(`AC11 #25.185becde (wrong program) a host that records the delivery from the waiter's exit alone (${PLANT}) fails this test, naming the ask`, async () => {
    let failure = '';
    try { await scenario(PLANT); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the stalled check must fail on ${PLANT}, naming the ask`).toMatch(/AC11 ask:[0-9A-Z]{26} was recorded delivered and acknowledged from the waiter's exit alone/);
  }, 900_000);
});
