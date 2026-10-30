// #823.da880762 (deep_wait's half): an answer to an ask a deep_wait waits on reaches the agent within 20 ms of its
// ask.answered event at p95 over 100 answers.
// #823.f1b9ae1e While a deep_wait waits 30 s with nothing happening, it reads the record no more than twice; a planted
// waiter that reads every 100 ms fails, naming the count.
// One agent stand-in, its session established through its hooks, calls deep_wait through its own deep mcp on asks
// seeded open for its session; you answer on the hub's socket as `deep inbox answer` does (README).

import { afterAll, expect, test, type TestContext } from 'vitest';
import {
  AC1, AC2, agentWorld, ANSWERS, answer, cleanup, control, events, IDLE_MS, loaded, machine, MOST_READS, p95, PLANT_PERIOD_MS, POLLING_PLANT,
  readLog, readsOf, sleep, WITHIN_MS, type World,
} from './helpers.ts';

afterAll(cleanup, 30_000);

/** Asks answered before the measured ones, so the first deep mcp call and the first answer aren't timed. */
const WARM_UP = 2;

test(`${AC1} an answer to an ask deep_wait waits on reaches the agent within ${WITHIN_MS} ms of its ask.answered at p95 over ${ANSWERS} answers`, async (ctx: TestContext) => {
  const { hub, agent, asks } = await agentWorld({ asks: WARM_UP + ANSWERS });
  const before = machine();
  const conn = await control(hub);
  const arrived = new Map<string, number>();
  try {
    for (const ask of asks) {
      let early: unknown;
      const waiting = agent.call('deep_wait', { ask });
      void waiting.then((o) => { early = o.reply; }, (error: unknown) => { early = String(error); });
      // The answer comes at no fixed phase of anything the hub does, once deep_wait is surely waiting.
      await sleep(150 + Math.random() * 150);
      expect(early, `deep_wait on the open ${ask} came back before it was answered: ${JSON.stringify(early)}`).toBeUndefined();
      await answer(conn, ask, 'green');
      const out = await waiting;
      expect(out.isError, `deep_wait on ${ask} must return its answer: ${JSON.stringify(out.reply).slice(0, 1500)}`).toBe(false);
      expect({ ask: out.value?.ask, status: out.value?.status, answer: out.value?.answer }, `deep_wait returns the answer you gave ${ask}`)
        .toEqual({ ask, status: 'answered', answer: 'green' });
      arrived.set(ask, out.arrived);
    }
  } finally {
    conn.close();
  }
  const answeredAt = new Map((await events(hub)).filter((e) => e.kind === 'ask.answered').map((e) => [e.subject, e.ts]));
  const measured = asks.slice(WARM_UP);
  expect(measured.filter((ask) => !answeredAt.has(ask)), 'every answered ask has its ask.answered event in the record').toEqual([]);
  const delays = measured.map((ask) => arrived.get(ask)! - answeredAt.get(ask)!);
  const reading = `p95 ${p95(delays)} ms over ${delays.length} answers (median ${[...delays].sort((a, b) => a - b)[Math.floor(delays.length / 2)]} ms, max ${Math.max(...delays)} ms); ${machine().text} at the end, ${before.text} at the start`;
  console.log(`deep_wait, ask.answered to the agent: ${reading}; delays ${delays.join(', ')}`);
  if (p95(delays) > WITHIN_MS && loaded(before)) {
    console.log(`INCONCLUSIVE (loaded past its cores): ${reading}`);
    ctx.skip(`INCONCLUSIVE (loaded past its cores): ${reading}`);
  }
  expect(p95(delays), `deep_wait's answer must reach the agent within ${WITHIN_MS} ms of ask.answered at p95: ${reading}; delays ${delays.join(', ')}`).toBeLessThanOrEqual(WITHIN_MS);
}, 600_000);

/**
 * deep_wait on one open ask nobody answers, with the hub logging its reads: the reads that name the ask in the 30 s
 * from when the call was sent, and the call's own reply (it waited at least that long and still waits).
 */
async function idleReads(w: World): Promise<{ ask: string; count: number; whole: number }> {
  const [ask] = w.asks as [string];
  expect(readLog(w.reads!), `the hub must log its record reads to DEEP_HUB_TEST_READS from its start (README: The surface under test); it made no ${w.reads}`).toBeDefined();
  const out = await w.agent.call('deep_wait', { ask }, 120_000);
  expect(out.isError, `deep_wait on ${ask}, which nobody answers, must come back still waiting: ${JSON.stringify(out.reply).slice(0, 1500)}`).toBe(false);
  expect(out.value?.status, `deep_wait on ${ask} comes back still waiting: ${JSON.stringify(out.value)}`).toBe('waiting');
  expect(out.arrived - out.sent, `deep_wait on ${ask} waits at least ${IDLE_MS / 1000} s before it says it's still waiting`).toBeGreaterThanOrEqual(IDLE_MS);
  const all = readsOf(readLog(w.reads!) ?? [], ask);
  const count = all.filter((r) => r.at >= out.sent && r.at <= out.sent + IDLE_MS).length;
  const whole = all.filter((r) => r.at >= out.sent && r.at <= out.arrived).length;
  console.log(`deep_wait on ${ask}: ${count} reads of it in its first ${IDLE_MS / 1000} s, ${whole} in its whole ${((out.arrived - out.sent) / 1000).toFixed(1)} s`);
  return { ask, count, whole };
}
/** The criterion's verdict on a read count: why it fails, naming the count, or undefined when it holds. */
const overBudget = (ask: string, count: number): string | undefined =>
  count > MOST_READS ? `deep_wait read the record for ${ask} ${count} times while it waited ${IDLE_MS / 1000} s with nothing happening; at most ${MOST_READS} are allowed` : undefined;

test(`${AC2} a deep_wait that waits ${IDLE_MS / 1000} s with nothing happening reads the record for its ask no more than ${MOST_READS} times`, async () => {
  const w = await agentWorld({ asks: 1, reads: true });
  const { ask, count } = await idleReads(w);
  expect(count, overBudget(ask, count) ?? `${count} reads`).toBeLessThanOrEqual(MOST_READS);
}, 180_000);

test(`${AC2} (wrong program) the planted waiter ${POLLING_PLANT}, reading its ask every ${PLANT_PERIOD_MS} ms, fails the ${IDLE_MS / 1000} s count, naming it`, async () => {
  let w: World | undefined;
  let why = '';
  try {
    w = await agentWorld({ asks: 1, reads: true, plant: POLLING_PLANT });
  } catch (error) {
    why = String(error);
  }
  expect(w, `the hub must start with DEEP_HUB_PLANT=${POLLING_PLANT} (README: The surface under test): ${why}`).toBeDefined();
  const { ask, count } = await idleReads(w!);
  expect(count, `${POLLING_PLANT} reads its ask about every ${PLANT_PERIOD_MS} ms, so at least ${IDLE_MS / PLANT_PERIOD_MS / 2} times in ${IDLE_MS / 1000} s; it read ${count}`)
    .toBeGreaterThanOrEqual(IDLE_MS / PLANT_PERIOD_MS / 2);
  const verdict = overBudget(ask, count);
  expect(verdict, `the ${IDLE_MS / 1000} s count must fail ${POLLING_PLANT}, which read ${count} times`).toBeDefined();
  expect(verdict, 'the failure names the count').toContain(` ${count} times`);
}, 180_000);
