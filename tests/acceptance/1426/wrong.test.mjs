// #1426: each judge fails the wrong programs under wrong/, naming what they miss, and passes its controls. These test
// the tests, not #1426, so they pass at the base and carry no criterion tag. The guard twins read through the real
// scripts/proof-change.mjs, so this file needs node_modules; the .rs and .test.ts runners need cargo and vitest.
// Run: node --test tests/acceptance/1426/wrong.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { carriedText, plantTree, README, remove, repoRoot, tempRoot } from './common.mjs';
import { judgeSigned, judgeUnsigned } from './guard-judge.mjs';
import { judgeCounts, judgeFileBudget, judgeHunkBudget, judgeMarks, judgeMissingRelease, judgeNewFile, judgeNoRow, judgeOverCount, judgeReason, judgeRowCells, judgeWiring } from './lint-judge.mjs';
import { judgeCleanMerge, judgeDiff, judgeMerge } from './merge-judge.mjs';
import { judgeConflicts, judgeMovedPin, judgeRecord, readRecord } from './record-judge.mjs';
import { judgeReverts, REVERTS, runRowTest } from './reverts-judge.mjs';
import { differing, judgeDesign, judgeRealCheck, judgeRefusal, judgeTable } from './tree-judge.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const wrong = (name) => here(`./wrong/${name}.mjs`);
const CONTROL = wrong('check-control');
const expectOne = (failures, pattern) => assert.ok(failures.some((line) => pattern.test(line)), `expected ${pattern} in:\n${failures.join('\n') || '(no failure)'}`);

// check ------------------------------------------------------------------------------------------------------

test('the control script passes every judge of check', () => {
  assert.deepEqual([
    ...judgeNoRow(CONTROL), ...judgeRowCells(CONTROL), ...judgeMissingRelease(CONTROL), ...judgeMarks(CONTROL), ...judgeCounts(CONTROL),
    ...judgeHunkBudget(CONTROL), ...judgeFileBudget(CONTROL), ...judgeNewFile(CONTROL), ...judgeReason(CONTROL), ...judgeOverCount(CONTROL),
  ], []);
});

