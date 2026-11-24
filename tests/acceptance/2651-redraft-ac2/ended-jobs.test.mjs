// #2651 AC2 (blind redraft): with 10,000 ended jobs in the record and none running, the hub's own instructions
// retired for a PreToolUse are within 2% of the same hook with no job in the record, over 15 alternated rounds. Two
// hubs of this checkout run side by side, each on a home of its own: one whose record holds 10,000 ended jobs, the
// hub's own job.submit rows, and one whose record holds none. The kernel counts each hub process's own instructions
// (rusage.c); the perf lane's own judge, judgeInstructions in scripts/benchmark.mjs, reads the 15 pairs with the 2%
// of the design's instruction budgets. Only PASS passes. README: the measurement, the readings, how to run.
import assert from 'node:assert/strict';
import test from 'node:test';
import { judgeInstructions } from '../../../scripts/benchmark.mjs';
import { BATCH, HIGHEST_LEFT_OUT, control, counter, median, postToolUse, preToolUse, READINGS, remove, rounds, session, sessionId, startHub, stopHub, tempHome, unbuilt } from './lib.mjs';

/** The criterion's numbers. */
const JOBS = 10_000, ROUNDS = 15;
/** PreToolUse hooks each hub answers before the first round, so neither is judged on its first calls (JIT, caches). */
const WARM = 300;
/** A job's states once it has ended (JobState in @deepbuild/runner): the rest are waiting, running and stopping. */
const ENDED = new Set(['stopped', 'finished', 'refused', 'lost']);
const M = (n) => (n === null ? 'missing' : `${(n / 1e6).toFixed(3)}M`);

/** Records `count` jobs through the hub's own job.submit, each ended at once: no agent named `none` exists, so the runner refuses it. */
async function seed(hub, count) {
  await control(hub, async (call) => {
    for (let i = 0; i < count; i += 100) {
      await Promise.all(Array.from({ length: Math.min(100, count - i) }, (_, k) => call('job.submit', { spec: { kind: 'read', agent: 'none', prompt: `ended job ${i + k}` } })));
    }
  });
}
/** The hub's job.list, read back: how many jobs, how many of them live. */
async function jobsOf(hub) {
  const { jobs } = await control(hub, (call) => call('job.list'));
  return { all: jobs.length, live: jobs.filter((j) => !ENDED.has(j.state)).map((j) => `${j.job} ${j.state}`) };
}

test('#2651.306dda20 AC2 with 10,000 ended jobs in the record and none running, the hub retires within 2% of the instructions for a PreToolUse that it does with no job in the record, over 15 alternated rounds', { timeout: 60 * 60_000 }, async () => {
  const problem = unbuilt() ?? counter().blocked;
  assert.ok(!problem, problem);
  const homes = { jobs: tempHome(), none: tempHome() };
  const hubs = {};
  try {
    // The record with 10,000 ended jobs, written by the hub itself; then a fresh hub opens it, as after a restart.
    const seeding = await startHub(homes.jobs);
    try {
      await seed(seeding, JOBS);
    } finally {
      await stopHub(seeding);
    }
    hubs.jobs = await startHub(homes.jobs);
    hubs.none = await startHub(homes.none);
    const held = { jobs: await jobsOf(hubs.jobs), none: await jobsOf(hubs.none) };
    assert.ok(held.jobs.all === JOBS && held.jobs.live.length === 0, `BLOCKED: the record should hold ${JOBS} ended jobs and none running; job.list gives ${held.jobs.all}, live: ${held.jobs.live.slice(0, 5).join(', ')}`);
    assert.equal(held.none.all, 0, `BLOCKED: the empty side's job.list gives ${held.none.all} jobs`);

    // Each hub answers a warm-up session of the user's own (no job's) first, uncounted.
    for (const hub of [hubs.jobs, hubs.none]) {
      await session(hub, sessionId(0));
      for (let i = 0; i < WARM; i++) await postToolUse(hub, sessionId(0), await preToolUse(hub, sessionId(0)));
    }

    const pairs = await rounds(ROUNDS, hubs.jobs, hubs.none);
    const judged = judgeInstructions(pairs.map(({ current, base }) => ({ current, base })));
    const withJobs = pairs.map((p) => p.current).filter((n) => n !== null), without = pairs.map((p) => p.base).filter((n) => n !== null);
    const table = pairs.map((p, i) => `  round ${String(i + 1).padStart(2)}: ${M(p.current)} with ${JOBS} ended jobs, ${M(p.base)} with none (readings ${p.readings.current.map(M).join(' ')} | ${p.readings.base.map(M).join(' ')})`).join('\n');
    const counts = `the hub's own instructions retired per PreToolUse: ${M(withJobs.length ? median(withJobs) : null)} with ${JOBS} ended jobs in the record and ${M(without.length ? median(without) : null)} with no job (medians of ${ROUNDS} alternated rounds; a round's count is a side's mean per hook over its ${READINGS - HIGHEST_LEFT_OUT} lowest of ${READINGS} readings of ${BATCH} hooks)`;
    assert.equal(judged.status, 'PASS', `${judged.status}: ${counts}. ${judged.reason}\n${table}`);
  } finally {
    for (const hub of Object.values(hubs)) await stopHub(hub);
    for (const home of Object.values(homes)) remove(home);
  }
});
