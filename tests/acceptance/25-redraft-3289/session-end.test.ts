// AC3 #25.008fdf08 No waiter outlives its session.
//
// Redraft of ../25/routes/session-end.test.ts (README). Same world: two sessions ask through deep_ask and stop; each
// hold ends with no answer, and each session is idle with its waiter waiting (Scope: the waiter "watches its parent
// process and exits with the session"). Then A ends (SessionEnd, then Claude Code exits) and B's Claude Code is killed.
// The stand-in leaves its background entries running when it goes, so whatever ends the waiter is DeepBuild's. Within
// 10 s of its session's end, no process of either waiter's process group is left.
//
// What changed: a waiter left running is Vitest's own assertion failure, naming its pid; a world that can't be set up
// reads BLOCKED; and the wrong-program test first runs the same world unplanted as its control, so a program that is
// itself the plant fails it there. It compares only an assertion failure with its expected text.

import { afterAll, describe, expect, it } from 'vitest';
import { askingSession, cleanup, firedShown, groupOf, makeHome, payload, setup, sleep, startHub, waitFor, type Asking } from '../25/routes/helpers.ts';
import { assertionFailureOf, blockedUnlessAsserted } from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'waiter-outlives-session';
const GRACE_MS = 10_000;

async function idleWithWaiter(a: Asking): Promise<number> {
  const fired = await a.claude.hook('Stop', payload(a.s, 'Stop', { last_assistant_message: 'I asked which header colour you want; I will wait for your answer.' }));
  expect(fired.blocked, `nothing is answered, so the stop goes through: ${firedShown(fired)}`).toBeUndefined();
  const [waiter] = await waitFor(async () => { const live = await a.claude.liveWaiters(a.s.id); return live.length ? live : undefined; }, 30_000, `the waiter of ${a.s.id}, waiting for ${a.handle}`);
  return waiter!.pid;
}

async function world(plant?: string): Promise<void> {
  const env = plant ? { DEEP_HUB_PLANT: plant } : {};
  const { home } = makeHome();
  const hub = await startHub(home, { plant, noAskWait: true, shortHold: true });
  await setup(home, env);
  const [a, b] = await Promise.all([askingSession(hub, home, env), askingSession(hub, home, env)]);
  const [pa, pb] = await Promise.all([idleWithWaiter(a!), idleWithWaiter(b!)]);
  await sleep(2000);
  for (const [x, pid] of [[a!, pa], [b!, pb]] as const) {
    expect(groupOf(pid).length, `the control: ${x.s.id}'s waiter (pid ${pid}) is still waiting for ${x.handle} before its session ends`).toBeGreaterThan(0);
  }

  // A ends: its SessionEnd, then Claude Code exits. B's Claude Code is killed.
  await a!.claude.hook('SessionEnd', payload(a!.s, 'SessionEnd', { reason: 'prompt_input_exit' }));
  await a!.claude.end();
  const endedA = Date.now();
  await b!.claude.kill();
  const endedB = Date.now();

  const left: string[] = [];
  for (const [x, pid, ended, how] of [[a!, pa, endedA, 'ended (SessionEnd, then Claude Code exited)'], [b!, pb, endedB, 'Claude Code was killed']] as const) {
    while (groupOf(pid).length && Date.now() - ended < GRACE_MS) await sleep(250);
    const rest = groupOf(pid);
    if (rest.length) left.push(`${x.s.id}'s waiter (pid ${pid}) outlived its session: ${rest.length} process(es) still running ${GRACE_MS / 1000} s after it ${how}: ${JSON.stringify(rest.map((p) => ({ pid: p.pid, ppid: p.ppid, command: p.command.slice(0, 200) })))}`);
  }
  // The text goes in the assertion's own message: Vitest cuts a long received value short in its failure.
  expect(left.length, `AC3 ${left.length ? left.join('; ') : 'no waiter outlives its session'}`).toBe(0);
}

/** The world, where a failure that isn't at an assertion (the hub unreachable, a waiter never up) reads BLOCKED. */
const scenario = (plant?: string): Promise<void> => blockedUnlessAsserted(world(plant));

describe('AC3 #25.008fdf08 No waiter outlives its session', () => {
  it('AC3 #25.008fdf08 a waiter still waiting for an answer ends within 10 s of its session, whether the session ends or its Claude Code is killed', async () => {
    await scenario();
  }, 900_000);

  it(`AC3 #25.008fdf08 (wrong program) a waiter that doesn't watch its session (${PLANT}) fails this test`, async () => {
    await scenario(); // the control: unplanted, no waiter outlives its session
    const failure = await assertionFailureOf(scenario(PLANT));
    expect(failure, `the session-end check must fail on ${PLANT}`).toMatch(/AC3 .*waiter \(pid \d+\) outlived its session/);
  }, 900_000);
});
