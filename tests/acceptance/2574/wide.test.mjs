// Acceptance tests for #2574 AC3, "A process started through another package is wide", written blind from the issue
// at base 1ab891283 (README.md). Surface: select(cwd, changed, { files, workspace }) from scripts/affected.mjs, and
// `node scripts/affected.mjs --list` for the informative count on the real tree.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { select } from '../../../scripts/affected.mjs';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const scratch = [];
after(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });

const starts = (path) => `import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
test('starts', () => { spawnSync(process.execPath, ['${path}']); });
`;

// The issue's fixture: @deepbuild/a depends on @deepbuild/b, packages/a/src/main.ts imports @deepbuild/b, and three
// tests, t1 and t2 starting packages/a/dist/main.js and t3 starting packages/b/dist/main.js. `extra` adds files.
function fixture(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'acc-2574-wide-'));
  scratch.push(root);
  const tree = {
    'package.json': JSON.stringify({ name: 'fixture', private: true, workspaces: ['packages/*'] }),
    'packages/a/package.json': JSON.stringify({ name: '@deepbuild/a', type: 'module', exports: './dist/main.js', dependencies: { '@deepbuild/b': '*' } }),
    'packages/a/src/main.ts': "import { b } from '@deepbuild/b';\nconsole.log(b());\n",
    'packages/b/package.json': JSON.stringify({ name: '@deepbuild/b', type: 'module', exports: './dist/index.js' }),
    'packages/b/src/index.ts': "export function b(): string {\n  return 'b';\n}\n",
    'tests/t1.test.mjs': starts('packages/a/dist/main.js'),
    'packages/b/test/t2.test.mjs': starts('packages/a/dist/main.js'),
    'tests/t3.test.mjs': starts('packages/b/dist/main.js'),
    ...extra,
  };
  for (const [path, text] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, files: Object.keys(tree).sort() };
}

test('AC3 table: a change to packages/b/src/index.ts selects t2 and t3; t1, which starts package a, is wide', () => {
  const { root, files } = fixture();
  const result = select(root, ['packages/b/src/index.ts'], { files, workspace: [] });
  assert.deepEqual([...result.tests].sort(), ['packages/b/test/t2.test.mjs', 'tests/t3.test.mjs']);
  assert.deepEqual([...result.wide].sort(), ['tests/t1.test.mjs']);
});

test('AC3 table: a change to packages/a/src/main.ts selects t1 and t2, and nothing is wide', () => {
  const { root, files } = fixture();
  const result = select(root, ['packages/a/src/main.ts'], { files, workspace: [] });
  assert.deepEqual([...result.tests].sort(), ['packages/b/test/t2.test.mjs', 'tests/t1.test.mjs']);
  assert.deepEqual([...result.wide], []);
});

test('AC3: a test that imports the changed file is selected as before, not wide', () => {
  const { root, files } = fixture({
    'tests/t4.test.mjs': "import { test } from 'node:test';\nimport { b } from '../packages/b/src/index.ts';\ntest('b', () => b());\n",
  });
  const result = select(root, ['packages/b/src/index.ts'], { files, workspace: [] });
  assert.ok(result.tests.includes('tests/t4.test.mjs'), `tests: ${result.tests.join(' ')}`);
  assert.ok(!result.wide.includes('tests/t4.test.mjs'), `wide: ${result.wide.join(' ')}`);
});

// Informative: the issue expects about 115 selected in place of 1,205 and about 1,090 wide for this change; the tree
// has moved since its base, so the bounds are loose.
test('AC3 (informative): on the real tree, a hub change selects far fewer files and lists the rest as WIDE', () => {
  const out = spawnSync(process.execPath, ['scripts/affected.mjs', '--list', 'packages/hub/src/log-reads.ts'], { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });
  assert.equal(out.status, 0, out.stderr);
  const lines = out.stdout.split('\n');
  const selected = lines.filter((line) => /^(?:parallel|alone|timed|slow) (?:vitest|node): /.test(line))
    .flatMap((line) => line.replace(/^\S+ \S+: /, '').replace(/ \(--\w+ runs them\)$/, '').split(' ').filter(Boolean)).length
    + lines.filter((line) => line.startsWith('SKIP ')).length;
  const wide = Number(lines.find((line) => line.startsWith('WIDE '))?.match(/^WIDE (\d+) /)?.[1] ?? 0);
  assert.ok(selected < 250, `selected ${selected} test files, expected about 115`);
  assert.ok(wide > 800, `WIDE lists ${wide}, expected about 1,090`);
});
