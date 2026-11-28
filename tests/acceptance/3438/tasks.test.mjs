// #3438 criteria 2, 3 and 4 (README.md): the tasks of benchmarks/budgets.json the budget window takes their readings
// with. The window proves a criterion only through a task that names it and that it ran, so each reading the criteria
// name is a target of one such task, with the criterion's value, judged by the task's own judge; and the tasks that
// start the hub as a child each name the criterion that holds them to the merge base. No test here takes a reading or
// starts a hub: each reads the manifest, and asks a task's judge about a report with no readings. A test whose
// assertions hold ends INCONCLUSIVE, naming the tasks that take the reading: a test never stands in for the window.
import { test } from 'node:test';
import { C2, C3, C4, REFERENCE, assert, judge, launchdTasks, manifest, said, windowReads } from './helpers.mjs';

/** A judge that read no sample never passes: no report, an empty one, and one with a machine and nothing read. */
function nothingReadNeverPasses(task) {
  for (const [what, current] of [['no report', null], ['an empty report', {}], ['a report with no hub and no readings', { task: task.id, machine: { ...REFERENCE }, hub: null, readings: {}, asks: [] }]]) {
    const verdict = judge(task, current);
    assert.notEqual(verdict.status, 'PASS', `${task.id}: its judge reads PASS on ${what}, where nothing was read: ${said(verdict)}`);
  }
}

test('#3438.e9cc07fb benchmarks/budgets.json holds one task for each reading on a hub launchd started: hook_overhead_p95_ms 10, idle_cpu_percent 0.5, round_trip_p50_ratio 1.5 and record_append_p50_ratio 1.5, and a judge that passes nothing unread', { timeout: 600_000 }, (t) => {
  const tasks = launchdTasks(C2);
  for (const task of tasks) nothingReadNeverPasses(task);
  t.skip(windowReads(C2, tasks));
});

test('#3438.65e37fd0 benchmarks/budgets.json holds one task for each command the launchd-started hub starts: spin_ratio 1.2 and write_sync_ratio 1.2, and a judge that passes nothing unread', { timeout: 600_000 }, (t) => {
  const tasks = launchdTasks(C3);
  for (const task of tasks) nothingReadNeverPasses(task);
  t.skip(windowReads(C3, tasks));
});

test('#3438.ac71a3bd every task of benchmarks/hub.mjs that starts the hub as its child, hub-round-trip among them, names the criterion, so the window reads each within its margin of the merge base', { timeout: 60_000 }, (t) => {
  const { tasks } = manifest();
  const reads = (task, criterion) => Array.isArray(task.criteria) && task.criteria.includes(criterion);
  // The hub bench's tasks, less any that reads a hub launchd started: those are criteria 2 and 3's.
  const children = tasks.filter((task) => Array.isArray(task.command) && task.command[1] === 'benchmarks/hub.mjs' && !reads(task, C2) && !reads(task, C3));
  const roundTrip = children.find(({ id }) => id === 'hub-round-trip');
  assert.ok(roundTrip, `benchmarks/budgets.json still holds hub-round-trip, the task criterion 2 reads beside the launchd-started hub, as a task of benchmarks/hub.mjs that starts its hub as a child: ${children.map(({ id }) => id).join(', ') || 'no such task is left'}`);
  assert.deepEqual(roundTrip.command, ['node', 'benchmarks/hub.mjs', 'round-trip'], 'hub-round-trip runs as before: one process that starts the hub as its child');
  const unnamed = children.filter((task) => !reads(task, C4)).map(({ id }) => id);
  assert.deepEqual(unnamed, [], `each task of benchmarks/hub.mjs that starts the hub as a child names ${C4} in its criteria, or the window reads the criterion measured on the tasks that do and never on these: ${unnamed.join(', ')}`);
  const margins = children.filter((task) => !Number.isFinite(task.margin) || task.margin < 0).map(({ id }) => id);
  assert.deepEqual(margins, [], `each such task has the margin the window reads it within: ${margins.join(', ')}`);
  t.skip(windowReads(C4, children));
});
