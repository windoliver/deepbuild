// Blind redraft, under #3478, of #2574's AC2c (REDRAFT.md). Written from issue #2574 (AC2, as
// tests/acceptance/2574/README.md quotes it), issue #3478, the design's Dogfooding section and docs/parallel-proof.md
// section 6. AC2a and AC2e are tests/acceptance/2574/grant.test.mjs's, carried as they are; AC2c is redrafted: the
// run's one grant is still taken through scripts/throttle.mjs test, but with #3478's stall of 720 minutes in place of
// `--wait 30`. AC2b and AC2d run from tests/acceptance/2574-redraft-2833/ and are not repeated here.
// The real scripts/affected.mjs and scripts/throttle.mjs run in a scratch tree with a sandboxed HOME, so the throttle
// table and its log are the sandbox's (tests/acceptance/2574/README.md: AC2).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { calls, dump, jobLogs, LONG, NODE, probes, sandbox, SRC, start, throttleLog, timedPath, tree, VITEST, nodeProbe } from '../2574/helpers.mjs';

async function within(child, ms) {
  let timer;
  // deadline: a run still going past its bound is failed by the assertion below, so a hang can't pass
  const result = await Promise.race([child.done, new Promise((done) => { timer = setTimeout(() => done(null), ms); })]);
  clearTimeout(timer);
  assert.ok(result, `affected.mjs did not end within ${ms / 1000} s\nstdout so far:\n${child.out().slice(-2_500)}`);
  return result;
}
const topTest = (log, others = new Set()) => log.filter((e) => e.event === 'granted' && e.class === 'test' && e.grant === 'top-level' && !others.has(e.pid));
const show = (log) => log.map((e) => JSON.stringify(e)).join('\n');

// One run with untimed jobs of every kind the fixture has: a change to packages/p/src, so the package build runs, the
// lints, a vitest and a node --test block. Read by bullets (a) and (c).
describe('#2574 AC2 a run with untimed jobs and no neighbour', () => {
  // The sandbox's cleanup is the suite's, registered here: one registered in the hook would run as the hook ends.
  const box = sandbox({ after });
  let fixture, run, log;
  before(async () => {
    fixture = tree(box);
    run = await within(start(box, fixture, [SRC, VITEST, NODE]), 280_000);
    log = throttleLog(box);
  }, LONG);

  test('#2574.AC2a the throttle log shows one top-level test grant, a passed event for each job that asks, and no build request', () => {
    const all = `${dump(run)}\nthrottle log:\n${show(log)}\nprobes:\n${JSON.stringify(probes(fixture))}`;
    const ran = probes(fixture).map(({ job }) => job);
    for (const job of ['build', VITEST, NODE]) assert.ok(ran.includes(job), `the ${job} job never started, so the run proves nothing\n${all}`);
    const grants = topTest(log);
    assert.equal(grants.length, 1, `the run took ${grants.length} top-level test grants, not one\n${all}`);
    const [grant] = grants;
    const queued = log.filter((e) => (e.event === 'granted' || e.event === 'timeout') && e !== grant);
    assert.deepEqual(queued, [], `the run asked the table for grants other than its one test grant (a build request among them?)\n${all}`);
    assert.deepEqual(log.filter((e) => e.class === 'build' && e.event !== 'passed'), [], `the run made a build request\n${all}`);
    const token = `test:${grant.id}`;
    const passed = log.filter((e) => e.event === 'passed');
    assert.deepEqual(passed.filter((e) => e.through !== token), [], `a passed event came through something other than the run's grant ${token}\n${all}`);
    const logs = jobLogs(fixture);
    const asking = logs.filter((name) => /\/(?:vitest|node|build|cargo)[^/]*\.log$/.test(name));
    assert.ok(asking.length >= 3, `the run's logs folder holds no log for the build and test jobs: ${logs.join(' ')}\n${all}`);
    assert.ok(passed.length >= asking.length, `${passed.length} passed events for ${asking.length} jobs that ask (${asking.join(' ')})\n${all}`);
    assert.ok(passed.length <= logs.length, `${passed.length} passed events for ${logs.length} jobs\n${all}`);
    for (const { job, throttle } of probes(fixture)) {
      if (['build', VITEST, NODE].includes(job)) assert.equal(throttle, token, `the ${job} job ran under ${throttle}, not the run's grant\n${all}`);
      else assert.ok(throttle === null || throttle === token, `the ${job} job ran under ${throttle}, not the run's grant\n${all}`);
    }
  });

  // Redrafted under #3478: a stall of 720 minutes through `throttle.mjs test --stall`, and no fixed wait.
  test('#2574.AC2c the run\'s grant waits on a stall of 720 minutes and is taken through scripts/throttle.mjs test --stall', () => {
    const all = `${dump(run)}\nthrottle log:\n${show(log)}\nthrottle.mjs calls:\n${JSON.stringify(calls(fixture))}`;
    const grants = topTest(log);
    assert.ok(grants.length >= 1, `the run took no top-level test grant\n${all}`);
    for (const grant of grants) {
      assert.equal(grant.stall, 720, `the run's test grant waited on a stall of ${grant.stall} min, not 720\n${all}`);
      assert.equal(grant.wait, undefined, `the run's test grant carries a fixed wait of ${grant.wait} min beside its stall\n${all}`);
      const call = calls(fixture).find(({ pid }) => pid === grant.pid);
      assert.ok(call, `the run's test grant (pid ${grant.pid}) was not taken through scripts/throttle.mjs\n${all}`);
      assert.deepEqual(call.args.slice(0, 4), ['test', '--stall', '720', '--'], `the run's grant was taken as throttle.mjs ${call.args.join(' ')}\n${all}`);
    }
  });
});

test('#2574.AC2e with --timed the timed files run after the run\'s test grant is released, each block under its own timed grant', LONG, async (t) => {
  const box = sandbox(t);
  const TIMED = timedPath('mjs');
  const fixture = tree(box, { [TIMED]: nodeProbe(TIMED) });
  const run = await within(start(box, fixture, [VITEST, NODE, TIMED, '--timed'], { T2574_IDLE: '1' }), 280_000);
  const log = throttleLog(box);
  const all = `${dump(run)}\nthrottle log:\n${show(log)}\nprobes:\n${JSON.stringify(probes(fixture))}`;
  const timedRun = probes(fixture).find(({ job }) => job === TIMED);
  assert.ok(timedRun, `the timed file ${TIMED} never ran\n${all}`);
  const [, id] = timedRun.throttle?.match(/^timed:([0-9a-f]+)$/) ?? [];
  assert.ok(id, `the timed file ran under ${timedRun.throttle}, not a timed grant of its own\n${all}`);
  const timedGrants = log.filter((e) => e.event === 'granted' && e.class === 'timed');
  assert.equal(timedGrants.length, 1, `one timed block took ${timedGrants.length} timed grants\n${all}`);
  assert.equal(timedGrants[0].id, id, `the timed file's grant is not in the log\n${all}`);
  const at = log.indexOf(timedGrants[0]);
  const grants = topTest(log);
  assert.ok(grants.length >= 1, `the run took no test grant\n${all}`);
  for (const grant of grants) {
    const freed = log.findIndex((e) => e.event === 'released' && e.id === grant.id);
    assert.ok(freed >= 0 && freed < at, `the run's test grant ${grant.id} was not released before the timed grant\n${all}`);
  }
});
