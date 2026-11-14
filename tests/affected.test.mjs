import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { cargoResults, classify, crates, lintFindings, plan, reportResults, runnerOf, select } from '../scripts/affected.mjs';

/** A repository of the given files in a temporary folder, removed after the test. */
function repo(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'deep-affected-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof text === 'string' ? text : JSON.stringify(text));
  }
  return { root, files: Object.keys(files) };
}
const pkg = (name, dependencies = {}) => ({ name: `@deepbuild/${name}`, exports: { types: './src/index.ts', development: './src/index.ts', default: './dist/index.js' }, dependencies });
const vitest = (body) => `import { test } from 'vitest';\n${body}\ntest('runs', () => {});\n`;

// Package a's entry passes on `deep` from inner.ts, which calls leaf.ts, and `other` from other.ts; b calls `deep`
// through a's entry, and c runs b. The tests reach them by import, by path and by starting a build.
const packages = {
  'packages/a/package.json': pkg('a'),
  'packages/a/src/index.ts': "export { deep } from './inner.ts';\nexport { other } from './other.ts';\n",
  'packages/a/src/inner.ts': "import { leaf } from './leaf.ts';\nexport const deep = () => leaf();\n",
  'packages/a/src/leaf.ts': 'export const leaf = () => 1;\n',
  'packages/a/src/other.ts': 'export const other = 2;\n',
  'packages/b/package.json': pkg('b', { '@deepbuild/a': '0.0.0' }),
  'packages/b/src/index.ts': "import { deep } from '@deepbuild/a';\nexport const b = () => deep();\n",
  'packages/c/package.json': pkg('c', { '@deepbuild/b': '0.0.0' }),
  'packages/c/src/index.ts': "import { b } from '@deepbuild/b';\nconsole.log(b());\n",
  'tests/acceptance/1/helpers.ts': "export { b } from '../../../packages/b/src/index.ts';\n",
  'tests/acceptance/1/b.test.ts': vitest("import { b } from './helpers.ts';\nb();"),
  'tests/acceptance/2/other.test.ts': vitest("import { other } from '@deepbuild/a';\nother;"),
  'tests/acceptance/3/types.test.ts': vitest("import type { deep } from '@deepbuild/a';\nimport { type leaf } from '../../../packages/a/src/leaf.ts';"),
  'tests/acceptance/4/entry.test.ts': vitest("const ENTRY = '../../../packages/a/src/index.ts';\nawait import(new URL(ENTRY, import.meta.url).href);"),
  'tests/acceptance/5/b-build.test.mjs': "import test from 'node:test';\nimport { spawnSync } from 'node:child_process';\ntest('b', () => spawnSync('node', ['packages/b/dist/index.js']));\n",
  'tests/acceptance/6/c-build.test.mjs': "import test from 'node:test';\nimport { spawnSync } from 'node:child_process';\ntest('c', () => spawnSync('node', [`${process.cwd()}/packages/c/dist/index.js`]));\n",
  'tests/acceptance/7/fixtures/case.json': '{}',
  'tests/acceptance/7/case.test.ts': vitest("import { readFileSync } from 'node:fs';\nreadFileSync(new URL(['fixtures', 'case.json'].join('/'), import.meta.url));"),
  'tests/acceptance/7/other.test.ts': vitest(''),
};

test('a change reaches the tests that import it, near or far, through the packages\' entries, and no others', (t) => {
  const { root, files } = repo(t, packages);
  const { tests } = select(root, ['packages/a/src/leaf.ts'], { files, workspace: [] });
  // Four imports away; a selector that follows only direct importers, takes a's whole entry for `deep` (so other.test.ts
  // too) or counts a type-only import fails here.
  assert.deepEqual(tests, ['tests/acceptance/1/b.test.ts', 'tests/acceptance/4/entry.test.ts', 'tests/acceptance/5/b-build.test.mjs']);
  // A change to the entry itself reaches everything imported through it by name.
  assert.deepEqual(select(root, ['packages/a/src/index.ts'], { files, workspace: [] }).tests,
    ['tests/acceptance/1/b.test.ts', 'tests/acceptance/2/other.test.ts', 'tests/acceptance/4/entry.test.ts', 'tests/acceptance/5/b-build.test.mjs']);
});

