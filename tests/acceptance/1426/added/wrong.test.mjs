// #1426 added: each judge passes the control (wrong/control.mjs, a small reference of the added surface) and fails the
// wrong programs under wrong/, naming what they miss; each judge also fails a script that prints nothing, one that
// refuses everything and a missing one. These test the tests, not #1426, so they pass at the base and carry no
// criterion tag. The vitest and cargo cases need the repo's node_modules and cargo.
// Run: node --test tests/acceptance/1426/added/wrong.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { remove, tempRoot } from './common.mjs';
import { judgePinHeld, judgePinMoves } from './pin-judge.mjs';
import { judgeCargoTests, judgeNodeTests, judgeRealRows, judgeRemoval, judgeVitestTests } from './rows-judge.mjs';
import { judgeEveryTree, judgeLane, judgeQuickjs, judgeRealQuickjs } from './trees-judge.mjs';

const wrong = (name) => fileURLToPath(new URL(`./wrong/${name}.mjs`, import.meta.url));
const control = wrong('control');
const expectOne = (failures, pattern) => assert.ok(failures.some((line) => pattern.test(line)), `expected ${pattern} in:\n${failures.join('\n') || '(no failure)'}`);

const JUDGES = { judgeNodeTests, judgeVitestTests, judgeCargoTests, judgeRemoval, judgeQuickjs, judgeEveryTree, judgePinHeld, judgePinMoves };

test('the control passes every judge of check and merge', () => {
  for (const [name, judge] of Object.entries(JUDGES)) assert.deepEqual(judge(control), [], name);
});

test('the lane judge passes the control lanes table running the control', async () => {
  assert.deepEqual(await judgeLane(wrong('lanes-control'), { script: control }), []);
});

for (const [name, judge, pattern] of [
  // #1426.a17e5e56
  ['check-text-match', judgeNodeTests, /holds only in a comment: check passes/],
  ['check-text-match', judgeVitestTests, /holds only in a comment: check passes/],
  ['check-text-match', judgeCargoTests, /not_a_test, a function .* that is no test: check passes/],
  ['check-file-only', judgeNodeTests, /holds only in a comment: check passes/],
  ['check-basename', judgeNodeTests, /by its bare name, not its path: check passes/],
  ['check-no-test-name', judgeNodeTests, /without a FAIL line naming the row \(The planted gradient\) and the test/],
  ['check-refuse-tests', judgeNodeTests, /the plant as it stands fails check/],
  ['check-no-removal', judgeRemoval, /an empty Removal cell passes check/],
  ['check-bare-none', judgeRemoval, /"none" with no reason passes check/],
  // #1426.ed3ed529
  ['check-gpui-only', judgeQuickjs, /a changed file of quickjs-jit-runtime \(vendor\/quickjs-jit-runtime\/src\/engine\.rs\) with no row passes check/],
  ['check-changed-only', judgeQuickjs, /a new file under quickjs-jit-runtime .* with no row passes check/],
  ['check-top-level', judgeQuickjs, /a changed nested file .*osr\.rs\) with no row passes check/],
  ['check-unnamed', judgeQuickjs, /without a FAIL line naming vendor\/quickjs-jit-runtime\/src\/engine\.rs/],
  ['check-crates-only', judgeEveryTree, /a changed Unicode test file .* passes check/],
  ['check-fixed-trees', judgeEveryTree, /a changed file of a newly vendored crate .* passes check/],
  // #1426.fdfd6785
  ['merge-moves-anyway', judgePinHeld, /the pin moved to 0\.3\.10/],
  ['merge-tests-before', judgePinHeld, /the pin moved to 0\.3\.10/],
  ['merge-no-name', judgePinHeld, /doesn't name the failing test "gradient keeps its stops"/],
  ['merge-names-all', judgePinHeld, /names the passing test "surface keeps its alpha" as failing/],
  ['merge-exit-zero', judgePinHeld, /exits 0 with the pin left/],
  ['merge-never-moves', judgePinMoves, /leaves the pin at 0\.3\.9/],
]) {
  test(`${judge.name} fails ${name}`, () => expectOne(judge(wrong(name)), pattern));
}

for (const [name, pattern] of [
  ['lanes-none', /doesn't run scripts\/vendor-rebase\.mjs/],
  ['lanes-other-lane', /doesn't run scripts\/vendor-rebase\.mjs/],
  ['lanes-paths', /paths skip a change to vendor\/quickjs-jit-runtime/],
]) {
  test(`judgeLane fails ${name}`, async () => expectOne(await judgeLane(wrong(name), { script: control }), pattern));
}

test('the lane judge fails the control lanes table running a check that prints nothing', async () => {
  const dir = tempRoot('silent');
  try {
    writeFileSync(join(dir, 'silent.mjs'), '');
    expectOne(await judgeLane(wrong('lanes-control'), { script: join(dir, 'silent.mjs') }), /doesn't fail as 'FAIL lint: \.\.\.'/);
  } finally {
    remove(dir);
  }
});

test('every judge of check and merge fails a script that prints nothing, one that refuses everything, and a missing one', () => {
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

test('the real-table judges fail a tree with no table, and pass one whose rows are complete', () => {
  const dir = tempRoot('real');
  try {
    const readme = join(dir, 'vendor/gpui-pre-apple/upstream/README.md');
    expectOne(judgeRealRows(dir), /has no table/);
    expectOne(judgeRealQuickjs(dir), /has no table/);
    const write = (removal, test) => {
      writeFileSync(join(dir, 'tests.mjs'), "test('switch denies the engine', () => {});\n");
      writeFileSync(readme, ['## Carried patches', '', '| Behavior | Issue | Files | Test | Budget | Removal |', '|---|---|---|---|---|---|',
        `| The switch | #358 | \`vendor/quickjs-jit-runtime/src/lib.rs\` | \`${test} › switch denies the engine\` | — | ${removal} |`, ''].join('\n'));
    };
    mkdirSync(join(dir, 'vendor/gpui-pre-apple/upstream'), { recursive: true });
    write('none: the switch is ours', 'tests.mjs');
    assert.deepEqual([...judgeRealRows(dir), ...judgeRealQuickjs(dir)], []);
    write('none', 'tests.mjs');
    expectOne(judgeRealRows(dir), /has no removal condition/);
    write('none: the switch is ours', 'gone.mjs');
    expectOne(judgeRealRows(dir), /names gone\.mjs, which isn't in the repo/);
  } finally {
    remove(dir);
  }
});
