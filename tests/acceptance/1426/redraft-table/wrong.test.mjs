// #1426 table redraft: each judge passes the control (wrong/control.mjs, a small reference of the surface) and fails
// the wrong programs under wrong/, naming what they miss; each judge of check, merge and diff also fails a script that
// prints nothing, one that refuses everything and a missing one; the real-tree judge passes a complete planted tree and
// fails each fault planted in it. These test the tests, not #1426, so they pass at the base and carry no criterion tag.
// Run: node --test tests/acceptance/1426/redraft-table/wrong.test.mjs
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { carriedText, COLOR, mark, plantTree, README, remove, RENDERER, RUST_TESTS, TABLE_ROWS, tempRoot, testCell } from './common.mjs';
import { judgeCounts, judgeFileBudget, judgeHunkBudget, judgeLane, judgeMarks, judgeMissingRelease, judgeNewFile, judgeOverCount, judgeReason, judgeRowFields, judgeRowPerFile } from './lint-judge.mjs';
import { judgeDiff, judgeMergeClean, judgeMergeConflict } from './merge-judge.mjs';
import { judgeRealTree } from './tree-judge.mjs';

const wrong = (name) => fileURLToPath(new URL(`./wrong/${name}.mjs`, import.meta.url));
const control = wrong('control');
const expectOne = (failures, pattern) => assert.ok(failures.some((line) => pattern.test(line)), `expected ${pattern} in:\n${failures.join('\n') || '(no failure)'}`);

const JUDGES = { judgeRowPerFile, judgeRowFields, judgeMissingRelease, judgeMarks, judgeCounts, judgeHunkBudget, judgeFileBudget, judgeNewFile, judgeReason, judgeOverCount, judgeMergeConflict, judgeMergeClean, judgeDiff };

test('the control passes every judge of check, merge and diff', () => {
  for (const [name, judge] of Object.entries(JUDGES)) assert.deepEqual(judge(control), [], name);
});

