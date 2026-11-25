// #3334: the far end of a remote lane waits for its build grants on a stall, not a clock, and a missing grant reads
// INCONCLUSIVE with a record (docs/parallel-proof.md, sections 6 and 8). The real
// `node scripts/lane-remote.mjs --host <host> unit` runs in a session's worktree through the #1122 fixture far machine:
// `ssh` runs the far end on this machine under the far HOME, whose throttle table is that HOME's own.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { dump, nodeFile, here, HOST, laneRemote, lines, ran, sandbox, verdictLine, worktree } from '../1122/helpers.mjs';
import { npmCalls, readyFar, within } from './helpers.mjs';

// A test of the lane that notes its run in its machine's HOME, so what ran, and where, is seen apart from any record.
const NOTED = { 'tests/noted-3334.test.mjs': nodeFile("test('a test of the lane notes its run', () => { ran1122('noted'); assert.equal(1, 1); });") };
const LONG = { timeout: 900_000 };

/** The near end's run, bounded: null when it is still running past `minutes`. */
const nearEnd = (box, session, minutes) => within(laneRemote(box, session.cwd, ['--host', HOST, 'unit']), minutes);
const ranLane = (box) => ran(box.far).concat(ran(box.home));

test('#3334.5d28f79a a far-end npm ci that itself fails still reads BLOCKED lane-remote and exits 3', LONG, async (t) => {
  const box = sandbox(t);
  readyFar(box);
  writeFileSync(join(box.far, '.npm-ci-fails-3334'), '');
  const session = worktree(box, { files: NOTED });

  const run = await nearEnd(box, session, 10);
  const all = () => `${run ? dump(run) : 'the near end was still running after 10 min'}\nnpm: ${JSON.stringify(npmCalls(box))}`;
  assert.ok(run, `the near end ended\n${all()}`);
  assert.ok(npmCalls(box).some(({ args }) => args === 'ci'), `the far end ran npm ci, and it failed\n${all()}`);
  assert.ok(lines(run).some((text) => text.startsWith('BLOCKED lane-remote')), `the run reads "BLOCKED lane-remote"\n${all()}`);
  assert.equal(verdictLine(run, 'unit', ` on ${here}`), null, `the near end prints no "<STATE> unit on <host>" of a record: a failed install is no INCONCLUSIVE\n${all()}`);
  assert.equal(run.status, 3, `the near end exits 3\n${all()}`);
  assert.deepEqual(ranLane(box), [], `the lane's own command never ran\n${all()}`);
});
