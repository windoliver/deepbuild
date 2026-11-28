import { afterAll, describe, expect, it } from 'vitest';
import { askingSession, cleanup, firedShown, groupOf, makeHome, payload, setup, startHub, waitFor, type Asking } from '../25/routes/helpers.ts';
import { assertionFailureOf, blockedUnlessAsserted, seenWithin } from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'waiter-outlives-session';
const GRACE_MS = 10_000;
const STILL_WAITING_WATCH_MS = 2000;

async function idleWithWaiter(a: Asking): Promise<number> {
  const fired = await a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' }));
  expect(fired.blocked, `nothing is answered, so the stop goes through: ${firedShown(fired)}`).toBeUndefined();
  const [waiter] = await waitFor(async () => { const live = await a.claude.liveWaiters(a.s.id); return live.length ? live : undefined; }, 30_000, `the waiter of ${a.s.id}, waiting for ${a.handle}`);
  return waiter!.pid;
}

async function sessionsEndAndNoWaiterIsLeft(plant?: string): Promise<void> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { home } = makeHome();
  const hub = await startHub(home, { plant, noAskWait: true, shortHold: true });
  await setup(home, env);
  const [a, b] = await Promise.all([askingSession(hub, home, env), askingSession(hub, home, env)]);
  const [pa, pb] = await Promise.all([idleWithWaiter(a!), idleWithWaiter(b!)]);
  const waiters = [[a!, pa], [b!, pb]] as const;
  const goneBeforeItsSessionEnded = await seenWithin(() => waiters.find(([, pid]) => groupOf(pid).length === 0), STILL_WAITING_WATCH_MS, 'a waiter to end while its session is still there');
  expect(goneBeforeItsSessionEnded?.[1], `the control: each waiter is still waiting for its ask before its session ends, and ${goneBeforeItsSessionEnded?.[0].s.id}'s waiter (pid ${goneBeforeItsSessionEnded?.[1]}), waiting for ${goneBeforeItsSessionEnded?.[0].handle}, is gone`).toBeUndefined();

  await a!.claude.hook('SessionEnd', payload(a!.s, 'SessionEnd', { reason: 'prompt_input_exit' }));
  await a!.claude.end();
  const endedA = Date.now();
  await b!.claude.kill();
  const endedB = Date.now();

  const left: string[] = [];
  for (const [x, pid, ended, how] of [[a!, pa, endedA, 'ended (SessionEnd, then Claude Code exited)'], [b!, pb, endedB, 'Claude Code was killed']] as const) {
    await seenWithin(() => groupOf(pid).length === 0, Math.max(0, ended + GRACE_MS - Date.now()), `the waiter (pid ${pid}) of ${x.s.id} to end`);
    const rest = groupOf(pid);
    if (rest.length) left.push(`${x.s.id}'s waiter (pid ${pid}) outlived its session: ${rest.length} process(es) still running ${GRACE_MS / 1000} s after it ${how}: ${JSON.stringify(rest.map((p) => ({ pid: p.pid, ppid: p.ppid, command: p.command.slice(0, 200) })))}`);
  }
  expect(left.length, `AC3 ${left.length ? left.join('; ') : 'no waiter outlives its session'}`).toBe(0);
}

const scenario = (plant?: string): Promise<void> => blockedUnlessAsserted(sessionsEndAndNoWaiterIsLeft(plant));
const unplantedControl = (): Promise<void> => scenario();

describe('AC3 #25.008fdf08 No waiter outlives its session', () => {
  it('AC3 #25.008fdf08 a waiter still waiting for an answer ends within 10 s of its session, whether the session ends or its Claude Code is killed', async () => {
    await scenario();
  }, 900_000);

  it(`AC3 #25.008fdf08 (wrong program) a waiter that doesn't watch its session (${PLANT}) fails this test`, async () => {
    await unplantedControl();
    const failure = await assertionFailureOf(scenario(PLANT));
    expect(failure, `the session-end check must fail on ${PLANT}`).toMatch(/AC3 .*waiter \(pid \d+\) outlived its session/);
  }, 900_000);
});
