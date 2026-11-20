// #1872, criterion 5: `affected.mjs --record` goes, so `node scripts/affected.mjs --record` on a fixture with a failing
// test leaves scripts/known-failures.json byte for byte as it was. Reached by running this checkout's real
// affected.mjs in a scratch tree (README: The scratch tree).
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, dump, failIds, idOf, KNOWN, known, LONG, nodeFile, note, readKnown, sandbox, tree } from './helpers.mjs';

const FILE = 'tests/fixture-1872/record.test.mjs';
const ID = idOf(FILE, 'the failure --record would write');

test('#1872.0de0dcd9 node scripts/affected.mjs --record on a fixture with a failing test leaves scripts/known-failures.json byte for byte as it was', LONG, async (t) => {
  const box = sandbox(t);
  // A file main already holds, with an entry under each key and a layout of its own, so a rewrite of any of it shows.
  const listed = idOf('tests/fixture-1872/listed.test.mjs', 'a listed test');
  const start = known({ failures: { [listed]: note('fails on main') }, lint: { 'fixture-check: src/a.rs a finding': 1 }, timing: [listed] }).replace(/\n\s*"timing"/, '\n\n  "timing"');
  const fixture = tree(box, { [FILE]: nodeFile(`test(${JSON.stringify('the failure --record would write')}, () => { assert.equal(1, 2); });`) }, start);
  const before = readKnown(fixture);

  // The fixture's test does fail, as affected.mjs reads it, so --record has a failure it could write.
  const plain = await affected(box, fixture, [FILE]);
  assert.ok(failIds(plain.stdout).includes(ID), `affected.mjs did not see the fixture's failure, so this scene shows nothing\n${dump(plain)}`);
  assert.deepEqual(readKnown(fixture), before, `affected.mjs with no flag changed ${KNOWN}\n${dump(plain)}`);

  const recorded = await affected(box, fixture, ['--record', FILE]);
  const after = readKnown(fixture);
  assert.ok(after.equals(before), `--record changed ${KNOWN}:\n--- before\n${before}\n--- after\n${after}\n${dump(recorded)}`);
});
