// The Scope's first line: a scheduled job runs the unit lanes and lints on main's head, under the machine's leases,
// after a set number of landings (README: The surface, The schedule).
import { test } from 'node:test';
import { FLAKY, LANDINGS, LONG, OTHER, SUM, assert, deepCalls, dump, events, land, sandbox, tick, watched } from './helpers.mjs';

test(`the scheduled job runs the unit and lint lanes on main's head after ${LANDINGS} landings and not before, each run under the throttle's grant and the hub's lease`, LONG, async (t) => {
  const box = await sandbox(t);
  const fx = watched(box);
  const runs = [await tick(box, fx)];
  const all = () => dump(box, ...runs);
  const lanes = (since) => events(box).slice(since).filter(({ test }) => test !== 'typecheck');
  const first = lanes(0);
  for (const test of ['sum', 'other', 'flaky']) assert.ok(first.some((run) => run.test === test && run.ok && run.tags.join() === 'base'), `the first tick on a repository didn't run the unit lane's ${test === 'sum' ? SUM : test === 'other' ? OTHER : FLAKY} on main\n${all()}`);
  let seen = events(box).length;
  for (let k = 1; k < LANDINGS; k++) {
    land(box, fx);
    runs.push(await tick(box, fx));
    assert.deepEqual(lanes(seen), [], `a tick ran lanes after ${k} landing${k === 1 ? '' : 's'}, before the set ${LANDINGS}\n${all()}`);
  }
  land(box, fx);
  runs.push(await tick(box, fx));
  const due = lanes(seen);
  const head = fx.landings.at(-1).tags.join();
  for (const test of ['sum', 'other', 'flaky']) assert.ok(due.some((run) => run.test === test && run.tags.join() === head), `the tick after ${LANDINGS} landings didn't run ${test} on main's head (its clone is still at the first commit)\n${all()}`);
  assert.ok(runs.every((run) => run.status === 0), `a tick exited non-zero on a clean main\n${all()}`);
  assert.ok(!events(box).some(({ test }) => test === 'typecheck'), `the job ran a lane other than unit and lint\n${all()}`);
  // Under the machine's leases: every test ran inside a throttle grant and a `deep lease`, and so did the lint lane.
  const unleased = events(box).filter((run) => !run.leased || !run.throttle);
  assert.deepEqual(unleased.map(({ test, tags }) => `${test} on ${tags.join()}`), [], `these test runs had no throttle grant or no lease\n${all()}`);
  assert.ok(deepCalls(box).some((line) => line.startsWith('lease -- ') && line.includes('known-failures-check.mjs')), `the lint lane didn't run under deep lease: ${JSON.stringify(deepCalls(box))}\n${all()}`);
});