test('a test starting a package\'s build sees that package and the ones it depends on; deeper is wide, and a fixture reaches its folder', (t) => {
  const { root, files } = repo(t, packages);
  // c's build reaches leaf.ts only through b, which c depends on, and a, which it doesn't.
  const deep = select(root, ['packages/a/src/leaf.ts'], { files, workspace: [] });
  assert.equal(deep.tests.includes('tests/acceptance/6/c-build.test.mjs'), false);
  assert.deepEqual(deep.wide, ['tests/acceptance/6/c-build.test.mjs']);
  const near = select(root, ['packages/b/src/index.ts'], { files, workspace: [] });
  assert.deepEqual(near.tests, ['tests/acceptance/1/b.test.ts', 'tests/acceptance/5/b-build.test.mjs', 'tests/acceptance/6/c-build.test.mjs']);
  assert.deepEqual(near.wide, []);
  // A fixture its test reads by a path built at run time reaches the tests of its own folder; a doc reaches none.
  const fixture = select(root, ['tests/acceptance/7/fixtures/case.json', 'packages/a/README.md', 'packages/a/notes.txt'], { files, workspace: [] });
  assert.deepEqual(fixture.tests, ['tests/acceptance/7/case.test.ts', 'tests/acceptance/7/other.test.ts']);
  assert.deepEqual(fixture.none, ['packages/a/notes.txt']);
});

test('a test the change deletes is left out of the run, and the tests naming it still run', (t) => {
  const { root, files } = repo(t, {
    'tests/acceptance/10/names.test.mjs': "import test from 'node:test';\nimport { existsSync } from 'node:fs';\ntest('gone', () => existsSync('tests/acceptance/10/gone.test.ts'));\n",
  });
  const { tests } = select(root, ['tests/acceptance/10/gone.test.ts'], { files, workspace: [] });
  assert.deepEqual(tests, ['tests/acceptance/10/names.test.mjs']);
  assert.deepEqual(plan(root, tests).blocks.parallel.node, ['tests/acceptance/10/names.test.mjs']);
});

const cargo = {
  'Cargo.toml': '[workspace]\nmembers = ["crates/r1", "crates/r2", "crates/r3"]\nresolver = "2"\n',
  'crates/r1/Cargo.toml': '[package]\nname = "r1"\nversion = "0.0.0"\nedition = "2021"\n',
  'crates/r1/src/lib.rs': 'pub fn one() -> u8 { 1 }\n',
  'crates/r2/Cargo.toml': '[package]\nname = "r2"\nversion = "0.0.0"\nedition = "2021"\n\n[dependencies]\nr1 = { path = "../r1" }\n\n[[test]]\nname = "acceptance_8"\npath = "../../tests/acceptance/8/card.rs"\nharness = false\n',
  'crates/r2/src/lib.rs': 'pub fn two() -> u8 { r1::one() + 1 }\n',
  'crates/r2/src/main.rs': 'fn main() {}\n',
  'crates/r3/Cargo.toml': '[package]\nname = "r3"\nversion = "0.0.0"\nedition = "2021"\n',
  'crates/r3/src/lib.rs': 'pub fn three() -> u8 { 3 }\n',
  'tests/acceptance/8/card.rs': 'fn main() { let _ = std::process::Command::new("node").arg("packages/a/dist/index.js"); }\n',
  'tests/acceptance/9/runs-r1.test.mjs': "import test from 'node:test';\nimport { spawnSync } from 'node:child_process';\ntest('r1', () => spawnSync('cargo', ['test', '-p', 'r1']));\n",
  'tests/acceptance/9/runs-r2.test.mjs': "import test from 'node:test';\nimport { spawnSync } from 'node:child_process';\ntest('r2', () => spawnSync('target/debug/r2'));\n",
  ...Object.fromEntries(['packages/a/package.json', 'packages/a/src/index.ts', 'packages/a/src/inner.ts', 'packages/a/src/leaf.ts', 'packages/a/src/other.ts'].map((path) => [path, packages[path]])),
};

