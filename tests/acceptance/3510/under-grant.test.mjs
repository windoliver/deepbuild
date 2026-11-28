import assert from 'node:assert/strict';
import test from 'node:test';
import { builtIn, call, entriesOf, fixture, holders, LONG, sandbox, showLog, SLOTS, tableLog, THROTTLE } from './helpers.mjs';

test('#3510.87170af2 with every build slot held, a buildBinaries call made by the command of throttle.mjs build that holds one of them returns its bin holding the binary: the log reads passed for its request and no second granted for its process', LONG, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  const others = await holders(box, SLOTS - 1);
  assert.ok(others.every(Boolean), `every other holder took its build grant\n${others.map((holder) => holder?.child.output()).join('\n')}\n${showLog(box.table)}`);

  const request = call(box, fx, { under: [process.execPath, THROTTLE, 'build', '--'] });
  const pid = await request.callerPid();
  const ended = await request.ended(10);
  const all = () => `call: ${ended ? ended.text : `still running after 10 min\n${request.output()}`}\n${showLog(box.table)}`;
  assert.ok(pid, `the wrapper got the last build slot and its command was about to call buildBinaries\n${all()}`);
  assert.ok(ended, `the call under its caller's grant ended within 10 minutes\n${all()}`);
  assert.equal(ended.status, 0, `the wrapper exits with its command's status\n${all()}`);
  builtIn(assert, fx, ended, all);

  const log = tableLog(box.table);
  const builds = log.filter((entry) => entry.event === 'granted' && entry.class === 'build');
  const wrapper = builds.filter((entry) => entry.pid === request.pid);
  assert.equal(wrapper.length, 1, `the wrapper took one top-level build grant\n${all()}`);
  assert.equal(builds.length, SLOTS, `every build slot is held, ${SLOTS - 1} by others and one by the wrapper, and nothing else was granted\n${all()}`);
  const passed = entriesOf(box, pid).filter((entry) => entry.event === 'passed');
  assert.ok(passed.length >= 1, `the log reads passed for the call's build request\n${all()}`);
  assert.equal(passed[0].through, `build:${wrapper[0].id}`, `the call passed through on the wrapper's grant\n${all()}`);
  assert.deepEqual(entriesOf(box, pid).filter((entry) => entry.event === 'granted' || entry.event === 'timeout'), [], `the call's own process was granted nothing and timed out on nothing\n${all()}`);
  for (const other of others) assert.ok(!log.some((entry) => entry.event === 'released' && entry.id === other.id), `holder ${other.name} still held its slot when the call returned\n${all()}`);
});
