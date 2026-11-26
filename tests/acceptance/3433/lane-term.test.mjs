// #3433: a lane run stopped by SIGTERM to the lanes.mjs process alone stops everything its command started, those in a
// process group of their own too, and its record reads INCONCLUSIVE with a finding naming each process stopped (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { dump, GRANDCHILD, names, stoppedLane, TEST_FILE } from './helpers.mjs';

const FILE = TEST_FILE.split('/').at(-1);

test('#3433.46eec7ed a lanes.mjs lane run whose command starts a grandchild in a process group of its own, stopped by SIGTERM to the lanes.mjs process alone, leaves no process its command started alive 15 s later, and its record reads INCONCLUSIVE with a finding naming each process stopped, by PID and command', { timeout: 300_000 }, async (t) => {
  const run = await stoppedLane(t, 'lane-term', (pid) => process.kill(pid, 'SIGTERM'));
  const all = () => dump(run.lane, run.fixture, run.procs);
  assert.ok(run.ready, `the lane's command, its test file and the grandchild were running before the stop\n${all()}`);
  assert.deepEqual(run.left.map(({ role, pid }) => `${role} ${pid}`), [], `15 s after SIGTERM to lanes.mjs, processes its command started still run\n${all()}`);
  assert.equal(run.records.length, 1, `the lane wrote one record under the run's HOME\n${all()}`);
  const { record } = run.records[0];
  assert.equal(record?.state, 'INCONCLUSIVE', `the stopped lane's record reads INCONCLUSIVE\n${all()}`);
  const stops = (record.findings ?? []).filter(({ note }) => /\bstop/i.test(String(note)));
  assert.ok(stops.length > 0, `the record holds a finding that the run was stopped\n${all()}`);
  const notes = stops.map(({ note }) => String(note)).join('\n');
  const byRole = Object.fromEntries(run.procs.map((proc) => [proc.role, proc]));
  for (const [role, word] of [['file', FILE], ['grandchild', GRANDCHILD]]) {
    assert.ok(names(notes, byRole[role].pid, word), `the stop finding names the ${role} process it stopped, pid ${byRole[role].pid} with its command (${word}), on one line\n${all()}`);
  }
});