test('a Rust change reaches its crate and the crates depending on it, their [[test]] files outside them, and the tests that run it', (t) => {
  const { root, files } = repo(t, cargo);
  const workspace = crates(root);
  const r1 = select(root, ['crates/r1/src/lib.rs'], { files, workspace });
  // r3 doesn't depend on r1; a selector that skips dependents drops r2.
  assert.deepEqual(r1.crates, ['r1', 'r2']);
  assert.deepEqual(r1.owners, ['r1']);
  // The test that runs r1 sees it; the one running r2's binary is left to r2's own cargo tests.
  assert.deepEqual(r1.tests, ['tests/acceptance/9/runs-r1.test.mjs']);
  // A [[test]] file outside its crate belongs to it, and a Rust test starting a package's build sees the package.
  assert.deepEqual(select(root, ['tests/acceptance/8/card.rs'], { files, workspace }).crates, ['r2']);
  assert.deepEqual(select(root, ['packages/a/src/leaf.ts'], { files, workspace }).crates, ['r2']);
});

test('each test runs with its own runner, alone or in parallel as lanes.mjs says, and never one it leaves to a person', (t) => {
  const { root } = repo(t, {
    'tests/acceptance/348/a.test.ts': vitest(''),
    'tests/acceptance/350/b.test.ts': vitest('const twin = `import test from \'node:test\';`;'),
    'tests/acceptance/350/c.test.mjs': "import test from 'node:test';\nconst twin = `import { test } from 'vitest';`;\n",
    'tests/acceptance/350/d.test.ts': "import test from 'node:test';\n",
    'tests/acceptance/685/e.test.ts': vitest(''),
    'tests/acceptance/48/f.live.test.mjs': "import test from 'node:test';\n",
    'tests/acceptance/684/lean.test.ts': vitest(''),
  });
  const { blocks, skipped } = plan(root, ['tests/acceptance/348/a.test.ts', 'tests/acceptance/350/b.test.ts', 'tests/acceptance/350/c.test.mjs', 'tests/acceptance/350/d.test.ts',
    'tests/acceptance/685/e.test.ts', 'tests/acceptance/48/f.live.test.mjs', 'tests/acceptance/684/lean.test.ts']);
  assert.deepEqual(blocks, { parallel: { vitest: ['tests/acceptance/350/b.test.ts'], node: ['tests/acceptance/350/c.test.mjs', 'tests/acceptance/350/d.test.ts'] }, alone: { vitest: ['tests/acceptance/348/a.test.ts'], node: [] } });
  assert.deepEqual(skipped, ['tests/acceptance/685/e.test.ts (by hand)', 'tests/acceptance/48/f.live.test.mjs (by hand)', 'tests/acceptance/684/lean.test.ts (a lane of its own)']);
  assert.equal(runnerOf('x.test.mjs', "import { describe } from 'vitest';"), 'vitest');
});

