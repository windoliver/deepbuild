// #3433: a lane run that ends by itself is unchanged: it writes its record by its tests, with no stop finding, and the
// stop leaves nothing running once the run ends (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { alive, commandOf, dump, ENDS, LANE, laneFixture, laneRecords, recorded, sandbox, startLane, TEST_FILE, treeOf, until } from './helpers.mjs';

test('#3433.cd15df63 a lane run that ends by itself writes its record by its tests, with no stop finding, and leaves no process of the stop running', { timeout: 300_000 }, async (t) => {
  const box = sandbox(t, 'lane-ends');
  const fixture = laneFixture(box, ENDS);
  const lane = startLane(box, fixture);
  // Every process seen under the lanes.mjs process while it runs, a stop it starts among them: each joins the sandbox's
  // list, so the test's cleanup reaches it too.
  const tree = [];
  // deadline: spaces the test's own listings of the run's tree; it ends with the run.
  const watch = setInterval(() => {
    if (lane.exit !== null) return;
    for (const proc of treeOf(lane.child.pid)) if (proc.pid > 1 && !tree.some((seen) => seen.pid === proc.pid && seen.start === proc.start)) {
      const entry = { role: 'tree', ...proc };
      tree.push(entry);
      box.seen.push(entry);
    }
  }, 100);
  t.after(() => clearInterval(watch));
  const ended = await until(() => lane.exit !== null, 240_000);
  clearInterval(watch);
  const procs = recorded(box, fixture.pids);
  const all = () => `${dump(lane, fixture, procs)}\nseen under lanes.mjs: ${JSON.stringify(tree.map((proc) => ({ ...proc, alive: alive(proc) })))}`;
  assert.ok(ended, `the lane run ended by itself within 4 min\n${all()}`);
  assert.equal(lane.exit.code, 0, `the lane run passed\n${all()}`);

  const records = laneRecords(fixture);
  assert.equal(records.length, 1, `the lane wrote one record\n${all()}`);
  const { record } = records[0];
  const own = (record?.tests ?? []).filter(({ id }) => String(id).startsWith(`${TEST_FILE} › `));
  assert.ok(own.length > 0 && own.every(({ state }) => state === 'PASS'), `the record holds the lane's test, passed\n${all()}`);
  assert.equal(record.state, 'PASS', `the record reads by its tests: PASS\n${all()}`);
  assert.equal(record.lane, LANE, `the record is the lane's\n${all()}`);
  const stops = (record.findings ?? []).filter(({ note }) => /\bstop/i.test(String(note)));
  assert.deepEqual(stops, [], `the record holds no stop finding\n${all()}`);

  // The watch saw the run: the lane's own command ran under lanes.mjs.
  assert.ok(tree.some(({ pid }) => procs.some((proc) => proc.role === 'runner' && proc.pid === pid)), `the test saw the lane's command run under lanes.mjs\n${all()}`);
  // 5 s after the run's end, nothing that ran under it, the stop included, still runs.
  // deadline: the criterion's own window: 5 s after the run ends nothing of it may still run.
  await new Promise((done) => setTimeout(done, 5_000));
  const left = tree.filter(alive);
  assert.deepEqual(left.map(({ pid }) => `${pid} (${commandOf(pid)})`), [], `processes of the run are still running 5 s after it ended\n${all()}`);
});
