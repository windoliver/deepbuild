// AC4 #25.1eae4ef9 An answer that lands while the session's stop is held and its waiter is alive goes back through
// the Stop hold only, the waiter exits without waking, and the transcript shows the answer's ID once; a host that
// sends it by both routes fails this test, naming the routes.
//
// The session asks through deep_ask and stops with its ask open: Claude Code runs DeepBuild's held Stop entry and
// starts the waiter beside it. You answer while both are there. The routes are read at Claude Code's side: the Stop
// hold is the Stop's `decision: block` carrying the answer; the waiter is its exit 2, which wakes the session (the
// stand-in queues the wake while the turn runs and starts it once the turn's Stop goes through, as #80 recorded). The
// answer's ID is its ask's ID or its ask.answered event's; the transcript entries that carry it are counted, the
// agent's own deep_ask call and its result aside.

import { afterAll, describe, expect, it } from 'vitest';
import {
  answer, answerIds, askingSession, assistantSays, carries, carriers, cleanup, firedShown, makeHome, payload, setup, sleep, startHub, waitFor,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'both-routes';

async function scenario(plant?: string): Promise<void> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { home } = makeHome();
  const hub = await startHub(home, { plant });
  await setup(home, env);
  const a = await askingSession(hub, home, env);

  let settled = false;
  const stopping = a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' }));
  void stopping.then(() => { settled = true; }, () => { settled = true; });
  const [waiter] = await waitFor(async () => { const live = await a.claude.liveWaiters(a.s.id); return live.length ? live : undefined; }, 30_000, `the waiter Claude Code started at ${a.s.id}'s Stop`);
  await sleep(2000);
  if (settled) throw Error(`AC4 the Stop of a session whose ask ${a.handle} is open must be held for your answer; it ended before you answered: ${firedShown(await stopping)}`);
  if (!(await a.claude.liveWaiters(a.s.id)).some((r) => r.pid === waiter!.pid)) throw Error(`AC4 the waiter (pid ${waiter!.pid}) must still be waiting while the stop is held, so the answer lands with both routes open`);

  // You answer while the stop is held and the waiter is alive.
  await answer(home, a.handle, a.green.id, plant);
  const fired = await stopping;
  // The waiter exits, without waking: give it 15 s.
  const exited = await waitFor(async () => (await a.claude.background()).find((r) => r.pid === waiter!.pid && r.ended !== null), 15_000, 'the waiter\'s exit').catch(() => undefined);

  const routes: string[] = [];
  if (fired.blocked && carries(fired.blocked, a.green)) routes.push('the Stop hold (decision: block)');
  if (exited && exited.code === 2) routes.push(`the waiter (exit 2${carries(exited.stderr, a.green) ? ' with the answer' : ''})`);
  if (routes.length > 1) throw Error(`AC4 ${a.handle} went back by both routes: ${routes.join(' and ')}; with the stop held, it goes by the Stop hold only: ${firedShown(fired)}`);
  if (!routes[0]?.startsWith('the Stop hold')) throw Error(`AC4 ${a.handle} must go back through the Stop hold only; it went by ${routes[0] ?? 'neither route'}: ${firedShown(fired)}`);
  if (!exited) throw Error(`AC4 once the Stop hold took ${a.handle}, the waiter (pid ${waiter!.pid}) must exit without waking; it was still running 15 s after the answer`);

  // The turn goes on with the answer and stops; nothing wakes the session with it afterwards.
  assistantSays(a.s, `You chose ${a.green.label}; the header is green now.`);
  const next = await a.claude.hook('Stop', payload(a.s, 'Stop', { stop_hook_active: true, last_assistant_message: `You chose ${a.green.label}; the header is green now.` }));
  if (next.blocked && carries(next.blocked, a.green)) throw Error(`AC4 ${a.handle} went back through the Stop hold twice: the continued turn's Stop was sent back with it again: ${firedShown(next)}`);
  await sleep(5000);
  const woke = a.claude.wakes.filter((w) => w.session === a.s.id);
  if (woke.length) throw Error(`AC4 ${a.handle} went back by both routes: the Stop hold and the waiter, which woke the session ${woke.length} time(s) afterwards: ${JSON.stringify(woke.map((w) => ({ pid: w.pid, stderr: w.stderr.slice(0, 300) })))}`);

  // The transcript shows the answer's ID once.
  const ids = await answerIds(hub, a.id);
  const shown = carriers(a.s, ids);
  expect(shown.length, `AC4 the transcript must show the answer's ID (${ids.join(' or ')}) once; it shows it in ${shown.length} entries: ${JSON.stringify(shown).slice(0, 2000)}`).toBe(1);
}

describe('AC4 #25.1eae4ef9 An answer that lands while the session\'s stop is held and its waiter is alive goes back through the Stop hold only, the waiter exits without waking, and the transcript shows the answer\'s ID once; a host that sends it by both routes fails this test, naming the routes', () => {
  it('AC4 #25.1eae4ef9 with the stop held and the waiter alive, the answer goes back by the Stop hold only, the waiter exits without waking, and the transcript shows its ID once', async () => {
    await scenario();
  }, 900_000);

  it(`AC4 #25.1eae4ef9 (wrong program) a host that sends the answer by both routes (${PLANT}) fails this test, naming the routes`, async () => {
    let failure = '';
    try { await scenario(PLANT); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the one-route check must fail on ${PLANT}, naming both routes`).toMatch(/AC4 ask:\S+ went back by both routes: the Stop hold .* and the waiter/);
  }, 900_000);
});
