// #1114: affected.mjs skips the timed files of its selection unless --timed, reading INCONCLUSIVE and listing them,
// and with --timed runs them under a timed grant the throttle log shows around them. Reached by running
// `node scripts/affected.mjs <paths>` in a scratch tree holding this checkout's scripts (README: The affected.mjs
// tree), with the real throttle.mjs and a sandboxed HOME.
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, affectedTree, dump, loaded, outsideTimedGrant, probe, runsOf, sandbox, summary, timedPath } from './helpers.mjs';

// The plain probe's path is no file any timed list names: a folder of its own under tests/.
const PLAIN = ['tests', 'fixture-1114', 'plain.test.mjs'].join('/');

function scene(t) {
  const box = sandbox(t);
  const TIMED = timedPath();
  const tree = affectedTree(box, {
    [TIMED]: probe('timed', 'the timed probe runs'),
    [PLAIN]: probe('plain', 'the plain probe runs'),
  });
  return { box, tree, TIMED };
}

test('#1114.9fc6be33 with no flag, a timed file in the affected set is not run and the summary is INCONCLUSIVE, listing it; with no timed file in the set, PASS remains possible', async (t) => {
  const { box, tree, TIMED } = scene(t);
  const listing = await affected(box, tree, ['--list', TIMED, PLAIN]);
  assert.ok(listing.stdout.includes(TIMED) && listing.stdout.includes(PLAIN), `affected.mjs --list did not select both probes\n${dump(box, listing)}`);

  const mixed = await affected(box, tree, [TIMED, PLAIN]);
  const all = dump(box, mixed);
  assert.equal(runsOf(box, 'timed').length, 0, `the timed file ${TIMED} ran without --timed\n${all}`);
  assert.equal(runsOf(box, 'plain').length, 1, `the untimed file ${PLAIN} did not run once\n${all}`);
  assert.match(summary(mixed.stdout), /^INCONCLUSIVE affected: /, `with a timed file unrun, the summary is not INCONCLUSIVE\n${all}`);
  assert.notEqual(mixed.status, 0, `with a timed file unrun, affected.mjs exited 0\n${all}`);
  const listed = mixed.stdout.split('\n').filter((line) => /^INCONCLUSIVE\b/.test(line) && line.includes(TIMED));
  assert.ok(listed.length, `no INCONCLUSIVE line lists the unrun timed file ${TIMED}\n${all}`);

  const plain = await affected(box, tree, [PLAIN]);
  const again = dump(box, plain);
  assert.equal(runsOf(box, 'plain').length, 2, `the untimed file did not run alone\n${again}`);
  assert.match(summary(plain.stdout), /^PASS affected: /, `with no timed file in the affected set, the summary is not PASS\n${again}`);
  assert.equal(plain.status, 0, again);
});

test('#1114.dc4376fb with --timed, the throttle log shows the timed grant around the timed files', async (t) => {
  const problem = loaded();
  if (problem) return t.skip(problem);
  const { box, tree, TIMED } = scene(t);
  const run = await affected(box, tree, ['--timed', TIMED, PLAIN]);
  const all = dump(box, run);
  const starts = runsOf(box, 'timed'), ends = runsOf(box, 'timed', 'end');
  assert.equal(starts.length, 1, `with --timed, the timed file ${TIMED} did not run once\n${all}`);
  assert.equal(ends.length, 1, `the timed file's test did not finish\n${all}`);
  const outside = outsideTimedGrant(box, starts[0], ends[0]);
  assert.equal(outside, null, `the timed file ran outside a timed grant: ${outside}\n${all}`);
  assert.equal(runsOf(box, 'plain').length, 1, `the untimed file did not run once\n${all}`);
  assert.match(summary(run.stdout), /^PASS affected: /, `with --timed and both files passing, the summary is not PASS\n${all}`);
});
