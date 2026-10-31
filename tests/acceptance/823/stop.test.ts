// #823.d60a913c A hub stopping while a call waits still answers it as unavailable, as today, never with a success.
// The agent's deep_wait (on an open ask nobody answers) and deep_run (of a check that sleeps a minute) are each left
// waiting; then the hub stops (SIGTERM, by its PID, as `deep hub stop` signals it). The agent's deep mcp keeps running.

import { afterAll, expect, test } from 'vitest';
import { AC3, agentWorld, cleanup, eventMatching, sleep, stopHub, ulid, type Outcome } from './helpers.ts';

afterAll(cleanup, 30_000);

/** The reply must reach the agent within this of the hub's exit, as #26's outage test holds deep_wait today. */
const AFTER_EXIT_MS = 1000;

/** `call` left waiting, then the hub stopped: the call's outcome, and how long after the hub exited it arrived. */
async function stoppedWhileWaiting(w: Awaited<ReturnType<typeof agentWorld>>, call: Promise<Outcome>, what: string): Promise<{ out: Outcome; afterExit: number }> {
  let early: unknown;
  void call.then((o) => { early = o.reply; }, (error: unknown) => { early = String(error); });
  await sleep(1500);
  expect(early, `${what} came back before the hub stopped: ${JSON.stringify(early)}`).toBeUndefined();
  let exitedAt = 0;
  void w.hub.exited.then(() => { exitedAt = Date.now(); });
  await stopHub(w.hub);
  await sleep(10);
  const out = await call;
  return { out, afterExit: out.arrived - exitedAt };
}

test(`${AC3} a deep_wait waiting when the hub stops is answered unavailable, never with a success`, async () => {
  const w = await agentWorld({ asks: 1 });
  const [ask] = w.asks as [string];
  const { out, afterExit } = await stoppedWhileWaiting(w, w.agent.call('deep_wait', { ask }, 120_000), `deep_wait on the open ${ask}`);
  console.log(`deep_wait with the hub stopping: ${JSON.stringify(out.reply).slice(0, 600)}; ${afterExit} ms after the hub exited`);
  expect(out.isError, `deep_wait on ${ask} must not succeed when the hub stops while it waits: ${JSON.stringify(out.reply).slice(0, 1500)}`).toBe(true);
  expect(out.value?.code, `deep_wait on ${ask} is answered unavailable: ${JSON.stringify(out.value)}`).toBe('unavailable');
  expect(afterExit, `deep_wait's answer reaches the agent within ${AFTER_EXIT_MS} ms of the hub's exit (it took ${afterExit} ms)`).toBeLessThanOrEqual(AFTER_EXIT_MS);
}, 180_000);

test(`${AC3} a deep_run waiting on its run when the hub stops is answered unavailable, never with a success`, async () => {
  const w = await agentWorld();
  const made = await w.agent.call('deep_claim', { task_ref: `task:${ulid()}`, attempt: 1, commit: w.wt.commit, scope: 'session', predictions: null });
  expect(made.isError, `deep_claim must record the claim the run is for: ${JSON.stringify(made.reply).slice(0, 1500)}`).toBe(false);
  const claim = typeof made.value?.claim === 'string' ? made.value.claim as string : `claim:${made.value?.event}`;
  const call = w.agent.call('deep_run', { check: 'long', claim }, 120_000);
  const started = await eventMatching(w.hub, (e) => e.kind === 'run.started' && e.data?.check === 'long', 20_000);
  expect(started, 'BLOCKED unless deep_run started the run of long').toBeDefined();
  const { out, afterExit } = await stoppedWhileWaiting(w, call, `deep_run of long for ${claim}`);
  console.log(`deep_run with the hub stopping: ${JSON.stringify(out.reply).slice(0, 600)}; ${afterExit} ms after the hub exited`);
  expect(out.isError, `deep_run must not succeed when the hub stops while it waits: ${JSON.stringify(out.reply).slice(0, 1500)}`).toBe(true);
  expect(out.value?.code, `deep_run is answered unavailable: ${JSON.stringify(out.value)}`).toBe('unavailable');
  expect(afterExit, `deep_run's answer reaches the agent within ${AFTER_EXIT_MS} ms of the hub's exit (it took ${afterExit} ms)`).toBeLessThanOrEqual(AFTER_EXIT_MS);
}, 180_000);
