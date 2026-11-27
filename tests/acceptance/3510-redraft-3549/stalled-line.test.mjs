// Blind redraft (#3549) of #3510's stalled-line test: every build slot is the limit scripts/throttle.mjs states for this platform
// on its LIMITS line (../3334-redraft-3549/helpers.mjs buildLimit), not SLOTS's hard-coded 1 or 2. Name, criterion,
// waits, assertions and expected values are the original's (../3510/stalled-line.test.mjs), line for line; only the count differs.
// #3510: a buildBinaries call whose line stalls reads INCONCLUSIVE, with the stall's words, and builds nothing
// (docs/parallel-proof.md, section 6). Every build slot of the test's own table is held for ten minutes and nothing
// else changes; the real buildBinaries, with DEEP_TEST_GRANT_STALL at 0.05 (3 s), must throw within 5 minutes.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { BIN, binHolds, call, entriesOf, fixture, holders, LONG, sandbox, showLog } from '../3510/helpers.mjs';
import { buildLimit } from '../3334-redraft-3549/helpers.mjs';

const STALL = '0.05';

test('#3510.9618ba88 with DEEP_TEST_GRANT_STALL at 0.05 and every build slot held past the bound, a buildBinaries call throws INCONCLUSIVE no grant: no build grant changed hands within 0.05 min for test binaries within 5 minutes, cargo never starts, bin holds no binary, and its timeout entry carries stall 0.05', LONG, async (t) => {
  const box = sandbox(t);
  const fx = fixture(box);
  const held = await holders(box, buildLimit());
  assert.ok(held.every(Boolean), `every holder took its build grant\n${held.map((holder) => holder?.child.output()).join('\n')}\n${showLog(box.table)}`);

  const request = call(box, fx, { env: { DEEP_TEST_GRANT_STALL: STALL } });
  const pid = await request.callerPid();
  const ended = await request.ended(5);
  const all = () => `call: ${ended ? ended.text : `still waiting after 5 min\n${request.output()}`}\n${showLog(box.table)}`;
  assert.ok(pid, `the caller started and was about to call buildBinaries\n${all()}`);
  assert.ok(ended, `the call behind a line that never moved threw within 5 minutes of a stall bound of ${STALL} min\n${all()}`);
  const head = `INCONCLUSIVE no grant: no build grant changed hands within ${STALL} min for test binaries`;
  assert.equal(ended.returned, undefined, `the call returns nothing: it got no grant\n${all()}`);
  assert.ok(typeof ended.threw === 'string' && ended.threw.startsWith(head), `buildBinaries throws an error whose message starts "${head}"; it threw ${JSON.stringify(ended.threw)}\n${all()}`);

  // Nothing was built: the build was never started, cargo left nothing in the fixture, and bin holds no binary.
  assert.ok(!existsSync(fx.marker), `the call never started its build (its run argument was never called)\n${all()}`);
  assert.ok(!existsSync(join(fx.cwd, 'target')), `cargo never started in the fixture repository: it holds no target/\n${all()}`);
  assert.ok(!binHolds(fx).includes(BIN), `bin holds no binary\n${all()}`);
  assert.deepEqual(binHolds(fx).filter((name) => !name.startsWith('.')), [], `bin holds nothing built\n${all()}`);

  const log = entriesOf(box, pid);
  const timeouts = log.filter((entry) => entry.event === 'timeout');
  assert.equal(timeouts.length, 1, `the log holds one timeout entry for the call's build request\n${all()}`);
  assert.equal(timeouts[0].stall, Number(STALL), `the call's timeout entry carries stall: ${STALL}\n${all()}`);
  assert.ok(!('wait' in timeouts[0]), `the call's timeout entry carries no wait\n${all()}`);
  assert.deepEqual(log.filter((entry) => entry.event === 'granted'), [], `the call was never granted\n${all()}`);
});
