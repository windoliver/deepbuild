// #3065 #3065.f0068a87 (compare's half) and #3065.b2bdedd7: `node scripts/reach.mjs compare <path ...>` against the
// record of one recording run, with `node scripts/affected.mjs --list <path ...>` as the selection. A blind redraft of
// tests/acceptance/3065/compare.test.mjs (REDRAFT.md): the same scenes, surfaces, assertions and expected values, with
// each test named by its criterion's ID. One fixture and one recording serve every test of this file.
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { CANVAS, cleanup, compare, DOC, HUB, listed, only, recorded, T, TEST, theRecord } from '../3065/helpers.mjs';

after(cleanup);

for (const [which, why] of [['unrun', "didn't run"], ['skipped', 'was skipped'], ['killed', 'had its process killed']]) {
  test(`#3065.f0068a87 compare counts a selected test file that ${why}, with no row, as reaching the change`, TEST, async () => {
    const shared = await recorded();
    theRecord(shared);
    const change = only(which);
    const selection = await listed(shared, [change]);
    assert.deepEqual(selection.tests, [T[which]], `the fixture is not what this test needs: affected.mjs --list ${change} selects\n${selection.stdout}`);
    const counts = await compare(shared, [change]);
    assert.equal(counts.selected, 1, `affected.mjs selects 1 test file for ${change}, ${T[which]}, and compare says ${counts.selected} selected\n${counts.said}`);
    assert.equal(counts.reaching, 1, `${T[which]} ${why} and has no row, so it counts as reaching ${change}; compare says ${counts.reaching} recorded as reaching\n${counts.said}`);
    assert.equal(counts.notReaching, 0, `${T[which]} ${why} and has no row, so it counts as reaching ${change}; compare says ${counts.notReaching} recorded as not reaching\n${counts.said}`);
  });
}

// #2673's three fixture changes, each one line: in one hub source file, in one canvas crate and in one design doc.
// `reaching` and `notReaching` are the selected test files with a row; `noRow` the selected ones with none.
const CHANGES = [
  { name: 'the hub source file', path: HUB, reaching: [T.hubChild, T.hubLoaded], notReaching: [T.hubNamed], noRow: [T.killed, T.skipped, T.unrun] },
  { name: 'the canvas crate', path: CANVAS, reaching: [T.canvasStarted], notReaching: [T.canvasNamed], noRow: [T.unrun] },
  { name: 'the design doc', path: DOC, reaching: [], notReaching: [], noRow: [] },
];

for (const change of CHANGES) {
  test(`#3065.b2bdedd7 compare on a one-line change to ${change.name} prints selected, recorded as reaching and recorded as not reaching, summing to selected`, TEST, async () => {
    const shared = await recorded();
    theRecord(shared);
    const selection = await listed(shared, [change.path]);
    const files = [...change.reaching, ...change.notReaching, ...change.noRow].sort();
    assert.deepEqual(selection.tests, files, `the fixture is not what this test needs: affected.mjs --list ${change.path} selects\n${selection.stdout}`);
    assert.deepEqual(selection.wide, [], `the fixture is not what this test needs: affected.mjs --list ${change.path} has a WIDE line\n${selection.stdout}`);
    const counts = await compare(shared, [change.path]);
    // The issue counts tests; whether a selected crate (`parallel cargo test:`) is one of them it leaves open. A crate
    // has no row, so where compare counts it, it counts as reaching.
    const crates = counts.selected - files.length;
    assert.ok(crates === 0 || crates === selection.crates.length, `affected.mjs --list ${change.path} selects ${files.length} test files${selection.crates.length ? ` (and ${selection.crates.length} crate)` : ''}, and compare says ${counts.selected} selected\n${selection.stdout}\n${counts.said}`);
    assert.equal(counts.reaching + counts.notReaching, counts.selected, `compare's counts for ${change.path} don't sum to selected: ${counts.reaching} recorded as reaching and ${counts.notReaching} recorded as not reaching, of ${counts.selected} selected; the selected tests with no row (${change.noRow.join(', ') || 'none'}) count as reaching\n${counts.said}`);
    assert.equal(counts.notReaching, change.notReaching.length, `of the tests selected for ${change.path}, the record shows ${change.notReaching.length} not reaching it (${change.notReaching.join(', ') || 'none'}); compare says ${counts.notReaching}\n${counts.said}`);
    assert.equal(counts.reaching, change.reaching.length + change.noRow.length + crates, `of the tests selected for ${change.path}, the record shows ${change.reaching.length} reaching it (${change.reaching.join(', ') || 'none'}) and ${change.noRow.length} have no row (${change.noRow.join(', ') || 'none'}), which count as reaching; compare says ${counts.reaching}\n${counts.said}`);
  });
}
