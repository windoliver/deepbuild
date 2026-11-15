// #2574 AC3: a process started through another package is wide. `select(cwd, changed, { files, workspace })` of
// scripts/affected.mjs, called in a child process on the issue's own fixture: @deepbuild/a depends on @deepbuild/b,
// packages/a/src/main.ts imports @deepbuild/b, tests/t1.test.mjs and packages/b/test/t2.test.mjs start
// packages/a/dist/main.js and tests/t3.test.mjs starts packages/b/dist/main.js. The WIDE line is read from
// `node scripts/affected.mjs --list` run in a scratch tree holding the same fixture.
import assert from 'node:assert/strict';
import test from 'node:test';
import { affected, affectedTree, dump, repository, sandbox, select } from './helpers.mjs';

const starts = (build) => `import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
test('the build answers', () => {
  assert.equal(spawnSync(process.execPath, ['${build}'], { encoding: 'utf8' }).status, 0);
});
`;
const T1 = 'tests/t1.test.mjs', T2 = 'packages/b/test/t2.test.mjs', T3 = 'tests/t3.test.mjs';
const FIXTURE = {
  'packages/a/package.json': `${JSON.stringify({ name: '@deepbuild/a', version: '0.0.0', dependencies: { '@deepbuild/b': '0.0.0' } }, null, 2)}\n`,
  'packages/a/src/main.ts': 'import { b } from \'@deepbuild/b\';\nconsole.log(b);\n',
  'packages/b/package.json': `${JSON.stringify({ name: '@deepbuild/b', version: '0.0.0' }, null, 2)}\n`,
  'packages/b/src/index.ts': 'export const b = 1;\n',
  'packages/b/src/main.ts': 'import { b } from \'./index.js\';\nconsole.log(b);\n',
  [T1]: starts('packages/a/dist/main.js'),
  [T2]: starts('packages/a/dist/main.js'),
  [T3]: starts('packages/b/dist/main.js'),
};

function chosen(t, changed, files = FIXTURE, workspace = []) {
  const box = sandbox(t);
  const cwd = repository(box, 'repo', files);
  return select(box, cwd, [changed], { files: Object.keys(files).sort(), workspace });
}

test('#2574 AC3 a change to packages/b/src/index.ts selects t2, in its own package folder, and t3, which starts b; t1, which starts a from outside, is wide', (t) => {
  const { tests, wide } = chosen(t, 'packages/b/src/index.ts');
  assert.deepEqual({ tests, wide }, { tests: [T2, T3], wide: [T1] });
});

test('#2574 AC3 a change to packages/a/src/main.ts selects t1 and t2, which start a itself, and nothing is wide', (t) => {
  const { tests, wide } = chosen(t, 'packages/a/src/main.ts');
  assert.deepEqual({ tests, wide }, { tests: [T2, T1], wide: [] });
});

test('#2574 AC3 tests that import the changed file, name its path or run a changed crate are selected as before, never wide', (t) => {
  const IMPORTS = 'tests/imports.test.mjs', NAMES = 'tests/names.test.mjs', RUNS = 'tests/runs.test.mjs';
  const files = {
    ...FIXTURE,
    [IMPORTS]: 'import test from \'node:test\';\nimport { b } from \'../packages/b/src/index.ts\';\ntest(\'b\', () => { if (b !== 1) throw Error(\'b\'); });\n',
    [NAMES]: 'import { readFileSync } from \'node:fs\';\nimport test from \'node:test\';\ntest(\'the source\', () => { readFileSync(\'packages/b/src/index.ts\', \'utf8\'); });\n',
    [RUNS]: starts('target/debug/fx2574-bin'),
    'crates/fx2574/Cargo.toml': '[package]\nname = "fx2574"\nversion = "0.0.0"\n',
    'crates/fx2574/src/main.rs': 'fn main() {}\n',
  };
  const workspace = [{ name: 'fx2574', dir: 'crates/fx2574', away: [], deps: [], names: ['fx2574', 'fx2574-bin'], targets: [] }];
  const source = chosen(t, 'packages/b/src/index.ts', files, workspace);
  for (const file of [IMPORTS, NAMES]) {
    assert.ok(source.tests.includes(file), `${file} is not selected by a change to packages/b/src/index.ts: ${JSON.stringify(source)}`);
    assert.ok(!source.wide.includes(file), `${file} is wide for a change to packages/b/src/index.ts: ${JSON.stringify(source)}`);
  }
  const crate = chosen(t, 'crates/fx2574/src/main.rs', files, workspace);
  assert.deepEqual({ tests: crate.tests, crates: crate.crates, wide: crate.wide }, { tests: [RUNS], crates: ['fx2574'], wide: [] });
});

test('#2574 AC3 the wide test is listed on the WIDE line of affected.mjs --list, and the selected ones in its blocks', async (t) => {
  const box = sandbox(t);
  const tree = affectedTree(box, FIXTURE);
  const run = await affected(box, tree, ['--list', 'packages/b/src/index.ts']).done;
  const all = dump(box, run);
  assert.equal(run.status, 0, all);
  const lines = run.stdout.split('\n');
  const wide = lines.filter((line) => line.startsWith('WIDE '));
  assert.equal(wide.length, 1, `affected.mjs --list printed ${wide.length} WIDE lines\n${all}`);
  assert.match(wide[0], /^WIDE 1 more /, all);
  assert.ok(wide[0].split(' ').includes(T1), `the WIDE line does not list ${T1}\n${all}`);
  const selected = lines.filter((line) => /^parallel node: /.test(line)).flatMap((line) => line.split(' ').slice(2));
  assert.deepEqual(selected.sort(), [T2, T3], `the blocks hold other files than t2 and t3\n${all}`);
});