test('results come from the runners\' reports and cargo\'s lines, each by an ID that reruns it', (t) => {
  const { root } = repo(t, cargo);
  const report = [
    { type: 'start', file: join(root, 'tests/x.test.mjs'), name: 'suite', nesting: 0 },
    { type: 'start', file: join(root, 'tests/x.test.mjs'), name: 'budget', nesting: 1 },
    { type: 'fail', file: join(root, 'tests/x.test.mjs'), name: 'budget', nesting: 1, error: { message: 'Error: BLOCKED: on battery' } },
    { type: 'fail', file: join(root, 'tests/x.test.mjs'), name: 'suite', nesting: 0, suite: true, error: { message: '1 subtest failed' } },
    { type: 'pass', file: join(root, 'tests/y.test.ts'), name: 'top › inner' },
  ].map((row) => JSON.stringify(row)).join('\n');
  assert.deepEqual(reportResults(root, report, 'node'), { failures: [{ id: 'tests/x.test.mjs › suite › budget', state: 'BLOCKED', message: 'Error: BLOCKED: on battery' }], passed: ['tests/y.test.ts › top › inner'] });
  const output = ['     Running unittests src/lib.rs (target/debug/deps/r1-0123abcd)', 'test tests::a ... ok', 'test tests::b ... FAILED', 'error: test failed, to rerun pass `-p r1 --lib`',
    '     Running ../../tests/acceptance/8/card.rs (target/debug/deps/acceptance_8-89abcdef)', 'error: test failed, to rerun pass `-p r2 --test acceptance_8`'].join('\n');
  assert.deepEqual(cargoResults(output, 101, crates(root)), {
    failures: [{ id: 'cargo -p r1 --lib › tests::b', state: 'FAIL', message: '' }, { id: 'cargo -p r2 --test acceptance_8', state: 'FAIL', message: 'the target failed outside any test it reported' }],
    passed: ['cargo -p r1 --lib › tests::a'],
  });
});

test('a failure main already has reads apart from a new one, and a timing budget missed under load is INCONCLUSIVE', () => {
  const baseline = { failures: { 'tests/a.test.ts › old': 'fails on main' }, lint: { 'canvas-lint: crates/x/src/a.rs a static item': 1 }, timing: ['tests/b.test.ts › budget'] };
  const failures = [
    { id: 'tests/a.test.ts › old', state: 'FAIL', message: 'x' }, { id: 'tests/a.test.ts › fresh', state: 'FAIL', message: 'y' },
    { id: 'tests/b.test.ts › budget', state: 'FAIL', message: 'took 3 s' }, { id: 'tests/c.test.ts › blocked', state: 'BLOCKED', message: 'no Lean' },
  ];
  // The same finding at another line is main's; a second one is new.
  const findings = lintFindings('/repo', 'canvas-lint', 'FAIL canvas-lint: crates/x/src/a.rs:12:3 a static item\nFAIL canvas-lint: crates/x/src/a.rs:40:1 a static item\n', 1);
  const { known, fresh, unsure } = classify(failures, findings, baseline);
  assert.deepEqual(known.map(({ id }) => id), ['tests/a.test.ts › old', 'canvas-lint: crates/x/src/a.rs a static item']);
  assert.deepEqual(fresh.map(({ id }) => id), ['tests/a.test.ts › fresh', 'canvas-lint: crates/x/src/a.rs a static item']);
  assert.deepEqual(unsure.map(({ id, state }) => `${state} ${id}`), ['INCONCLUSIVE tests/b.test.ts › budget', 'BLOCKED tests/c.test.ts › blocked']);
  // Clippy and rustfmt findings key by file without lines, as lint findings do.
  assert.deepEqual(lintFindings('/repo', 'clippy', 'error: this `map_or` can be simplified\n   --> crates/r/../../tests/acceptance/327/card.rs:452:17\nDiff in /repo/tests/acceptance/327/common.rs:3:\n', 101).map(({ key }) => key),
    ['clippy: tests/acceptance/327/card.rs this `map_or` can be simplified', 'fmt: tests/acceptance/327/common.rs']);
});