for (const [name, judge, pattern] of [
  // #1426.4ef6dcfa
  ['check-no-row-rule', judgeRowPerFile, /context\.rs\) with no row: check passes/],
  ['check-gpui-only', judgeRowPerFile, /quickjs-jit-runtime\/src\/engine\.rs\) with no row: check passes/],
  ['check-crates-only', judgeRowPerFile, /GraphemeBreakTest\.txt\) with no row: check passes/],
  ['check-top-level', judgeRowPerFile, /app\/context\.rs\) with no row: check passes/],
  ['check-changed-only', judgeRowPerFile, /planted_new\.rs\) with no row: check passes/],
  ['check-manifest-exempt', judgeRowPerFile, /gpui-pre\/Cargo\.toml\) with no row: check passes/],
  ['check-unnamed', judgeRowPerFile, /without a FAIL line naming vendor\/gpui-pre\/src\/app\/context\.rs/],
  ['check-no-test-rule', judgeRowFields, /an empty Test cell: check passes/],
  ['check-missing-passes', judgeMissingRelease, /release missing, check passes/],
  // #1426.08aec3b4
  ['check-no-mark-rule', judgeMarks, /an unmarked 2-line addition in color\.rs: check passes/],
  ['check-mark-anywhere', judgeMarks, /an unmarked 2-line addition in color\.rs: check passes/],
  ['check-additions-only', judgeMarks, /an unmarked rewrite of color\.rs's upstream line 50: check passes/],
  ['check-no-line', judgeMarks, /without a FAIL line naming vendor\/gpui-pre\/src\/color\.rs:\d+/],
  ['check-mark-inside-only', judgeMarks, /one unchanged line below a marked hunk's mark: check fails/],
  // #1426.5f9ac1c5
  ['merge-theirs', judgeMergeConflict, /the conflicting hunk isn't left between conflict markers/],
  ['merge-ours', judgeMergeConflict, /rewrite of line 50, far from any carried hunk, didn't land/],
  ['merge-silent', judgeMergeConflict, /doesn't list the conflict as CONFLICT vendor\/gpui-pre\/src\/color\.rs:\d+/],
  ['merge-lists-every', judgeMergeConflict, /merge lists \d+ CONFLICT line\(s\), not the 1 conflict/],
  ['merge-no-line', judgeMergeConflict, /doesn't list the conflict as CONFLICT/],
  ['merge-exit-zero', judgeMergeConflict, /merge exits 0 with a conflict left/],
  ['merge-no-markers', judgeMergeConflict, /isn't left between conflict markers/],
  ['diff-silent', judgeDiff, /diff doesn't show color\.rs's carried line/],
  // #1426.8e0bb54e
  ['check-no-counts', judgeCounts, /no ROW line for The planted gradient/],
  ['check-count-files', judgeCounts, /The planted gradient's ROW line gives 1 marked, not 2/],
  ['check-empty-row-passes', judgeCounts, /marks no hunk passes check/],
  // #1426.0c3a7dfa
  ['check-no-budget', judgeHunkBudget, /a marked 9-line hunk in color\.rs: check passes/],
  ['check-budget-nine', judgeHunkBudget, /a marked 9-line hunk in color\.rs: check passes/],
  ['check-budget-seven', judgeHunkBudget, /a marked 8-line hunk in color\.rs: check fails/],
  ['check-mark-not-counted', judgeHunkBudget, /a marked 9-line hunk in color\.rs: check passes/],
  ['check-no-size', judgeHunkBudget, /without a FAIL line naming vendor\/gpui-pre\/src\/color\.rs:\d+ and "9 lines"/],
  ['check-no-file-budget', judgeFileBudget, /41 added lines in hunks of at most 8: check passes/],
  // #1426.fde8001d
  ['check-budgets-fresh', judgeNewFile, /a one-line marked mod in color\.rs, .* in the gradient's row: check fails/],
  ['check-changed-only', judgeNewFile, /the moved addition with no row for .*planted_stops\.rs: check passes/],
  // #1426.f66ec7fc
  ['check-no-reason-rule', judgeReason, /Budget "1 over": check passes/],
  // #1426.4e893008
  ['check-no-ratchet', judgeOverCount, /a second 9-line hunk in the surface's row, which allows 1, passes check/],
  ['check-total-only', judgeOverCount, /while the gradient's row allows 1 it doesn't use: check passes/],
  ['check-no-over-count', judgeOverCount, /The planted gradient's ROW line gives no over budget, not 0/],
]) {
  test(`${judge.name} fails ${name}`, () => expectOne(judge(wrong(name)), pattern));
}

test('the lane judge passes the control lanes table running the control', async () => {
  assert.deepEqual(await judgeLane(wrong('lanes-control'), { script: control }), []);
});

for (const [name, pattern] of [
  ['lanes-none', /doesn't run scripts\/vendor-rebase\.mjs/],
  ['lanes-paths', /paths skip a change to vendor\/gpui-pre\/src\/app\/context\.rs/],
  ['lanes-diff', /runs scripts\/vendor-rebase\.mjs diff, not scripts\/vendor-rebase\.mjs check/],
]) {
  test(`judgeLane fails ${name}`, async () => expectOne(await judgeLane(wrong(name), { script: control }), pattern));
}

test('the lane judge fails the control lanes table running a check that never fails', async () => {
  const dir = tempRoot('silent');
  try {
    writeFileSync(join(dir, 'silent.mjs'), '');
    expectOne(await judgeLane(wrong('lanes-control'), { script: join(dir, 'silent.mjs') }), /doesn't fail as 'FAIL lint: \.\.\.'/);
  } finally {
    remove(dir);
  }
});

test('every judge of check, merge and diff fails a script that prints nothing, one that refuses everything, and a missing one', () => {
  const dir = tempRoot('degenerate');
  try {
    writeFileSync(join(dir, 'silent.mjs'), '');
    writeFileSync(join(dir, 'refuse.mjs'), "console.log('FAIL everything: refused'); process.exitCode = 1;\n");
    for (const script of [join(dir, 'silent.mjs'), join(dir, 'refuse.mjs'), join(dir, 'missing.mjs')]) {
      for (const [name, judge] of Object.entries(JUDGES)) assert.notDeepEqual(judge(script), [], `${name} passes ${script}`);
    }
  } finally {
    remove(dir);
  }
});

// The real-tree judge on a planted tree: the stub releases stand in for the fetched ones.
const REFUSAL = 'zed closed [zed-industries/zed#66114](https://github.com/zed-industries/zed/pull/66114) unmerged on October 28, 2026, so we carry the patch ourselves.';
const DESIGN_LINE = 'gpui-kit and gpui-shell stay upstream; the patches we carry on gpui-pre, gpui-pre-apple and quickjs-jit-runtime are listed in `vendor/gpui-pre-apple/upstream/README.md`.';
/** The plant's table with `change` over its rows, and the refusal under it. */
const withRows = (box, change) => {
  const rows = structuredClone(TABLE_ROWS);
  box.write(README, `${carriedText(change(rows) ?? rows)}\n${REFUSAL}\n`);
};
function realTree(fault = () => null) {
  const box = plantTree();
  try {
    withRows(box, () => null);
    box.write('docs/technical-design.md', `# Design\n\n${DESIGN_LINE}\n`);
    fault(box);
    return judgeRealTree(box.root, { releases: box.releases });
  } finally {
    box.remove();
  }
}
const nine = (issue, tag) => [mark(issue, tag), ...Array.from({ length: 8 }, (_, index) => `pub const PLANTED_${tag}_${index}: u8 = ${index};`)];

test('the real-tree judge passes a complete planted tree, a Rust row test cargo would list, and a node one', () => {
  assert.deepEqual(realTree(), []);
  assert.deepEqual(realTree((box) => withRows(box, (rows) => { rows[2].test = testCell('tests::switch_denies_the_engine', RUST_TESTS); })), []);
});

for (const [what, fault, pattern] of [
  ['a changed file with no row', (box) => box.insert('vendor/gpui-pre/src/app/context.rs', 5, [mark(9001, 'context'), 'pub const PLANTED_CONTEXT: u8 = 1;']), /vendor\/gpui-pre\/src\/app\/context\.rs differs from gpui-pre-0\.3\.9 and no row lists it/],
  ['a changed Unicode file with no row', (box) => box.write('vendor/unicode-17.0.0/LineBreakTest.txt', '# changed\n'), /vendor\/unicode-17\.0\.0\/LineBreakTest\.txt differs/],
  ['a row with no issue', (box) => withRows(box, (rows) => { rows[0].issue = ''; }), /row The planted gradient names no issue/],
  ['a row with no removal condition', (box) => withRows(box, (rows) => { rows[0].removal = 'none'; }), /row The planted gradient has no removal condition/],
  ['a row with no test', (box) => withRows(box, (rows) => { rows[0].test = '—'; }), /row The planted gradient names no test/],
  ['a row naming a name its node file holds only in a comment', (box) => withRows(box, (rows) => { rows[0].test = testCell('gradient keeps every stop'); }), /"gradient keeps every stop" isn't in tests\/planted\/carried\.test\.mjs's own list/],
  ['a row naming a Rust function that is no test', (box) => withRows(box, (rows) => { rows[2].test = testCell('tests::not_a_test', RUST_TESTS); }), /"tests::not_a_test" isn't in .*lib\.rs's own list/],
  ['a row naming a test file that is gone', (box) => withRows(box, (rows) => { rows[0].test = testCell('gradient keeps its stops', 'tests/planted/gone.test.mjs'); }), /gone\.test\.mjs isn't in the repo/],
  ['a row whose issue marks no hunk', (box) => withRows(box, (rows) => [...rows, { ...rows[0], behavior: 'The planted orphan', issue: '#9004' }]), /row The planted orphan has no marked hunk/],
  ['a second 9-line hunk in the row that allows 1', (box) => box.insert(RENDERER, 60, nine(9002, 'BRANCH')), /the rows for #9002 carry 2 hunks over 8 lines and allow 1/],
  ['an unmarked 9-line hunk', (box) => box.insert(COLOR, 50, nine(9001, 'LOOSE').slice(1).concat(['pub const PLANTED_LOOSE_8: u8 = 8;'])), /the tree carries 2 hunks and files over budget, and the rows allow 1/],
  ['five columns, with no Removal', (box) => box.write(README, `${carriedText(TABLE_ROWS).replace('| Budget | Removal |', '| Budget |').replace('|---|---|---|---|---|---|', '|---|---|---|---|---|')}\n${REFUSAL}\n`), /the table's columns are Behavior, Issue, Files, Test, Budget, not/],
  ['no refusal paragraph', (box) => box.write(README, carriedText(TABLE_ROWS)), /has no paragraph recording zed-industries\/zed#66114's refusal/],
  ['the base\'s "The pull request is open"', (box) => box.write(README, `${carriedText(TABLE_ROWS)}\n${REFUSAL}\n\nThe pull request is open and ready for review.\n`), /still says "The pull request is open"/],
  ['the design\'s "the only patch"', (box) => box.write('docs/technical-design.md', '# Design\n\ngpui-kit and gpui-shell stay upstream at one commit, and the only patch, rquickjs to that same commit, sits in `.cargo/config.toml`.\n'), /still says "the only patch"/],
]) {
  test(`the real-tree judge fails ${what}`, () => expectOne(realTree(fault), pattern));
}
