// #3502, first and second criteria, on planted trees and on the table's words; fast, no build.
//
// AC1: "A row whose test can't run reads BLOCKED, naming it, never PASS". A planted table over a planted test file
// whose tests pass, fail, are skipped, say they could not run, say they could not decide, or aren't there, read
// through the runner and the judge rows.test.mjs holds the real rows to.
// AC2: each removed row names the upstream change that meets its removal condition, on the real table against the
// merge base's; and "a planted removal of a row whose condition the release doesn't meet fails that row's test,
// naming it", on a planted tree through the judge rows.test.mjs holds the real removed rows to (README: The planted
// removal).
// Run: node --test tests/acceptance/3502/rows-planted.test.mjs
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { atLeast, blocked, CARRIED, carriedRows, COLUMNS, mergeBase, read, REPO, RETIRED, RETIRED_COLUMNS, retiredRows, rowName, showAt, TABLE, tempDir, treeVersion } from './common.mjs';
import { judgeMetByPin, judgeRetired, judgeRows, runCells } from './rows.mjs';

/** A tree in a temporary folder, from a map of its files. */
function plantTree(files) {
  const root = tempDir('tree');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
const tableOf = (heading, columns, rows) => `${heading}\n\n| ${columns.split('|').join(' | ')} |\n|${columns.split('|').map(() => '---').join('|')}|\n${rows.map((row) => `| ${row.join(' | ')} |`).join('\n')}\n`;
const carried = (rows) => tableOf(CARRIED, COLUMNS, rows.map(({ behavior, issue, test: named, removal }) => [behavior, issue, '`vendor/stub/lib.mjs`', named, '—', removal]));
const retiredTable = (rows) => tableOf(RETIRED, RETIRED_COLUMNS, rows.map(({ behavior, issue, test: named, upstream }) => [behavior, issue, named, upstream]));

test('AC1 #3502.46a47d8c a row whose test passes reads PASS, one whose test fails FAIL, and one whose test can\'t run reads BLOCKED, naming the row, never PASS', () => {
  const root = plantTree({
    'tests/rows.test.mjs': [
      "import assert from 'node:assert/strict';", "import { test } from 'node:test';", "const ID = '#1.0a0a0a0a';",
      "test('passes', () => {});", 'test(`${ID} passes under a constant`, () => {});', "test('AC1 #1.0a0a0a0a: passes with its ID written out', () => {});",
      "test('fails', () => { assert.equal(1, 2, 'the carried change is gone'); });",
      "test('skipped here', { skip: 'no display' }, () => {});",
      "test('says it could not run', () => { throw Error(\"BLOCKED: the binary isn't built\"); });",
      "test('says it could not decide', () => { throw Error('INCONCLUSIVE: the machine is loaded'); });", '',
    ].join('\n'),
  });
  const cell = (name, file = 'tests/rows.test.mjs') => `\`${file} › ${name}\``;
  const rows = [
    ['its test passes', cell('passes'), 'PASS'],
    ['its test is named with a constant', cell('${ID} passes under a constant'), 'PASS'],
    ['its test is named with its ID', cell('AC1 #1.0a0a0a0a: passes with its ID written out'), 'PASS'],
    ['its test fails', cell('fails'), 'FAIL'],
    ['its test is skipped', cell('skipped here'), 'BLOCKED'],
    ['its test says it could not run', cell('says it could not run'), 'BLOCKED'],
    ['its test says it could not decide', cell('says it could not decide'), 'INCONCLUSIVE'],
    ['its suite lists no such test', cell('no such test'), 'BLOCKED'],
    ['its test file is gone', cell('anything', 'tests/gone.test.mjs'), 'BLOCKED'],
    ['its cell names no test', '—', 'BLOCKED'],
  ].map(([behavior, named, verdict], index) => ({ behavior, issue: `#${index + 1}`, test: named, verdict }));
  const { lines, failures } = judgeRows(rows, runCells(root, rows.map((row) => row.test)));
  assert.deepEqual(lines.map((line) => /^ROW (#\d+ .+?): (\w+)/.exec(line)?.slice(1)), rows.map((row) => [rowName(row), row.verdict]), 'each row reads its own outcome');
  const unpassed = rows.filter((row) => row.verdict !== 'PASS');
  assert.equal(failures.length, unpassed.length, 'only a row that reads PASS passes');
  for (const [index, row] of unpassed.entries()) assert.ok(failures[index].startsWith(`${row.verdict} row ${rowName(row)}:`), `the failure names the row and how it reads: ${failures[index]}`);
  const failureOf = (behavior) => failures.find((failure) => failure.includes(` ${behavior}:`)) ?? '';
  assert.match(failureOf('its test is skipped'), /skipped, not run/);
  assert.match(failureOf('its test says it could not run'), /the binary isn't built/);
  assert.match(failureOf('its test file is gone'), /no such test file: tests\/gone\.test\.mjs/);
});

test('AC2 #3502.e03d1e0d each row that was removed names the upstream change that meets its removal condition, and no row is still carried whose condition the pin has met', () => {
  const [text, base] = [read(REPO, TABLE), carriedRows(showAt(REPO, mergeBase(), TABLE))];
  const head = carriedRows(text);
  if (!base || !head) blocked(`${TABLE} holds no carried-patch table, here or at the merge base`);
  const { removed, failures } = judgeRetired(base, head, retiredRows(text));
  console.log(removed.length ? removed.map((row) => `removed: ${rowName(row)} — ${row.retired?.upstream ?? 'no retired row'}`).join('\n') : 'no row of the merge base was removed');
  assert.deepEqual([...failures, ...judgeMetByPin(head, treeVersion(REPO, 'gpui-pre'), atLeast)], []);
});

// The planted tree: a stub crate with two carried changes, each with its row's test, and the stub release they were
// carried on. The release gives the farewell upstream and not the greeting.
const OURS = "// DeepBuild patch (windoliver/deepbuild#11): the greeting names who it greets.\nexport const greet = (who) => `hello, ${who}`;\nexport const part = (who) => `goodbye, ${who}`;\n";
const RELEASE = "export const greet = () => 'hello';\nexport const part = (who) => `goodbye, ${who}`;\n";
const TESTS = [
  "import assert from 'node:assert/strict';", "import { test } from 'node:test';", "import { greet, part } from '../vendor/stub/lib.mjs';",
  "test('the greeting names who it greets', () => { assert.equal(greet('Ada'), 'hello, Ada'); });",
  "test('the farewell names who leaves', () => { assert.equal(part('Ada'), 'goodbye, Ada'); });", '',
].join('\n');
const GREETING = { behavior: 'The greeting names who it greets', issue: '#11', test: '`tests/carried.test.mjs › the greeting names who it greets`', removal: 'stub greets by name', upstream: 'example/stub#7' };
const FAREWELL = { behavior: 'The farewell names who leaves', issue: '#12', test: '`tests/carried.test.mjs › the farewell names who leaves`', removal: 'stub parts by name', upstream: 'example/stub#9' };

/** The check rows.test.mjs runs on the real tree: the removed rows named, and each one's test run without our change. */
function removedRowsCheck(root, baseText) {
  const text = read(root, TABLE);
  const { removed, failures } = judgeRetired(carriedRows(baseText), carriedRows(text), retiredRows(text));
  const retired = removed.flatMap((row) => (row.retired ? [row.retired] : []));
  return [...failures, ...judgeRows(retired, runCells(root, retired.map((row) => row.test))).failures];
}

test('AC2 #3502.e03d1e0d a planted removal of a row whose condition the release doesn\'t meet fails that row\'s test, naming it; a removal the release meets passes', () => {
  const base = carried([GREETING, FAREWELL]);
  // The farewell's row removed: the release meets its condition, and its test passes on the tree without our change for it.
  const honest = plantTree({ [TABLE]: `${carried([GREETING])}\n${retiredTable([FAREWELL])}`, 'vendor/stub/lib.mjs': OURS, 'tests/carried.test.mjs': TESTS });
  assert.deepEqual(removedRowsCheck(honest, base), []);
  // Planted: the greeting's row removed too, and our change with it, on a release that doesn't greet by name.
  const planted = plantTree({ [TABLE]: `${carried([])}\n${retiredTable([FAREWELL, GREETING])}`, 'vendor/stub/lib.mjs': RELEASE, 'tests/carried.test.mjs': TESTS });
  const failures = removedRowsCheck(planted, base);
  assert.equal(failures.length, 1, `the planted removal fails one row's test: ${failures.join('\n')}`);
  assert.ok(failures[0].startsWith(`FAIL row ${rowName(GREETING)}: its test tests/carried.test.mjs › the greeting names who it greets fails`), `the failure names the row and its test: ${failures[0]}`);
  // A removed row that names no upstream change, and one with no retired row at all, fail by name too.
  const unnamed = plantTree({ [TABLE]: `${carried([GREETING])}\n${retiredTable([{ ...FAREWELL, upstream: 'upstream has it now' }])}`, 'vendor/stub/lib.mjs': OURS, 'tests/carried.test.mjs': TESTS });
  assert.match(removedRowsCheck(unnamed, base).join('\n'), /the retired row #12 The farewell names who leaves names no upstream change/);
  const silent = plantTree({ [TABLE]: carried([GREETING]), 'vendor/stub/lib.mjs': OURS, 'tests/carried.test.mjs': TESTS });
  assert.match(removedRowsCheck(silent, base).join('\n'), /the merge base's row #12 The farewell names who leaves is gone from the table and no retired row/);
});
