// #1122: how a tree's records merge (docs/parallel-proof.md, section 8, "How records merge"). Records are planted where
// the lanes write them, in the sandbox's ~/.deepbuild/lanes/: the Mac's as <tree>-<lane>.json and the one fetched from
// the Spark as <tree>-<lane>-spark.json. The real mergeRecords(tree) of scripts/lanes.mjs reads them, in a child.
// These run on any machine: they read records, and run no lane.
import assert from 'node:assert/strict';
import test from 'node:test';
import { idOf, macRecord, madeTree, mergeOf, plant, sandbox, sparkRecord } from './helpers.mjs';

const A = idOf('tests/a.test.ts', 'reads the file');
const X = idOf('tests/x.test.ts', 'writes the file');
const shown = (merged) => JSON.stringify(merged);

test('#1122.e6c3b0b8 a Spark FAIL and a Mac pass of the same test id merge to FAIL, naming the lane', (t) => {
  const box = sandbox(t);
  const tree = madeTree('spark fail, mac pass');
  plant(box.home, sparkRecord(tree, 'unit', 'FAIL', [{ id: A, state: 'PASS' }, { id: X, state: 'FAIL', note: 'expected 1 to be 2' }]));
  // The Mac's --only run of the same id, which passed there.
  plant(box.home, macRecord(tree, 'unit', 'PASS', [{ id: X, state: 'PASS' }], { only: ['tests/x.test.ts'] }));
  const merged = mergeOf(box, tree);
  assert.equal(merged.state, 'FAIL', `the Spark's FAIL of ${X} wins over the Mac's pass of it: ${shown(merged)}`);
  assert.ok(Array.isArray(merged.lanes) && merged.lanes.includes('unit'), `the merge names the lane holding the FAIL: ${shown(merged)}`);
});

test('#1122.7d260bb4 a row the Mac ran stands over the Spark\'s skipped row of the same id, so the merge reads PASS as a full Mac run does', (t) => {
  const box = sandbox(t);
  const tree = madeTree('ran over skipped');
  // The Spark's lane is INCONCLUSIVE (platform) by its one skip; the Mac's --only run ran that test, and it passed.
  plant(box.home, sparkRecord(tree, 'unit', 'INCONCLUSIVE', [{ id: A, state: 'PASS' }, { id: X, state: 'INCONCLUSIVE', note: 'INCONCLUSIVE: no Metal on this machine', skipped: true }]));
  plant(box.home, macRecord(tree, 'unit', 'PASS', [{ id: X, state: 'PASS' }], { only: ['tests/x.test.ts'] }));
  const merged = mergeOf(box, tree);
  assert.equal(merged.state, 'PASS', `every test id ran and passed on one machine or the other, as on a full Mac run: ${shown(merged)}`);
});

test('#1122.7d260bb4 a lane with a Spark record and none from a Mac is never PASS: it reads INCONCLUSIVE', (t) => {
  const box = sandbox(t);
  const tree = madeTree('spark alone');
  plant(box.home, sparkRecord(tree, 'unit', 'PASS', [{ id: A, state: 'PASS' }, { id: X, state: 'PASS' }]));
  const merged = mergeOf(box, tree);
  assert.equal(merged.state, 'INCONCLUSIVE', `what only the Mac can run is unrun, so the tree is not PASS: ${shown(merged)}`);
  assert.ok(Array.isArray(merged.lanes) && merged.lanes.includes('unit'), `the merge names the lane: ${shown(merged)}`);
});

test('#1122.821346f6 a Spark lint FAIL beside the Mac\'s lint PASS leaves the lint verdict the Mac\'s, and the Mac\'s lint FAIL stands beside a Spark PASS', (t) => {
  const box = sandbox(t);
  const reading = madeTree('spark lint fail');
  plant(box.home, sparkRecord(reading, 'lint', 'FAIL', []));
  plant(box.home, macRecord(reading, 'lint', 'PASS', []));
  const left = mergeOf(box, reading);
  assert.equal(left.state, 'PASS', `the Spark's lint record is a reading, left out whatever its state: ${shown(left)}`);
  const verdict = madeTree('mac lint fail');
  plant(box.home, sparkRecord(verdict, 'lint', 'PASS', []));
  plant(box.home, macRecord(verdict, 'lint', 'FAIL', []));
  const stands = mergeOf(box, verdict);
  assert.equal(stands.state, 'FAIL', `the Mac's lint record is the lint verdict: ${shown(stands)}`);
  assert.ok(Array.isArray(stands.lanes) && stands.lanes.includes('lint'), `the merge names lint: ${shown(stands)}`);
});

test('#1122.821346f6 a Spark lint PASS with no Mac lint record is no lint verdict: the tree reads INCONCLUSIVE, naming lint', (t) => {
  const box = sandbox(t);
  const tree = madeTree('spark lint alone');
  plant(box.home, sparkRecord(tree, 'lint', 'PASS', []));
  // The unit lane is whole: the Spark's run and the Mac's.
  plant(box.home, sparkRecord(tree, 'unit', 'PASS', [{ id: A, state: 'PASS' }]));
  plant(box.home, macRecord(tree, 'unit', 'PASS', [{ id: A, state: 'PASS' }]));
  const merged = mergeOf(box, tree);
  assert.equal(merged.state, 'INCONCLUSIVE', `a Spark lint PASS never counts as the lint verdict: ${shown(merged)}`);
  assert.deepEqual(merged.lanes, ['lint'], `lint is the lane that holds the tree INCONCLUSIVE: ${shown(merged)}`);
});
