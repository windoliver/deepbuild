// #823.da880762 (deep_run's half): a run's result reaches a waiting deep_run within 20 ms of run.finished.
// One agent stand-in, its session established through its hooks, claims once with deep_claim and then runs the repo's
// `pause` check with deep_run through its own deep mcp, again and again, each run sleeping a different time (README).

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test, type TestContext } from 'vitest';
import { AC1, agentWorld, cleanup, events, loaded, machine, p95, ulid, WITHIN_MS } from './helpers.ts';

afterAll(cleanup, 30_000);

/** Runs timed, after the warm-up ones; the issue gives no count, so the deep_wait half's p95 is read over these. */
const RUNS = 20;
const WARM_UP = 2;

test(`${AC1} a run's result reaches a waiting deep_run within ${WITHIN_MS} ms of run.finished (p95 over ${RUNS} runs)`, async (ctx: TestContext) => {
  const { hub, agent, wt } = await agentWorld();
  const before = machine();
  const made = await agent.call('deep_claim', { task_ref: `task:${ulid()}`, attempt: 1, commit: wt.commit, scope: 'session', predictions: null });
  expect(made.isError, `deep_claim must record the claim the runs are for: ${JSON.stringify(made.reply).slice(0, 1500)}`).toBe(false);
  const claim = typeof made.value?.claim === 'string' ? made.value.claim as string : `claim:${made.value?.event}`;
  const arrived = new Map<string, number>();
  for (let i = 0; i < WARM_UP + RUNS; i++) {
    // Each run sleeps 200 to 300 ms, so it ends at no fixed phase of anything the hub does.
    writeFileSync(join(wt.path, 'pause'), `${(0.2 + Math.random() * 0.1).toFixed(3)}\n`);
    const out = await agent.call('deep_run', { check: 'pause', claim }, 120_000);
    expect(out.isError, `deep_run of pause for ${claim} must return the run's result: ${JSON.stringify(out.reply).slice(0, 1500)}`).toBe(false);
    expect(out.value?.run, `deep_run names its run: ${JSON.stringify(out.value)}`).toMatch(/^run:[0-9A-Za-z]+$/);
    expect(out.value?.outcome, `deep_run waits for the run and returns its outcome, a sleep that passes: ${JSON.stringify(out.value)}`).toBe('passed');
    if (i >= WARM_UP) arrived.set(out.value.run as string, out.arrived);
  }
  const finishedAt = new Map((await events(hub)).filter((e) => e.kind === 'run.finished').map((e) => [String(e.data?.run ?? e.subject), e.ts]));
  const runs = [...arrived.keys()];
  expect(runs.filter((run) => !finishedAt.has(run)), 'every run has its run.finished event in the record').toEqual([]);
  const delays = runs.map((run) => arrived.get(run)! - finishedAt.get(run)!);
  const reading = `p95 ${p95(delays)} ms over ${delays.length} runs (median ${[...delays].sort((a, b) => a - b)[Math.floor(delays.length / 2)]} ms, max ${Math.max(...delays)} ms); ${machine().text} at the end, ${before.text} at the start`;
  console.log(`deep_run, run.finished to the agent: ${reading}; delays ${delays.join(', ')}`);
  if (p95(delays) > WITHIN_MS && loaded(before)) {
    console.log(`INCONCLUSIVE (loaded past its cores): ${reading}`);
    ctx.skip(`INCONCLUSIVE (loaded past its cores): ${reading}`);
  }
  expect(p95(delays), `a run's result must reach the waiting deep_run within ${WITHIN_MS} ms of run.finished: ${reading}; delays ${delays.join(', ')}`).toBeLessThanOrEqual(WITHIN_MS);
}, 600_000);