test('a report line that can\'t be parsed, such as a record a full disk cut short with the next glued on, reads INCONCLUSIVE for each file it names, and the rest still reads', (t) => {
  const { root } = repo(t, {});
  const record = (type, file, name) => JSON.stringify({ type, file: join(root, file), name });
  const cut = record('skip', 'tests/b.test.ts', 'two');
  const report = [record('pass', 'tests/a.test.ts', 'one'), cut.slice(0, cut.indexOf('"name"') + 10) + record('fail', 'tests/c.test.ts', 'three'), '{"type":"pass","fi',
    record('pass', 'tests/e.test.ts', 'five').slice(0, -20) + record('fail', 'tests/f.test.ts', 'six'), record('pass', 'tests/d.test.ts', 'four')].join('\n');
  const { failures, passed } = reportResults(root, report, 'node');
  // A cut inside a record's file names no file of its own, so the line answers for it.
  assert.deepEqual(failures.map(({ id, state }) => `${state} ${id}`), ['INCONCLUSIVE tests/b.test.ts › (file)', 'INCONCLUSIVE tests/c.test.ts › (file)', 'INCONCLUSIVE report line 3', 'INCONCLUSIVE report line 4', 'INCONCLUSIVE tests/f.test.ts › (file)']);
  assert.deepEqual(passed, ['tests/a.test.ts › one', 'tests/d.test.ts › four']);
});

// A file-size limit cuts a write short at the limit and refuses the next, as a full disk does; prlimit lifts it mid-run.
test('the vitest reporter finishes a record a full disk cut short once space is back, and a record that never lands leaves its report unfinished, never a pass', { skip: process.platform !== 'linux' && 'prlimit is Linux\'s' }, (t) => {
  const { root } = repo(t, {});
  const report = join(root, 'vitest.jsonl');
  // The first record runs past the limit, or with fit it ends exactly at it, so the next is refused whole.
  const first = (fit) => 'a'.repeat(fit ? 4096 - Buffer.byteLength(`${JSON.stringify({ type: 'pass', file: join(root, 'tests/a.test.ts'), name: '' })}\n`) : 6000);
  const child = (name, lift) => {
    rmSync(report, { force: true });
    return spawnSync('prlimit', ['--fsize=4096:unlimited', process.execPath, '--input-type=module', '-e', `
      import { spawnSync } from 'node:child_process';
      const { default: Reporter } = await import(${JSON.stringify(new URL('../scripts/proof-vitest-reporter.mjs', import.meta.url).href)});
      const reporter = new Reporter();
      const result = (file, name, state) => { try { reporter.onTestCaseResult({ name, parent: { type: 'module' }, module: { moduleId: ${JSON.stringify(root)} + file }, result: () => ({ state, errors: [] }) }); } catch {} };
      result('/tests/a.test.ts', ${JSON.stringify(name)}, 'passed');
      if (${lift}) spawnSync('prlimit', ['--pid', String(process.pid), '--fsize=unlimited']);
      result('/tests/b.test.ts', 'b', 'failed');
      reporter.onTestRunEnd([], []);
    `], { env: { ...process.env, DEEP_PROOF_VITEST_REPORT: report }, encoding: 'utf8' });
  };
  assert.equal(child(first(false), true).status, 0);
  assert.deepEqual(reportResults(root, readFileSync(report, 'utf8'), 'vitest'), { failures: [{ id: 'tests/b.test.ts › b', state: 'FAIL', message: '' }], passed: [`tests/a.test.ts › ${first(false)}`] });
  // Space that never comes back fails the run naming the report, and the part that landed reads INCONCLUSIVE, never a pass.
  const full = child(first(false), false);
  assert.notEqual(full.status, 0);
  assert.match(full.stderr, /vitest\.jsonl/);
  assert.deepEqual(reportResults(root, readFileSync(report, 'utf8'), 'vitest').failures.map(({ id, state }) => `${state} ${id}`), ['INCONCLUSIVE tests/a.test.ts › (file)', 'INCONCLUSIVE vitest report']);
  // A failure refused whole leaves no part to read, and the report that never finished still holds the run unknown.
  child(first(true), false);
  assert.equal(readFileSync(report).length, 4096);
  assert.deepEqual(reportResults(root, readFileSync(report, 'utf8'), 'vitest').failures.map(({ id, state }) => `${state} ${id}`), ['INCONCLUSIVE vitest report']);
});
