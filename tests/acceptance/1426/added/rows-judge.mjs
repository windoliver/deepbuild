// #1426.a17e5e56's judges: a row's test is resolved against its suite's own list, and a row needs a removal
// condition. Each judge answers its failures, one line each; an empty list means the script met the criterion.
// They run `check` on a planted tree with stub releases (common.mjs) and reach no network.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clip, CRATE, linesOf, NODE_TESTS, passes, planted, README, readTable, repoRoot, rowTest, RUST_TESTS, testCell, VITEST_TESTS } from './common.mjs';

const GRADIENT = 'The planted gradient';
const SWITCH_ROW = 'The planted switch';
const failsNaming = (run, ...names) => linesOf(run.output, 'FAIL').some((line) => names.every((name) => (Array.isArray(name) ? name.some((one) => line.includes(one)) : line.includes(name))));

/** The plant as it stands passes `check`: every row's test is in its suite, every row has a removal condition. */
export function judgeClean(script) {
  return planted(script, () => null, (run) => (passes(run) ? [] : [`the plant as it stands fails check (exit ${run.status}): ${clip(run.output)}`]));
}

/**
 * Row 0 (`The planted gradient`) names `cell`; `fails` says whether `check` must refuse it, naming the row and one of
 * `names`. `extra(box)` plants more first.
 */
function rowCase(script, what, { row = 0, cell, fails, names = [], extra = () => null }) {
  const behavior = [GRADIENT, 'The planted surface', SWITCH_ROW][row];
  return planted(script, (box) => {
    extra(box);
    box.rows((rows) => { rows[row].test = cell; });
  }, (run) => {
    if (!fails) return passes(run) ? [] : [`${what}: check fails (exit ${run.status}): ${clip(run.output)}`];
    if (run.status === 0) return [`${what}: check passes`];
    return failsNaming(run, behavior, names) ? [] : [`${what}: check fails without a FAIL line naming the row (${behavior}) and the test (${names.join(' or ')}): ${clip(run.output)}`];
  });
}

/** node --test: names its list resolves, and names it doesn't, in a test file that exists and one that doesn't. */
export function judgeNodeTests(script) {
  const failures = judgeClean(script);
  if (failures.length) return failures;
  const every = 'gradient keeps every stop';
  const addEvery = (box) => box.write(NODE_TESTS, `${box.read(NODE_TESTS)}test('${every}', () => {});\n`);
  failures.push(
    // The criterion's pair: the same row, first naming a test that doesn't exist, then one that does.
    ...rowCase(script, `a row naming "${every}", which ${NODE_TESTS} holds only in a comment`, { cell: testCell(every), fails: true, names: [every] }),
    ...rowCase(script, `the same row once ${NODE_TESTS} has a test named "${every}"`, { cell: testCell(every), fails: false, extra: addEvery }),
    // A script that doesn't exist.
    ...rowCase(script, 'a row naming a test in a file that is gone', { cell: testCell('gradient keeps its stops', 'tests/planted/gone.test.mjs'), fails: true, names: ['tests/planted/gone.test.mjs', 'gone.test.mjs'] }),
    // A name that is only part of a test's name is no test in the list.
    ...rowCase(script, 'a row naming "gradient keeps", the start of a test\'s name', { cell: testCell('gradient keeps'), fails: true, names: ['gradient keeps'] }),
    // A name the file holds only as a string.
    ...rowCase(script, 'a row naming "gradient keeps no stops", a string in the test file', { cell: testCell('gradient keeps no stops'), fails: true, names: ['gradient keeps no stops'] }),
    // Scope: "Each row names its test by full path".
    ...rowCase(script, 'a row naming its test file by its bare name, not its path', { cell: testCell('gradient keeps its stops', 'carried.test.mjs'), fails: true, names: ['carried.test.mjs', 'gradient keeps its stops'] }),
  );
  return failures;
}

