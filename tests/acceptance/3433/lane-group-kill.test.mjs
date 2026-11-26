// #3433: a lane run stopped by SIGKILL to the lanes.mjs process's whole process group (a group this test made: the
// lanes.mjs process leads it) stops everything its command started that the group kill left, and its record reads
// INCONCLUSIVE naming them (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, GRANDCHILD, names, stoppedLane } from './helpers.mjs';

test('#3433.d424696d the same lane run stopped by SIGKILL to the lanes.mjs process\'s whole group leaves no process its command started alive 15 s later, and the record reads INCONCLUSIVE naming them', { timeout: 300_000 }, async (t) => {
  // A negative PID reaches the group: only ever the group the test's own lanes.mjs process leads, never 0 or -1.
  const run = await stoppedLane(t, 'lane-group-kill', (pid) => {
    if (!(Number.isSafeInteger(pid) && pid > 1)) throw Error(`no group of the test's own to stop: ${pid}`);
    process.kill(-pid, 'SIGKILL');
  });
  const all = () => dump(run.lane, run.fixture, run.procs);
  assert.ok(run.ready, `the lane's command, its test file and the grandchild were running before the stop\n${all()}`);
  assert.deepEqual(run.left.map(({ role, pid }) => `${role} ${pid}`), [], `15 s after SIGKILL to lanes.mjs's group, processes its command started still run\n${all()}`);
  assert.equal(run.records.length, 1, `the lane's record was written under the run's HOME\n${all()}`);
  const { record } = run.records[0];
  assert.equal(record?.state, 'INCONCLUSIVE', `the stopped lane's record reads INCONCLUSIVE\n${all()}`);
  const stops = (record.findings ?? []).filter(({ note }) => /\bstop/i.test(String(note)));
  assert.ok(stops.length > 0, `the record holds a finding that the run was stopped\n${all()}`);
  // The group kill itself ended the processes in lanes.mjs's group; the grandchild, in a group of its own, is the one
  // the stop must have ended.
  const grandchild = run.procs.find(({ role }) => role === 'grandchild');
  assert.ok(names(stops.map(({ note }) => String(note)).join('\n'), grandchild.pid, GRANDCHILD), `the stop finding names the grandchild it stopped, pid ${grandchild.pid} with its command (${GRANDCHILD}), on one line\n${all()}`);
});
