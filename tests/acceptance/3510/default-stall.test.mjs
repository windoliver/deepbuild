import assert from 'node:assert/strict';
import test from 'node:test';
import { builtIn, call, entriesOf, fixture, LONG, sandbox, showLog } from './helpers.mjs';

test('#3510.7fd1b181 with DEEP_TEST_GRANT_STALL unset and the table empty, a buildBinaries call returns its bin holding the binary, and its top-level build grant is logged with stall 720 and no wait', LONG, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  const request = call(box, fx);
  const pid = await request.callerPid();
  const ended = await request.ended(10);
  const all = () => `call: ${ended ? ended.text : `still running after 10 min\n${request.output()}`}\n${showLog(box.table)}`;
  assert.ok(pid, `the caller started and was about to call buildBinaries\n${all()}`);
  assert.ok(ended, `the call on an empty table ended within 10 minutes\n${all()}`);
  builtIn(assert, fx, ended, all);

  const granted = entriesOf(box, pid).filter((entry) => entry.event === 'granted');
  assert.equal(granted.length, 1, `the log holds one granted entry for the call's build request\n${all()}`);
  assert.equal(granted[0].grant, 'top-level', `the call's request is a top-level one\n${all()}`);
  assert.equal(granted[0].stall, 720, `the call's granted entry carries stall: 720\n${all()}`);
  assert.ok(!('wait' in granted[0]), `the call's granted entry carries no wait (it carries wait: ${granted[0].wait})\n${all()}`);
});