/** vitest: the list `vitest list` gives. Needs the repo's node_modules, linked into the plant. */
export function judgeVitestTests(script) {
  if (!existsSync(join(repoRoot, 'node_modules/vitest/vitest.mjs'))) return ['INCONCLUSIVE: no node_modules/vitest in the repo; run npm ci'];
  const every = 'gradient keeps every stop';
  return [
    ...rowCase(script, `a row naming ${VITEST_TESTS}'s test "gradient keeps its stops"`, { cell: testCell('gradient keeps its stops', VITEST_TESTS), fails: false }),
    ...rowCase(script, `a row naming "${every}", which ${VITEST_TESTS} holds only in a comment`, { cell: testCell(every, VITEST_TESTS), fails: true, names: [every] }),
  ];
}

/** cargo test: the list `cargo test -- --list` gives in the test's crate. Needs cargo. */
export function judgeCargoTests(script) {
  if (spawnSync('cargo', ['--version'], { encoding: 'utf8' }).status !== 0) return ['INCONCLUSIVE: no cargo on PATH'];
  return [
    ...rowCase(script, `a row naming ${RUST_TESTS}'s test tests::switch_denies_the_engine`, { row: 2, cell: testCell('tests::switch_denies_the_engine', RUST_TESTS), fails: false }),
    ...rowCase(script, 'a row naming tests::switch_allows_the_engine, which the crate lacks', { row: 2, cell: testCell('tests::switch_allows_the_engine', RUST_TESTS), fails: true, names: ['switch_allows_the_engine'] }),
    ...rowCase(script, `a row naming tests::not_a_test, a function of ${CRATE} that is no test`, { row: 2, cell: testCell('tests::not_a_test', RUST_TESTS), fails: true, names: ['not_a_test'] }),
  ];
}

/** A row with no removal condition fails, naming the row; "none" counts only with a reason. */
export function judgeRemoval(script) {
  const failures = judgeClean(script);
  if (failures.length) return failures;
  for (const [what, removal] of [['an empty Removal cell', ''], ['a dash in the Removal cell', '—'], ['"none" with no reason', 'none'], ['"none:" with no reason', 'none:']]) {
    failures.push(...planted(script, (box) => box.rows((rows) => { rows[2].removal = removal; }), (run) => {
      if (run.status === 0) return [`a row with ${what} passes check`];
      return failsNaming(run, SWITCH_ROW) ? [] : [`a row with ${what} fails check without a FAIL line naming the row (${SWITCH_ROW}): ${clip(run.output)}`];
    }));
  }
  return failures;
}

/**
 * The real tree's table: each row has a removal condition, and names its test by a repo path whose file holds the
 * test's name. A necessary condition only: the planted cases above prove the list is the suite's own.
 */
export function judgeRealRows(root = repoRoot) {
  const path = join(root, README);
  const table = existsSync(path) ? readTable(readFileSync(path, 'utf8')) : null;
  if (!table) return [`${README} has no table under ## Carried patches`];
  if (!table.header.includes('Removal')) return [`the table's columns are ${table.header.join(', ')}, with no Removal`];
  if (!table.rows.length) return ['the table has no rows'];
  const failures = [];
  for (const row of table.rows) {
    const removal = row.Removal.trim();
    if (!removal || /^[—–-]$/.test(removal) || /^none:?$/i.test(removal)) failures.push(`row ${row.Behavior} has no removal condition: "${removal}"`);
    const test = rowTest(row.Test);
    if (!test) failures.push(`row ${row.Behavior} names no test: "${row.Test}"`);
    else if (!existsSync(join(root, test.path))) failures.push(`row ${row.Behavior} names ${test.path}, which isn't in the repo`);
    else {
      const last = test.name.split(/ › |::/).at(-1);
      if (!readFileSync(join(root, test.path), 'utf8').includes(last)) failures.push(`row ${row.Behavior}'s test file ${test.path} doesn't hold "${last}"`);
    }
  }
  return failures;
}
