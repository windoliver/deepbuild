// #3334: the far end of a remote lane waits for its build grants on a stall, not a clock, and a missing grant reads
// INCONCLUSIVE with a record (docs/parallel-proof.md, sections 6 and 8). The real
// `node scripts/lane-remote.mjs --host <host> unit` runs in a session's worktree through the #1122 fixture far machine:
// `ssh` runs the far end on this machine under the far HOME, whose throttle table is that HOME's own.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { dump, nodeFile, exactTree, here, HOST, lanesFolder, laneRemote, lines, ran, recordLine, sandbox, worktree } from '../1122/helpers.mjs';
import { npmCalls, readyFar, showLog, STALL, stillLine, within } from './helpers.mjs';

// A test of the lane that notes its run in its machine's HOME, so what ran, and where, is seen apart from any record.
const NOTED = { 'tests/noted-3334.test.mjs': nodeFile("test('a test of the lane notes its run', () => { ran1122('noted'); assert.equal(1, 1); });") };
const LONG = { timeout: 900_000 };

/** The near end's run, bounded: null when it is still running past `minutes`. */
const nearEnd = (box, session, minutes) => within(laneRemote(box, session.cwd, ['--host', HOST, 'unit']), minutes);
const ranLane = (box) => ran(box.far).concat(ran(box.home));

test('#3334.f5046205 a far end whose build queue stalls past the bound reads INCONCLUSIVE on the near end, exits 2, and its fetched record names the holder', LONG, async (t) => {
  const box = sandbox(t);
  const table = readyFar(box);
  const session = worktree(box, { files: NOTED });
  const tree = exactTree(box, session.cwd);
  // Every build slot of the far machine held for ten minutes, past the bound, and nothing else in its table.
  const holders = await stillLine(box, { table, home: box.far });
  assert.ok(holders.every(Boolean), `every far holder took its build grant\n${holders.map((holder) => holder?.child.output()).join('\n')}\n${showLog(table)}`);

  const run = await nearEnd(box, session, 6);
  const all = () => `${run ? dump(run) : 'the near end was still running after 6 min'}\nnpm: ${JSON.stringify(npmCalls(box))}\n${showLog(table)}`;
  assert.ok(run, `the near end ended within 6 minutes of a stall bound of ${STALL} min\n${all()}`);
  assert.ok(lines(run).includes(`INCONCLUSIVE unit on ${here}`), `the near end prints "INCONCLUSIVE unit on ${here}"\n${all()}`);
  assert.equal(run.status, 2, `the near end exits 2 on INCONCLUSIVE\n${all()}`);

  const path = recordLine(run);
  assert.equal(path, join(lanesFolder(box.home), `${tree}-unit-${here}.json`), `the near end names the fetched record\n${all()}`);
  assert.ok(existsSync(path), `the fetched record exists\n${all()}`);
  const found = JSON.parse(readFileSync(path, 'utf8'));
  const shown = `${all()}\nrecord: ${JSON.stringify(found, null, 1)}`;
  assert.equal(found.state, 'INCONCLUSIVE', `the fetched record reads INCONCLUSIVE\n${shown}`);
  assert.deepEqual(found.tests ?? [], [], `the record holds no rows\n${shown}`);
  assert.equal(found.findings?.length, 1, `the record holds one finding\n${shown}`);
  const [finding] = found.findings;
  assert.equal(finding.state, 'INCONCLUSIVE', `the finding is INCONCLUSIVE\n${shown}`);
  const head = `INCONCLUSIVE no grant: no build grant changed hands within ${STALL} min`;
  assert.ok(String(finding.note).startsWith(head), `the finding's note is the throttle's line, "${head}…"\n${shown}`);
  for (const holder of holders) {
    const named = String(finding.note).match(new RegExp(`; blocked by build grant ${holder.id} held by pid ${holder.pid} since \\S+ \\(([^)]*)\\)`));
    assert.ok(named?.[1].includes(holder.name), `the note names the holder ${holder.name}: build grant ${holder.id}, pid ${holder.pid} and its command\n${shown}`);
  }
  assert.equal(found.tree, tree, `the record is of the shipped tree\n${shown}`);
  assert.ok(found.bundle && found.recipe, `the far end added bundle and recipe\n${shown}`);
  assert.equal(found.recipe.commit, session.head, `the recipe names the shipped commit\n${shown}`);

  assert.deepEqual(ranLane(box), [], `the lane's own command never ran\n${shown}`);
  assert.deepEqual(npmCalls(box).map(({ args }) => args), [], `neither npm ci nor the packages' build ran\n${shown}`);
});