for (const [name, judge, pattern] of [
  ['check-always-pass', judgeNoRow, /with no row .* passes check/],
  ['check-one-tree', judgeNoRow, /a file of gpui-pre with no row .* passes check/],
  ['check-top-level', judgeNoRow, /a nested file of gpui-pre with no row .* passes check/],
  ['check-no-row-rule', judgeNoRow, /with no row .* passes check/],
  ['check-unnamed', judgeNoRow, /fails check without a FAIL line naming/],
  ['check-fresh-no-row', judgeNoRow, /a new vendored file with no row passes check/],
  ['check-no-test-rule', judgeRowCells, /an empty Test cell passes check/],
  ['check-any-test-word', judgeRowCells, /a test whose file is gone passes check/],
  ['check-no-issue-rule', judgeRowCells, /an empty Issue cell passes check/],
  ['check-missing-passes', judgeMissingRelease, /check passes with no pinned release/],
  ['check-no-mark-rule', judgeMarks, /an unmarked hunk at .* passes check/],
  ['check-mark-anywhere', judgeMarks, /an unmarked hunk at .* passes check/],
  ['check-no-line', judgeMarks, /fails check without a FAIL line naming vendor\/gpui-pre\/src\/color\.rs:51/],
  ['check-no-counts', judgeCounts, /row #9001 prints no count/],
  ['check-one-marked', judgeCounts, /row #9001 prints 1, not 2/],
  ['check-empty-row-passes', judgeCounts, /a row with no marked hunk passes check/],
  ['check-no-budget', judgeHunkBudget, /a marked 9-line hunk at .* passes check/],
  ['check-budget-nine', judgeHunkBudget, /a marked 9-line hunk at .* passes check/],
  ['check-budget-seven', judgeHunkBudget, /a marked 8-line hunk at .* fails check/],
  ['check-mark-not-counted', judgeHunkBudget, /a marked 9-line hunk at .* passes check/],
  ['check-no-size', judgeHunkBudget, /names no size of 9 lines/],
  ['check-no-file-budget', judgeFileBudget, /41 added lines in .* pass check/],
  ['check-budgets-fresh', judgeNewFile, /moved to a new file, with one marked mod line and a row, fails check/],
  ['check-fresh-no-row', judgeNewFile, /with no row for the new file passes check/],
  ['check-no-reason-rule', judgeReason, /no reason, passes check/],
  ['check-no-ratchet', judgeOverCount, /a second hunk over budget .* passes check/],
  ['check-total-only', judgeOverCount, /row #9002 doesn't print 1 hunk over budget/],
  ['check-no-over-count', judgeOverCount, /row #9002 doesn't print 1 hunk over budget/],
]) {
  test(`the judge fails ${name}`, () => expectOne(judge(wrong(name)), pattern));
}

const JUDGES = [judgeNoRow, judgeRowCells, judgeMissingRelease, judgeMarks, judgeCounts, judgeHunkBudget, judgeFileBudget, judgeNewFile, judgeReason, judgeOverCount, judgeMerge, judgeCleanMerge, judgeDiff];

for (const judge of JUDGES) {
  test(`${judge.name} fails a script that prints nothing, one that refuses everything and one that isn't there`, () => {
    for (const name of ['check-always-pass', 'check-refuse-all', 'no-such-script']) assert.notDeepEqual(judge(wrong(name)), [], name);
  });
}

// merge and diff --------------------------------------------------------------------------------------------

test('the control script passes the merge and diff judges', () => {
  assert.deepEqual([...judgeMerge(CONTROL), ...judgeCleanMerge(CONTROL), ...judgeDiff(CONTROL)], []);
});

for (const [name, judge, pattern] of [
  ['merge-theirs', judgeMerge, /the clean carried hunk is gone/],
  ['merge-ours', judgeMerge, /new release's change away from any hunk isn't in the merged file/],
  ['merge-silent', judgeMerge, /the conflicting hunk isn't left between conflict markers/],
  ['merge-no-list', judgeMerge, /doesn't list the conflicting hunk/],
  ['merge-lists-every', judgeMerge, /merge lists \d+ conflicts, not the one/],
  ['merge-no-line', judgeMerge, /doesn't list the conflicting hunk/],
  ['merge-theirs', judgeCleanMerge, /a clean merge lost a carried hunk/],
  ['diff-silent', judgeDiff, /diff doesn't show the carried line/],
]) {
  test(`the judge ${judge.name} fails ${name}`, () => expectOne(judge(wrong(name)), pattern));
}

// the lane ---------------------------------------------------------------------------------------------------

const script = 'tests/acceptance/1426/wrong/check-control.mjs';

test('the control lane table passes the wiring judge', async () => {
  assert.deepEqual(await judgeWiring(wrong('lanes-control'), { script }), []);
});

for (const [name, pattern] of [
  ['lanes-none', /the lint lane doesn't run/],
  ['lanes-other-lane', /the lint lane doesn't run/],
  ['lanes-paths', /the lint lane's paths skip a change to vendor/],
  ['lanes-diff', /not .* check with nothing after it/],
]) {
  test(`the wiring judge fails ${name}`, async () => expectOne(await judgeWiring(wrong(name), { script }), pattern));
}

test('the wiring judge fails a lint lane whose check never fails', async () => {
  expectOne(await judgeWiring(wrong('lanes-never-fails'), { script: 'tests/acceptance/1426/wrong/check-always-pass.mjs' }), /doesn't fail as 'FAIL lint/);
});

// the guard --------------------------------------------------------------------------------------------------

test('the control guard passes the guard judges', () => {
  assert.deepEqual([...judgeUnsigned(wrong('guard-control')), ...judgeSigned(wrong('guard-control'))], []);
});

for (const [name, judge, pattern] of [
  ['guard-none', judgeUnsigned, /an unsigned raise of the number passes the guard/],
  ['guard-raise-only', judgeUnsigned, /an unsigned change of the number downward passes the guard/],
  ['guard-whole-file', judgeSigned, /prose outside the table is refused/],
  ['guard-never-signed', judgeSigned, /as a signed proposal is refused/],
  ['guard-any-signature', judgeSigned, /a stranger's signature passes the guard/],
]) {
  test(`the judge ${judge.name} fails ${name}`, () => expectOne(judge(wrong(name)), pattern));
}

// the real-tree judges, on a plant ---------------------------------------------------------------------------

/** A plant whose four named rows are there, for the table judge and for the reverts. */
const FOUR = ['The sRGB layer tag', 'The exact gradient mode', 'The BGRA surface', 'The surface reports'];

test('the table judge passes a plant with the four rows, and fails a differing file with no row by its own count', () => {
  const box = plantTree();
  try {
    box.rows((rows) => { FOUR.forEach((behavior, index) => { if (rows[index]) rows[index].behavior = behavior; else rows.push({ ...rows[0], behavior }); }); });
    assert.deepEqual(differing(box.root, box.releases).sort(), ['vendor/gpui-pre-apple/src/metal_renderer.rs', 'vendor/gpui-pre/src/color.rs', 'vendor/quickjs-jit-runtime/src/lib.rs']);
    assert.deepEqual(judgeTable(box.root, box.releases), []);
    box.write('vendor/gpui-pre/src/gpui.rs', 'changed\n');
    expectOne(judgeTable(box.root, box.releases), /vendor\/gpui-pre\/src\/gpui\.rs differs from its pinned release and has no row/);
  } finally {
    box.remove();
  }
});

test('the table judge fails a row with no issue, with no test, and a tree with none of the four', () => {
  const box = plantTree();
  try {
    box.rows((rows) => { rows[0].issue = ''; rows[1].test = '—'; });
    const failures = judgeTable(box.root, box.releases);
    expectOne(failures, /names no issue/);
    expectOne(failures, /names no test/);
    expectOne(failures, /no row for the sRGB layer tag/);
    box.write(README, 'no table\n');
    expectOne(judgeTable(box.root, box.releases), /has no carried-patch table/);
  } finally {
    box.remove();
  }
});

test('the real-check judge passes the control on a plant and fails a script that prints no rows or fails the tree', () => {
  const box = plantTree();
  const env = { DEEP_VENDOR_RELEASES: box.releases };
  try {
    assert.deepEqual(judgeRealCheck(CONTROL, box.root, { env }), []);
    expectOne(judgeRealCheck(wrong('check-no-counts'), box.root, { env }), /prints no ROW line/);
    expectOne(judgeRealCheck(wrong('check-always-pass'), box.root, { env }), /prints no ROW line/);
    box.rows((rows) => { rows[0].budget = 'nothing readable'; });
    expectOne(judgeRealCheck(CONTROL, box.root, { env }), /check fails the tree/);
  } finally {
    box.remove();
  }
});

test('the refusal judge reads the base\'s file as not recording it, and passes a paragraph with the link, the date and the word', () => {
  expectOne(judgeRefusal(repoRoot), /no paragraph with the link|still calls/);
  const box = plantTree();
  try {
    box.write(README, 'zed closed https://github.com/zed-industries/zed/pull/66114 unmerged on October 28, 2026.\n');
    assert.deepEqual(judgeRefusal(box.root), []);
    box.write(README, 'zed has https://github.com/zed-industries/zed/pull/66114 open since October 28, 2026.\n');
    expectOne(judgeRefusal(box.root), /doesn't say the patch was refused/);
  } finally {
    box.remove();
  }
});

test('the design judge fails the base\'s line and passes a corrected one', () => {
  expectOne(judgeDesign(repoRoot), /still calls rquickjs the only patch/);
  const box = plantTree();
  try {
    box.write('docs/technical-design.md', "| The app's toolkit | gpui-kit, with the patches in vendor/gpui-pre carried, and rquickjs in .cargo/config.toml. | x |\n");
    assert.deepEqual(judgeDesign(box.root), []);
  } finally {
    box.remove();
  }
});

// the record -------------------------------------------------------------------------------------------------

const PINS = { 'gpui-pre': '0.3.9', 'gpui-pre-apple': '0.3.9', 'gpui-kit': '0.8.0' };
const MOVED = { 'gpui-pre': '0.3.11', 'gpui-pre-apple': '0.3.11', 'gpui-kit': '0.9.0' };
const suites = (result) => ['#377', '#390', '#391', '#140', '#358'].map((suite) => `| ${suite} | ${result(suite)} |`).join('\n');
const record = ({ tried = 'Tried: gpui-pre 0.3.9 -> 0.3.11, gpui-kit 0.8.0 -> 0.9.0', outcome, result, conflicts = '' }) => `# x\n\n## Rebase trial\n\n${tried}\nOutcome: ${outcome}\n\n| Suite | Result |\n|---|---|\n${suites(result)}\n\n${conflicts}\n`;
const LEFT = (extra = {}) => record({ outcome: 'pin left', result: () => 'not run', conflicts: '```\nCONFLICT vendor/gpui-pre-apple/src/metal_renderer.rs:120\n```', ...extra });

test('the record judge passes a moved pin with five passing suites and a left pin with its conflicts', () => {
  assert.deepEqual(judgeRecord(record({ outcome: 'pin moved', result: () => 'pass' }), MOVED), []);
  assert.deepEqual(judgeRecord(LEFT(), PINS), []);
  assert.deepEqual(judgeRecord(record({ outcome: 'pin left', result: (suite) => (suite === '#391' ? 'fail: gradient.test.ts' : 'pass') }), PINS), []);
  assert.deepEqual(readRecord(LEFT()).conflicts, ['CONFLICT vendor/gpui-pre-apple/src/metal_renderer.rs:120']);
});

for (const [what, text, pins, pattern] of [
  ['no record', '# x\n', PINS, /no "## Rebase trial" section/],
  ['no versions', record({ tried: 'Tried: the newest', outcome: 'pin moved', result: () => 'pass' }), MOVED, /names no gpui-pre versions/],
  ['an old release', record({ tried: 'Tried: gpui-pre 0.3.9 -> 0.3.10, gpui-kit 0.8.0 -> 0.9.0', outcome: 'pin moved', result: () => 'pass' }), MOVED, /older than the newest 0\.3\.11/],
  ['a third ending', record({ outcome: 'partly', result: () => 'pass' }), PINS, /neither "pin moved" nor "pin left"/],
  ['a moved pin with a failing suite', record({ outcome: 'pin moved', result: (suite) => (suite === '#390' ? 'fail: atlas' : 'pass') }), MOVED, /#390 reads "fail: atlas", not pass/],
  ['a moved pin the tree does not hold', record({ outcome: 'pin moved', result: () => 'pass' }), PINS, /says the pin moved to gpui-pre 0\.3\.11, and the tree holds 0\.3\.9/],
  ['a missing suite', record({ outcome: 'pin moved', result: () => 'pass' }).replace('| #358 | pass |\n', ''), MOVED, /no result for the suite #358/],
  ['a left pin listing nothing', record({ outcome: 'pin left', result: () => 'pass' }), PINS, /lists no conflicting hunk and no failing suite/],
  ['a left pin the tree moved', LEFT(), MOVED, /says the pin stayed/],
  ['a suite not run with no conflict', record({ outcome: 'pin left', result: (suite) => (suite === '#377' ? 'fail: handoff' : 'not run') }), PINS, /wasn't run though no conflict stopped it/],
]) {
  test(`the record judge fails ${what}`, () => expectOne(judgeRecord(text, pins), pattern));
}

test('the conflicts judge wants every conflict a fresh merge finds, by file', () => {
  const [a, b] = ['CONFLICT vendor/gpui-pre/src/color.rs:4', 'CONFLICT vendor/gpui-pre/src/color.rs:90'];
  assert.deepEqual(judgeConflicts([a, b], [a.replace(':4', ':7'), b]), []);
  expectOne(judgeConflicts([a], [a, b]), /a fresh merge finds 2 conflict\(s\), the record lists 1/);
  expectOne(judgeConflicts([a, 'CONFLICT vendor/gpui-pre/src/window.rs:1'], [a]), /window\.rs: the record lists a conflict a fresh merge doesn't find/);
});

test('a moved pin runs its suites: the record\'s word is not enough, and a machine that can\'t run them is INCONCLUSIVE', () => {
  const root = tempRoot('suites');
  const put = (suite, body) => {
    mkdirSync(join(root, 'tests/acceptance', suite, 'nested'), { recursive: true });
    writeFileSync(join(root, 'tests/acceptance', suite, 'nested/a.test.mjs'), `import assert from 'node:assert/strict';\nimport { test } from 'node:test';\ntest('t', () => { ${body} });\n`);
  };
  try {
    for (const suite of ['377', '390', '391', '140', '358']) put(suite, 'assert.equal(1, 1);');
    assert.deepEqual(judgeMovedPin(root, null), []);
    put('391', 'assert.equal(1, 2);');
    expectOne(judgeMovedPin(root, null), /^#391 fails/);
    expectOne(judgeMovedPin(root, 'INCONCLUSIVE: no Metal'), /^INCONCLUSIVE/);
  } finally {
    remove(root);
  }
});

// the reverts ------------------------------------------------------------------------------------------------

const ANCHORS = {
  renderer: ['objc2_layer.setColorspace(srgb.as_deref());', 'if CVPixelBufferGetPixelFormatType(image_buffer) == kCVPixelFormatType_32BGRA {', 'self.sampled_surfaces\n    .push(1);'],
  shader: `if (color_space == 1) {\n  a();\n} else if (color_space == 2) {\n  out.color1.rgb *= out.color1.a;\n}\nswitch (x) {\ncase 1: {\n  b();\n}\ncase 2: {\n  // DeepBuild patch (windoliver/deepbuild#391): exact\n  return oklab_to_srgb_exact(oklab_color);\n}\n}\n`,
};
const RENDERER = 'vendor/gpui-pre-apple/src/metal_renderer.rs', SHADER = 'vendor/gpui-pre-apple/src/shaders.metal';
/** The test each row names: it reads the code its revert removes. */
const PROBES = [
  ['layer is tagged', RENDERER, 'setColorspace(srgb'],
  ['gradient is exact', SHADER, 'oklab_to_srgb_exact'],
  ['bgra is drawn', RENDERER, 'kCVPixelFormatType_32BGRA'],
  ['reports are sent', RENDERER, 'sampled_surfaces'],
];
function revertTree({ hollow, broken, misnamed, moved } = {}) {
  const root = tempRoot('reverts');
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  put(RENDERER, `${ANCHORS.renderer.join('\n')}\n`);
  put(SHADER, ANCHORS.shader);
  put('tests/rows.test.mjs', `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
${PROBES.map(([name, path, text]) => `test('${name}', () => { ${name === hollow ? '' : `assert.ok(readFileSync('${path}', 'utf8').includes('${text}'));`}${name === broken ? ' assert.fail("broken");' : ''} });`).join('\n')}
`);
  put(README, carriedText(FOUR.map((behavior, index) => ({
    behavior, issue: '#9001', files: moved ? [SHADER] : [RENDERER, SHADER], budget: '—',
    test: `\`tests/rows.test.mjs › ${PROBES[index][0] === misnamed ? 'no such test' : PROBES[index][0]}\``,
  }))));
  return root;
}
const inTree = (options, check) => {
  const root = revertTree(options);
  try {
    return check(judgeReverts(root));
  } finally {
    remove(root);
  }
};

test('the reverts judge passes rows whose tests fail with each change reverted', () => inTree({}, (failures) => assert.deepEqual(failures, [])));

for (const [what, options, pattern] of [
  ['a row test that reads nothing, so it passes with the change reverted', { hollow: 'bgra is drawn' }, /the BGRA surface: its test still passes with the change reverted/],
  ['a row test that fails with the change in place', { broken: 'reports are sent' }, /the surface reports: its test fails with the change in place/],
  ['a row naming a test that runs nothing', { misnamed: 'layer is tagged' }, /the sRGB layer tag: .* runs no test/],
  ['a revert that matches nothing, which is INCONCLUSIVE, never a pass', { moved: true }, /INCONCLUSIVE: the sRGB layer tag: the revert/],
]) {
  test(`the reverts judge fails ${what}`, () => inTree(options, (failures) => expectOne(failures, pattern)));
}

test('the reverts judge fails a tree with no table and no row for a behavior', () => {
  const root = revertTree();
  try {
    writeFileSync(join(root, README), carriedText([]));
    expectOne(judgeReverts(root), /no row for the sRGB layer tag/);
    writeFileSync(join(root, README), 'no table\n');
    expectOne(judgeReverts(root), /has no carried-patch table/);
  } finally {
    remove(root);
  }
});

test('every revert names its behavior and at least one edit', () => {
  assert.deepEqual(REVERTS.map(({ name }) => name), ['the sRGB layer tag', 'the exact gradient mode', 'the BGRA surface', 'the surface reports']);
  assert.ok(REVERTS.every(({ edits }) => edits.length));
});

test('the row-test runner reads a Rust test: pass, fail, and a name that runs nothing', () => {
  const root = tempRoot('rust');
  const work = tempRoot('work');
  try {
    mkdirSync(join(root, 'crate/src'), { recursive: true });
    writeFileSync(join(root, 'crate/Cargo.toml'), '[package]\nname = "da1426-planted"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\npath = "src/lib.rs"\n\n[workspace]\n');
    writeFileSync(join(root, 'crate/src/lib.rs'), '#[test]\nfn holds() {}\n#[test]\nfn breaks() { panic!("broken"); }\n');
    assert.equal(spawnSync('cargo', ['generate-lockfile', '--offline'], { cwd: join(root, 'crate') }).status, 0);
    const state = (name) => runRowTest(root, { path: 'crate/src/lib.rs', name }, work).state;
    assert.deepEqual([state('holds'), state('breaks'), state('nothing_named_so')], ['pass', 'fail', 'none']);
  } finally {
    remove(root);
    remove(work);
  }
});

test('the row-test runner reads a vitest test: pass, fail, and a name that runs nothing', () => {
  const root = tempRoot('vitest');
  const work = tempRoot('work');
  try {
    symlinkSync(join(repoRoot, 'node_modules'), join(root, 'node_modules'));
    writeFileSync(join(root, 'rows.test.ts'), "import { expect, test } from 'vitest';\ntest('holds', () => { expect(1).toBe(1); });\ntest('breaks', () => { expect(1).toBe(2); });\n");
    const state = (name) => runRowTest(root, { path: 'rows.test.ts', name }, work).state;
    assert.deepEqual([state('holds'), state('breaks'), state('nothing named so')], ['pass', 'fail', 'none']);
  } finally {
    remove(root);
    remove(work);
  }
});
