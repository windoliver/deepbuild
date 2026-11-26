// #3334: the far end of a remote lane waits for its build grants on a stall, not a clock, and a missing grant reads
// INCONCLUSIVE with a record (docs/parallel-proof.md, sections 6 and 8). The real
// `node scripts/lane-remote.mjs --host <host> unit` runs in a session's worktree through the #1122 fixture far machine:
// `ssh` runs the far end on this machine under the far HOME, whose throttle table is that HOME's own.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { dump, nodeFile, exactTree, here, HOST, lanesFolder, laneRemote, ran, recordLine, sandbox, verdictLine, worktree } from '../1122/helpers.mjs';
import { grantsIn, movingLine, npmCalls, readyFar, showLog, SLOTS, within } from './helpers.mjs';

// A test of the lane that notes its run in its machine's HOME, so what ran, and where, is seen apart from any record.
const NOTED = { 'tests/noted-3334.test.mjs': nodeFile("test('a test of the lane notes its run', () => { ran1122('noted'); assert.equal(1, 1); });") };
const LONG = { timeout: 1_020_000 };

/** The near end's run, bounded: null when it is still running past `minutes`. */
const nearEnd = (box, session, minutes) => within(laneRemote(box, session.cwd, ['--host', HOST, 'unit']), minutes);

test('#3334.e38df940 a remote lane whose far-end npm ci waits behind a build queue that keeps moving past the stall bound gets its grant and reads the lane\'s own state', LONG, async (t) => {
  const box = sandbox(t);
  const table = readyFar(box);
  const session = worktree(box, { files: NOTED });
  const tree = exactTree(box, session.cwd);
  // The far machine's build queue keeps six holders a slot waiting, each grant held about 2 s, until npm ci starts.
  const line = movingLine(box, { table, home: box.far, stop: join(box.log, 'npm-ci-ran') });
  assert.ok(await within(line.line(/^READY /), 2), `the far machine's build queue never moved within 2 min\n${line.output()}\n${showLog(table)}`);

  const run = await nearEnd(box, session, 12);
  const all = () => `${run ? dump(run) : 'the near end was still running after 12 min'}\nline:\n${line.output()}\nnpm: ${JSON.stringify(npmCalls(box))}\n${showLog(table)}`;
  assert.ok(run, `the near end ended\n${all()}`);
  assert.equal(verdictLine(run, 'unit', ` on ${here}`), 'PASS', `the near end prints the lane's own state, "PASS unit on ${here}", not BLOCKED or INCONCLUSIVE\n${all()}`);
  assert.equal(run.status, 0, `the near end exits 0 on the lane's PASS\n${all()}`);
  const path = recordLine(run);
  assert.equal(path, join(lanesFolder(box.home), `${tree}-unit-${here}.json`), `the near end names the fetched record\n${all()}`);
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).state, 'PASS', `the fetched record reads the lane's state\n${all()}`);
  assert.ok(ran(box.far).some(({ name }) => name === 'noted'), `the lane's tests ran on the far machine\n${all()}`);

  // npm ci ran under a build grant of the far machine's table, after holders' grants had changed hands there.
  const ci = npmCalls(box).find(({ args }) => args === 'ci');
  assert.match(String(ci?.grant), /^build:\S+$/, `the far end's npm ci ran under a build grant\n${all()}`);
  const at = grantsIn(table).findIndex((entry) => `build:${entry.id}` === ci.grant);
  assert.ok(at >= 3 * SLOTS, `npm ci's grant came behind at least ${3 * SLOTS} holders' grants in the far machine's queue; it was grant ${at}\n${all()}`);
});
