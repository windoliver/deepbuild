// Blind redraft (#3549) of #3510's drain test: every build slot is the limit scripts/throttle.mjs states for this platform
// on its LIMITS line (../3334-redraft-3549/helpers.mjs buildLimit), not SLOTS's hard-coded 1 or 2. Name, criterion,
// waits, assertions and expected values are the original's (../3510/drain.test.mjs), line for line; only the count differs.
// #3510: the drain is unchanged (docs/parallel-proof.md, section 6, Drain and a stuck drain). A buildBinaries call with
// DEEP_TEST_GRANT_STALL at 0.2 (12 s) waits behind build holders that keep every slot for 8 s; a top-level
// `throttle.mjs timed --wait 0.05` request made after the call joined the line runs out behind those holders, and the
// call, still in line, then gets its build grant.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import test from 'node:test';
import { builtIn, call, EIGHT_SECONDS, entriesOf, fixture, holders, joined, lines, LONG, sandbox, showLog, start, tableLog, THROTTLE, within } from '../3510/helpers.mjs';
import { buildLimit } from '../3334-redraft-3549/helpers.mjs';

test('#3510.773f906e with DEEP_TEST_GRANT_STALL at 0.2 and every build slot held for 8 s, a top-level timed --wait 0.05 request made after the call joined the line ends INCONCLUSIVE no grant, and the call then gets its build grant and returns its bin holding the binary', LONG, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  // Each holder keeps its slot until the call is in line and for 8 s after, so the 8 s are all ahead of the call.
  const held = await holders(box, buildLimit(), EIGHT_SECONDS);
  assert.ok(held.every(Boolean), `every holder took its build grant\n${held.map((holder) => holder?.child.output()).join('\n')}\n${showLog(box.table)}`);

  const request = call(box, fx, { env: { DEEP_TEST_GRANT_STALL: '0.2' } });
  const pid = await request.callerPid();
  const inLine = pid ? await joined(box, request, pid) : null;
  writeFileSync(box.go, '');
  const timed = start(box, [process.execPath, THROTTLE, 'timed', '--wait', '0.05', '--', '/bin/sh', '-c', 'echo TIMED-RAN-3510']);
  const drained = await within(timed.done, 3);
  const ended = await request.ended(8);
  const all = () => `call: ${ended ? ended.text : `still running after 8 min\n${request.output()}`}\ntimed request: ${drained ? `exit ${drained.status}\n${drained.stdout}${drained.stderr}` : 'still waiting after 3 min'}\n${showLog(box.table)}`;
  assert.ok(pid, `the caller started and was about to call buildBinaries\n${all()}`);
  assert.equal(inLine, true, `the call joined the line behind the holders before the timed request was made\n${all()}`);

  assert.ok(drained, `the timed request ended within 3 minutes of a 0.05-min wait\n${all()}`);
  assert.equal(drained.status, 3, `the timed request exits 3, as a wait that ran out does\n${all()}`);
  assert.ok(lines(drained.stdout).some((line) => line.startsWith('INCONCLUSIVE no grant')), `the timed request ends INCONCLUSIVE no grant\n${all()}`);
  assert.ok(!lines(drained.stdout).includes('TIMED-RAN-3510'), `the timed request's command never ran\n${all()}`);

  assert.ok(ended, `the call ended within 8 minutes\n${all()}`);
  assert.equal(ended.threw, undefined, `the call kept its place while the holders held and the timed request drained; buildBinaries threw: ${ended.threw}\n${all()}`);
  builtIn(assert, fx, ended, all);

  // The order the criterion gives, in the table's log: the timed request's timeout, then the call's build grant,
  // which came only once a holder had given its slot back.
  const log = tableLog(box.table);
  const own = entriesOf(box, pid).filter((entry) => entry.event === 'granted');
  assert.equal(own.length, 1, `the log holds one granted entry for the call's build request\n${all()}`);
  const grantAt = log.findIndex((entry) => entry.event === 'granted' && entry.id === own[0].id);
  const timeout = log.findIndex((entry) => entry.event === 'timeout' && entry.class === 'timed' && entry.pid === timed.pid);
  assert.ok(timeout >= 0, `the log holds the timed request's timeout\n${all()}`);
  assert.ok(timeout < grantAt, `the call got its build grant after the timed request ended\n${all()}`);
  const released = log.findIndex((entry) => entry.event === 'released' && held.some((holder) => holder.id === entry.id));
  assert.ok(released >= 0 && released < grantAt, `the call got its build grant once a holder gave its slot back, not before\n${all()}`);
});
