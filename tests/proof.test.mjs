// Regressions of the proof lanes (#569) that its acceptance suite doesn't cover.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { ISSUE, criterionId, git, named, problems, proof, repo, root, show, strykerPresent, write } from './acceptance/569/helpers.mjs';

const c1 = criterionId(ISSUE, 'Adds');
const dir = `tests/acceptance/${ISSUE}`;
const tagged = (name) => `test('${c1} ${name}', () => {\n  assert.equal(1 + 1, 2);\n});\n`;
const file = (...names) => `import assert from 'node:assert/strict';\nimport test from 'node:test';\n\n${names.map(tagged).join('\n')}`;

test('deleting one tagged test names that test alone, not the tests beside it', (t) => {
  const scene = repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { [`${dir}/a.test.mjs`]: file('first', 'second', 'third') },
    commits: [{ files: { [`${dir}/a.test.mjs`]: file('first', 'third') }, message: `Drop a test\n\nPart of #${ISSUE}` }],
  });
  const result = proof(scene, ['guard']);
  const found = problems(result, 'guard');
  assert.equal(found.length, 1, show(result));
  assert.match(found[0], new RegExp(`${named(`${dir}/a.test.mjs`, `${c1} second`).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: deleted`), show(result));
});

// A tagged test that runs the lanes, as #569's own do, runs them under the mutant StrykerJS made
// active for it; the runs they start must not inherit that mutant, or every mutant reads killed.
test("the lanes don't hand StrykerJS's active mutant to the tests they run", (t) => {
  const check = `test('${c1} sees no mutant', () => {\n  assert.equal(process.env.__STRYKER_ACTIVE_MUTANT__, undefined);\n});\n`;
  const scene = repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    commits: [{ files: { [`${dir}/a.test.mjs`]: `import assert from 'node:assert/strict';\nimport test from 'node:test';\n\n${check}` }, message: `Add\n\nPart of #${ISSUE}` }],
  });
  const result = proof(scene, ['before'], { __STRYKER_ACTIVE_MUTANT__: '3' });
  assert.ok(!result.lines.some((line) => line.includes('fails on the change')), show(result));
});

// A blank line inside a string or template outside every test is data a tagged test may compare, so
// removing it edits that test, though a blank line between statements, as a deleted test leaves, doesn't.
const receipt = (blank) => `import assert from 'node:assert/strict';\nimport test from 'node:test';\n\nconst expected = \`tea 3\n${blank ? '\n' : ''}cake 4\`;\n\ntest('${c1} separates items', () => {\n  assert.equal(expected.split('\\n').length, 3);\n});\n`;

test('removing a blank line inside a template outside the tests edits the tagged test that reads it', (t) => {
  const scene = repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { [`${dir}/a.test.mjs`]: receipt(true) },
    commits: [{ files: { [`${dir}/a.test.mjs`]: receipt(false) }, message: `Drop the blank line\n\nPart of #${ISSUE}` }],
  });
  const result = proof(scene, ['guard']);
  assert.ok(problems(result, 'guard').some((found) => found.includes(`${c1} separates items: changed`)), show(result));
});

test('a merge conflict resolved by dropping a blank line inside a template outside the tests fails the guard', (t) => {
  const other = (n) => `test('other ${n}', () => {});\n`;
  const scene = repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { [`${dir}/a.test.mjs`]: receipt(true) + other(1) },
    commits: [{ files: { [`${dir}/a.test.mjs`]: receipt(true) + other(2) }, message: `Work\n\nPart of #${ISSUE}` }],
  });
  const { cwd } = scene;
  git(cwd, 'checkout', '-q', '-b', 'moved', 'origin/main');
  write(cwd, { [`${dir}/a.test.mjs`]: receipt(true) + other(3) });
  git(cwd, 'commit', '-q', '-am', 'main moves');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(cwd, 'checkout', '-q', 'change');
  assert.throws(() => git(cwd, 'merge', '-q', '-m', 'Merge main', 'origin/main'), undefined, 'the merge conflicts');
  write(cwd, { [`${dir}/a.test.mjs`]: receipt(false) + other(2) });
  git(cwd, 'commit', '-q', '-am', 'Merge main');
  const result = proof(scene, ['guard']);
  assert.ok(problems(result, 'guard').some((found) => found.includes('lines outside its tests changed in resolving a merge conflict')), show(result));
});

test('deleting an untagged test inside a suite, with the blank line before it, leaves the suite\'s tagged tests unedited', (t) => {
  const suite = (extra) => `import assert from 'node:assert/strict';\nimport { describe, it } from 'node:test';\n\ndescribe('math', () => {\n  it('${c1} adds', () => {\n    assert.equal(1 + 1, 2);\n  });\n${extra ? "\n  it('old untagged check', () => {\n    assert.ok(true);\n  });\n" : ''}});\n`;
  const scene = repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { [`${dir}/a.test.mjs`]: suite(true) },
    commits: [{ files: { [`${dir}/a.test.mjs`]: suite(false) }, message: `Drop an untagged test\n\nPart of #${ISSUE}` }],
  });
  const result = proof(scene, ['guard']);
  assert.deepEqual(problems(result, 'guard'), [], show(result));
  assert.equal(result.status, 0, show(result));
});

// A removed line is judged by every test and suite whose text it holds, not only the one starting last on it.
const head = "import assert from 'node:assert/strict';\nimport { describe, it } from 'node:test';\nconst add = (a, b) => a + b + 1;\n";
const guardOf = (t, before, after) => proof(repo(t, {
  issues: { [ISSUE]: ['Adds'] },
  base: { [`${dir}/a.test.mjs`]: head + before },
  commits: [{ files: { [`${dir}/a.test.mjs`]: head + after }, message: `Edit\n\nPart of #${ISSUE}` }],
}), ['guard']);
const edited = (result, name) => problems(result, 'guard').some((found) => found.includes(`${name}: changed`));

test('an edit of a tagged test on a line where an untagged test starts edits the tagged test', (t) => {
  const file = (want) => `\nit('${c1} adds', () => {\n  assert.equal(add(1, 1), ${want}); }); it('untagged', () => {\n  assert.ok(true);\n});\n`;
  const result = guardOf(t, file(2), file(3));
  assert.ok(edited(result, `${c1} adds`), show(result));
});

test('suite code a tagged test reads, edited on a line an untagged test shares, edits the tagged test', (t) => {
  const file = (want) => `\ndescribe('math', () => {\n  const expected = ${want}; it('untagged', () => { assert.ok(true); });\n  it('${c1} adds', () => {\n    assert.equal(add(1, 1), expected);\n  });\n});\n`;
  const result = guardOf(t, file(2), file(3));
  assert.ok(edited(result, `math › ${c1} adds`), show(result));
});

test('a removed line holding only a semicolon outside the tests is code, not a blank line', (t) => {
  const file = (semi) => `let expected = 2\n${semi ? ';\n' : ''}+1\n\nit('${c1} adds', () => {\n  assert.equal(add(1, 1), expected);\n});\n`;
  const result = guardOf(t, file(true), file(false));
  assert.ok(edited(result, `${c1} adds`), show(result));
});

test("deleting an untagged test ended by a semicolon leaves the tagged tests unedited", (t) => {
  const file = (extra) => `\nit('${c1} adds', () => {\n  assert.equal(add(1, 1), 3);\n});\n${extra ? "\nit('untagged', () => {\n  assert.ok(true);\n});\n" : ''}`;
  const result = guardOf(t, file(true), file(false));
  assert.deepEqual(problems(result, 'guard'), [], show(result));
});

test('a merge conflict resolved by also dropping a semicolon-only line outside the tests fails the guard', (t) => {
  const file = (semi, other) => `${head}let expected = 2\n${semi ? ';\n' : ''}+1\n\nit('${c1} adds', () => {\n  assert.equal(add(1, 1), expected);\n});\n\nit('untagged', () => {\n  assert.ok(${other});\n});\n`;
  const scene = repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { [`${dir}/a.test.mjs`]: file(true, 1) },
    commits: [{ files: { [`${dir}/a.test.mjs`]: file(true, 2) }, message: `Work\n\nPart of #${ISSUE}` }],
  });
  const { cwd } = scene;
  git(cwd, 'checkout', '-q', '-b', 'moved', 'origin/main');
  write(cwd, { [`${dir}/a.test.mjs`]: file(true, 3) });
  git(cwd, 'commit', '-q', '-am', 'main moves');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(cwd, 'checkout', '-q', 'change');
  assert.throws(() => git(cwd, 'merge', '-q', '-m', 'Merge main', 'origin/main'), undefined, 'the merge conflicts');
  write(cwd, { [`${dir}/a.test.mjs`]: file(false, 2) });
  git(cwd, 'commit', '-q', '-am', 'Merge main');
  const result = proof(scene, ['guard']);
  assert.ok(problems(result, 'guard').some((found) => found.includes('lines outside its tests changed in resolving a merge conflict')), show(result));
});

test('a merge conflict resolved by joining a comment line with the code after it fails the guard', (t) => {
  const top = `${head}let skip = true;\n// the check runs only when it is on\nskip = false;\n\nit('${c1} adds', () => {\n  if (skip) return;\n  assert.equal(add(1, 1), 2);\n});\n`;
  const scene = repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { [`${dir}/a.test.mjs`]: top },
    commits: [{ files: { [`${dir}/a.test.mjs`]: `${top}\nit('change side', () => {});\n` }, message: `Work\n\nPart of #${ISSUE}` }],
  });
  const { cwd } = scene;
  git(cwd, 'checkout', '-q', '-b', 'moved', 'origin/main');
  write(cwd, { [`${dir}/a.test.mjs`]: `${top}\nit('main side', () => {});\n` });
  git(cwd, 'commit', '-q', '-am', 'main moves');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(cwd, 'checkout', '-q', 'change');
  assert.throws(() => git(cwd, 'merge', '-q', '-m', 'Merge main', 'origin/main'), undefined, 'the merge conflicts');
  write(cwd, { [`${dir}/a.test.mjs`]: `${top.replace('on\nskip = false;', 'on skip = false;')}\nit('change side', () => {});\n\nit('main side', () => {});\n` });
  git(cwd, 'commit', '-q', '-am', 'Merge main');
  const result = proof(scene, ['guard']);
  assert.ok(problems(result, 'guard').some((found) => found.includes('lines outside its tests changed in resolving a merge conflict')), show(result));
});

test("a removed line of an untagged suite's own code edits the tagged tests outside it, which may read what it sets", (t) => {
  const file = (setup) => `let expected = 3;\n\ndescribe('setup', () => {\n${setup}  it('loads', () => {});\n});\n\nit('${c1} adds', () => {\n  assert.equal(add(1, 1), expected);\n});\n`;
  const result = guardOf(t, file('  expected = 2;\n'), file(''));
  assert.ok(edited(result, `${c1} adds`), show(result));
});

test('a line added before a tagged test that keeps it from registering, such as if (false), edits it', (t) => {
  const tagged = `it('${c1} adds', () => {\n  assert.equal(add(1, 1), 2);\n});\n`;
  const result = guardOf(t, `\n${tagged}`, `\nif (false)\n${tagged}`);
  assert.ok(problems(result, 'guard').some((found) => found.includes(`${c1} adds`)), show(result));
});

test('a hollow copy of a tagged test added ahead of it, the original no longer registering, edits it', (t) => {
  const tagged = `it('${c1} adds', () => {\n  assert.equal(add(1, 1), 3);\n});\n`;
  const result = guardOf(t, `\n${tagged}`, `\nit('${c1} adds', () => {\n}); if (false)\n${tagged}`);
  assert.ok(problems(result, 'guard').some((found) => found.includes(`${c1} adds`)), show(result));
});

// Two tests of one full name report under one key, so a tagged test kept from registering can hide
// behind a copy of its name: each declared test of a name needs its own report.
test('a tagged test kept from registering behind a same-named copy in a second suite is one the runner never reported', (t) => {
  const top = "import assert from 'node:assert/strict';\nimport { describe, it } from 'node:test';\nimport { f } from '../../../src/impl.mjs';\n\n";
  const tagged = `  it('${c1} adds', () => {\n    assert.equal(f(), 3);\n  });\n`;
  const scene = repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { 'src/impl.mjs': 'export const f = () => 3;\n', [`${dir}/a.test.mjs`]: `${top}describe('s', () => {\n${tagged}});\n` },
    commits: [{
      files: { 'src/impl.mjs': 'export const f = () => 4;\n', [`${dir}/a.test.mjs`]: `${top}if (false)\ndescribe('s', () => {\n${tagged}});\n\ndescribe('s', () => {\n  const f = () => 3;\n${tagged}});\n` },
      message: `Break f\n\nPart of #${ISSUE}`,
    }],
  });
  const result = proof(scene, ['before']);
  assert.ok(problems(result, 'before').some((found) => found.includes(`s › ${c1} adds: declared and not skipped, but the runner never reported it`)), show(result));
});

const impl = "import assert from 'node:assert/strict';\nimport { describe, it } from 'node:test';\nimport { f } from '../../../src/impl.mjs';\n\n";
const sums = `  it('${c1} adds', () => {\n    assert.equal(f(), 3);\n  });\n`;
const before = (t, base, change) => proof(repo(t, {
  issues: { [ISSUE]: ['Adds'] },
  base: { 'src/impl.mjs': `export const f = () => ${base.f};\n`, ...(base.file ? { [`${dir}/a.test.mjs`]: impl + base.file } : {}) },
  commits: [{ files: { 'src/impl.mjs': `export const f = () => ${change.f};\n`, ...(change.file ? { [`${dir}/a.test.mjs`]: impl + change.file } : {}) }, message: `Change f\n\nPart of #${ISSUE}` }],
}), []);
const neverReported = (result, name) => problems(result, 'before').some((found) => found.includes(`${name}: declared and not skipped, but the runner never reported it`));

test('a skipped copy of a tagged test reports as a skip, which stands for no test that ran', (t) => {
  const result = before(t, { f: 3, file: `describe('s', () => {\n${sums}});\n` },
    { f: 4, file: `if (false)\ndescribe('s', () => {\n${sums}});\n\ndescribe('s', () => {\n  const f = () => 3;\n${sums}  it.skip('${c1} adds');\n});\n` });
  assert.ok(neverReported(result, `s › ${c1} adds`), show(result));
});

test('a tagged test declared once in each branch of an if, one branch registering, was reported', (t) => {
  const result = before(t, { f: 4 }, { f: 3, file: `describe('s', () => {\n  if (process.platform === 'win32') {\n${sums}  } else {\n${sums}  }\n});\n` });
  assert.ok(!neverReported(result, `s › ${c1} adds`), show(result));
  assert.ok(result.lines.some((line) => line.startsWith(`PASS before: ${dir}/a.test.mjs › s › ${c1} adds`)), show(result));
});

test('a tagged test in a node:test suite skipped by its options is skipped, not unreported', (t) => {
  const result = before(t, { f: 4 }, { f: 3, file: `describe('a', () => {\n${sums.replace('adds', 'adds too')}});\n\ndescribe('opt', { skip: true }, () => {\n${sums}});\n` });
  assert.ok(!neverReported(result, `opt › ${c1} adds`), show(result));
});

test('a tagged test declared unskipped that a hook skips as it runs proved nothing: the run is inconclusive', (t) => {
  const file = (hook) => `${hook ? 'beforeEach((t) => t.skip());\n' : ''}describe('s', () => {\n${sums}});\n`;
  const result = before(t, { f: 4, file: file(false) }, { f: 3, file: `import { beforeEach } from 'node:test';\n${file(true)}` });
  assert.ok(problems(result, 'before').some((found) => found.startsWith('INCONCLUSIVE') && found.includes(`s › ${c1} adds: declared unskipped, but skipped as it ran`)), show(result));
  assert.notEqual(result.status, 0, show(result));
});

test('a skipped subtest of another test, ending in a tagged name, is no report of that tagged test', (t) => {
  const loop = (extra) => `const cases = [1];\n${extra}describe('s', () => {\n  for (const c of cases) {\n  ${sums.trim()}\n  }\n});\n`;
  const result = before(t, { f: 4, file: loop('') },
    { f: 3, file: loop(`cases.length = 0;\nit('wrapper', async (t) => {\n  await t.test('s › ${c1} adds', { skip: true }, () => {});\n});\n`) });
  assert.ok(neverReported(result, `s › ${c1} adds`), show(result));
});

test('a tagged test that ran on the merge base and that code it imports skips on the change proved nothing: the run is inconclusive', (t) => {
  const hook = "3;\nimport { beforeEach } from 'node:test';\nbeforeEach((t) => t.skip())";
  const result = before(t, { f: 4, file: `describe('s', () => {\n${sums}});\n` }, { f: hook });
  assert.ok(problems(result, 'before').some((found) => found.startsWith('INCONCLUSIVE') && found.includes(`s › ${c1} adds: declared unskipped, but skipped on the change, though it ran on the merge base`)), show(result));
  assert.notEqual(result.status, 0, show(result));
});

test('a tagged test that skips itself off the reference machine, in a file the change only adds a test to, is no test and no refusal', (t) => {
  const budget = `it('${c1} within budget', (t) => {\n  if (process.env.DEEP_PROOF_NO_SUCH_MACHINE !== '1') return t.skip('not the reference machine');\n  assert.ok(true);\n});\n`;
  const result = before(t, { f: 4, file: budget }, { f: 3, file: `${budget}\nit('${c1} sums', () => {\n  assert.equal(f(), 3);\n});\n` });
  assert.ok(!problems(result, 'before').some((found) => found.includes('within budget')), show(result));
  assert.equal(result.status, 0, show(result));
});

// The proof lanes are checks: once main holds them, the change runs its own copy, so an edit of
// their code, or of the test paths lanes.mjs names, is an edit of the checks.
test("once main holds the proof lanes, an edit of their code or of lanes.mjs fails the guard, and passes as its own approved proposal", (t) => {
  const lanes = (paths) => `export const testPaths = [${paths}];\n`;
  const scene = (approve) => repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { 'scripts/proof-guard.mjs': '// the guard\n', 'scripts/lanes.mjs': lanes("'tests/**'") },
    commits: [{ files: { 'scripts/lanes.mjs': lanes(''), 'scripts/proof-guard.mjs': '// no guard\n' }, message: `Empty the test paths\n\nPart of #${ISSUE}`, approve }],
  });
  const refused = problems(proof(scene(), ['guard']), 'guard');
  for (const path of ['scripts/lanes.mjs', 'scripts/proof-guard.mjs']) assert.ok(refused.some((found) => found.startsWith(`FAIL guard: ${path}: the proof lanes' own code changed`)), refused.join('\n'));
  const approved = proof(scene({ items: ['scripts/lanes.mjs', 'scripts/proof-guard.mjs'] }), ['guard']);
  assert.deepEqual(problems(approved, 'guard'), [], show(approved));
  const free = repo(t, { base: { 'scripts/lanes.mjs': lanes("'tests/**'") }, commits: [{ files: { 'scripts/lanes.mjs': lanes("'tests/**', 'more/**'") } }] });
  assert.deepEqual(problems(proof(free, ['guard']), 'guard'), [], 'with no proof lanes on main, lanes.mjs is free to change');
});

// The merge base runs with the change's test-path files, so a hollow helper the change brings in runs
// on both; its runner config is a check, as the lanes are: once main holds them, an edit of it is
// guarded, since a config can stub the code under test only where it finds the change.
const vitestScene = (t, { lanes, files, message }) => {
  const config = (extra) => `export default { test: { include: ['tests/**/*.test.ts']${extra} } };\n`;
  const scene = repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { ...(lanes ? { 'scripts/proof-guard.mjs': '// the guard\n' } : {}), 'lib/impl.ts': 'export const f = () => 4;\n', 'vitest.config.ts': config(''), [`${dir}/a.test.ts`]: `import { it, expect } from 'vitest';\nimport { f } from '../../../lib/impl.ts';\n\nit('${c1} sums', () => {\n  expect(f()).toBe(3);\n});\n` },
  });
  // Both checkouts get vitest from a link the merge base holds, as no lockfile installs it there.
  mkdirSync(join(scene.cwd, 'node_modules'));
  symlinkSync(join(root, 'node_modules/vitest'), join(scene.cwd, 'node_modules/vitest'));
  git(scene.cwd, 'add', '-A');
  git(scene.cwd, 'commit', '-q', '-m', 'vitest');
  git(scene.cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  write(scene.cwd, files(config));
  git(scene.cwd, 'add', '-A');
  git(scene.cwd, 'commit', '-q', '-m', `${message}\n\nCloses #${ISSUE}`);
  return scene;
};

test('once main holds the proof lanes, a vitest config the change edits to mock the code under test fails the guard', (t) => {
  const scene = vitestScene(t, { lanes: true, message: 'Stub f', files: (config) => ({ 'vitest.config.ts': config(", setupFiles: ['./tests/setup.ts']"), 'tests/setup.ts': "import { vi } from 'vitest';\nvi.mock('../lib/impl.ts', () => ({ f: () => 3 }));\n" }) });
  const result = proof(scene, []);
  assert.ok(problems(result, 'guard').some((found) => found.startsWith("FAIL guard: vitest.config.ts: the test runner's config changed")), show(result));
  assert.notEqual(result.status, 0, show(result));
});

test('a real fix whose vitest config imports a file the change adds still fails on the merge base at its assertion', (t) => {
  const scene = vitestScene(t, { lanes: false, message: 'Fix f', files: () => ({ 'lib/impl.ts': 'export const f = () => 3;\n', 'tools/shared.mjs': "export const include = ['tests/**/*.test.ts'];\n", 'vitest.config.ts': "import { include } from './tools/shared.mjs';\nexport default { test: { include } };\n" }) });
  const result = proof(scene, ['trace']);
  assert.ok(result.lines.some((line) => line.startsWith(`PASS before: ${dir}/a.test.ts › ${c1} sums: failed on the merge base at its assertion`)), show(result));
  assert.equal(result.status, 0, show(result));
});

test('a shared helper under the test paths, outside the test\'s folder, runs on the merge base as the change has it', (t) => {
  const test = `import { it } from 'node:test';\nimport { f } from '../../../src/impl.mjs';\nconst { same } = await import(['..', '..', 'helpers', 'check' + '.mjs'].join('/'));\n\nit('${c1} sums', () => {\n  same(f(), 3);\n});\n`;
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { 'src/impl.mjs': 'export const f = () => 4;\n', 'tests/helpers/check.mjs': "import assert from 'node:assert/strict';\nexport const same = (a, b) => assert.equal(a, b);\n", [`${dir}/a.test.mjs`]: test },
    commits: [{ files: { 'tests/helpers/check.mjs': 'export const same = () => {};\n' }, message: `Hollow the helper\n\nCloses #${ISSUE}` }],
  }), ['trace']);
  assert.ok(!result.lines.some((line) => line.startsWith(`PASS before: `) && line.includes(`${c1} sums`)), show(result));
  assert.ok(problems(result, 'trace').some((found) => found.startsWith('FAIL trace: Closes')), show(result));
});

test("once main holds the proof lanes, a file the test runner's config names, such as a setup file, is guarded as the config is", (t) => {
  const config = "export default { test: { include: ['tests/**/*.test.ts'], setupFiles: ['./tests/setup.ts'], globalSetup: 'tests/global/one.ts' } };\n";
  const scene = (files) => repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { 'scripts/proof-guard.mjs': '// the guard\n', 'vitest.config.ts': config, 'tests/setup.ts': '// setup\n', 'tests/global/one.ts': '// global\n', 'tests/helpers/other.mjs': '// other\n' },
    commits: [{ files, message: `Edit\n\nPart of #${ISSUE}` }],
  });
  const refused = problems(proof(scene({ 'tests/setup.ts': "import { expect } from 'vitest';\nexpect.extend({ toBe: () => ({ pass: true, message: () => '' }) });\n", 'tests/global/one.ts': '// changed\n' }), ['guard']), 'guard');
  for (const path of ['tests/setup.ts', 'tests/global/one.ts']) assert.ok(refused.some((found) => found.startsWith(`FAIL guard: ${path}: a file the test runner's config names changed`)), refused.join('\n'));
  assert.deepEqual(problems(proof(scene({ 'tests/helpers/other.mjs': '// edited\n' }), ['guard']), 'guard'), [], 'a file the config names nowhere is free');
});

test('a file the config names without its extension, and each file under the test paths it imports, is guarded as the config is', (t) => {
  const scene = (files) => repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { 'scripts/proof-guard.mjs': '// the guard\n', 'vitest.config.ts': "export default { test: { setupFiles: ['./tests/setup'] } };\n", 'tests/setup.ts': "import './hook';\nimport './deep/index.ts';\n", 'tests/hook.ts': '// hook\n', 'tests/deep/index.ts': "import '../deeper.mjs';\n", 'tests/deeper.mjs': '// deeper\n' },
    commits: [{ files, message: `Edit\n\nPart of #${ISSUE}` }],
  });
  const refused = problems(proof(scene({ 'tests/setup.ts': "import './hook';\nimport './deep/index.ts';\n// edited\n", 'tests/hook.ts': '// hollow\n', 'tests/deeper.mjs': '// hollow\n' }), ['guard']), 'guard');
  for (const path of ['tests/setup.ts', 'tests/hook.ts', 'tests/deeper.mjs']) assert.ok(refused.some((found) => found.startsWith(`FAIL guard: ${path}: a file the test runner's config names changed`)), refused.join('\n'));
});

// A module path may resolve to a file the change adds beside one the merge base holds, such as
// check.js beside check.ts, or setup.ts in place of setup/index.ts: that file then stands in for it.
test('a file added beside a guarded one, which a module path may resolve to instead, is an edit of it', (t) => {
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: {
      'scripts/proof-guard.mjs': '// the guard\n', 'vitest.config.ts': "export default { test: { setupFiles: ['./tests/setup'] } };\n", 'tests/setup/index.ts': '// setup\n',
      [`${dir}/check.ts`]: "import assert from 'node:assert/strict';\nexport const same = (a: number, b: number) => assert.equal(a, b);\n",
      [`${dir}/a.test.ts`]: `import { it } from 'vitest';\nimport { same } from './check.js';\n\nit('${c1} sums', () => {\n  same(1 + 1, 2);\n});\n`,
    },
    commits: [{ files: { [`${dir}/check.js`]: 'export const same = () => {};\n', 'tests/setup.ts': '// hollow\n' }, message: `Add\n\nPart of #${ISSUE}` }],
  }), ['guard']);
  const refused = problems(result, 'guard');
  assert.ok(refused.some((found) => found.startsWith(`FAIL guard: ${dir}/check.ts: shadowed by ${dir}/check.js, added beside it`) && found.includes(`${c1} sums`)), show(result));
  assert.ok(refused.some((found) => found.startsWith("FAIL guard: tests/setup/index.ts: a file the test runner's config names changed, shadowed by tests/setup.ts")), show(result));
});

test('a file a config-named setup file reaches by a template literal or a path from the repository root is guarded too', (t) => {
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { 'scripts/proof-guard.mjs': '// the guard\n', 'vitest.config.ts': "export default { test: { setupFiles: ['tests/setup.ts'] } };\n", 'tests/setup.ts': "await import(`./hook.ts`);\nimport '/tests/root.ts';\n", 'tests/hook.ts': '// hook\n', 'tests/root.ts': '// root\n' },
    commits: [{ files: { 'tests/hook.ts': '// hollow\n', 'tests/root.ts': '// hollow\n' }, message: `Edit\n\nPart of #${ISSUE}` }],
  }), ['guard']);
  for (const path of ['tests/hook.ts', 'tests/root.ts']) assert.ok(problems(result, 'guard').some((found) => found.startsWith(`FAIL guard: ${path}: a file the test runner's config names changed`)), show(result));
});

test('a helper read as its folder, and files a resolver may take in place of a guarded one, are guarded as it is', (t) => {
  const reads = (from) => `import { it } from 'vitest';\nimport cases from '${from}';\n\nit('${c1} sums', () => {\n  if (cases.want !== 3) throw Error('wrong');\n});\n`;
  const scene = (files) => repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: {
      'scripts/proof-guard.mjs': '// the guard\n', 'vitest.config.ts': "export default { test: { setupFiles: ['./tests/setup'] } };\n", 'tests/setup/index.ts': '// setup\n',
      [`${dir}/cases/index.ts`]: 'export default { want: 3 };\n', [`${dir}/a.test.ts`]: reads('./cases'),
      [`${dir}/more.ts`]: 'export default { want: 3 };\n', [`${dir}/b.test.ts`]: reads('./more').replace('sums', 'sums more'),
    },
    commits: [{ files, message: `Edit\n\nPart of #${ISSUE}` }],
  });
  const edited = problems(proof(scene({ [`${dir}/cases/index.ts`]: 'export default { want: 5 };\n' }), ['guard']), 'guard');
  assert.ok(edited.some((found) => found.startsWith(`FAIL guard: ${dir}/cases/index.ts: 1 line removed or changed; read by ${dir}/a.test.ts › ${c1} sums`)), edited.join('\n'));
  const added = problems(proof(scene({ [`${dir}/cases.json`]: '{ "want": 5 }\n', [`${dir}/more`]: 'export default { want: 5 };\n', 'tests/setup/package.json': '{ "main": "hooks.ts" }\n' }), ['guard']), 'guard');
  for (const [held, by] of [[`${dir}/cases/index.ts`, `${dir}/cases.json`], [`${dir}/more.ts`, `${dir}/more`], ['tests/setup/index.ts', 'tests/setup/package.json']])
    assert.ok(added.some((found) => found.startsWith(`FAIL guard: ${held}: `) && found.includes(`shadowed by ${by}, added beside it`)), `${held} by ${by}\n${added.join('\n')}`);
});

test('a fixture added beside one a test reads by its whole name is no stand-in, nor is a file no resolver picks', (t) => {
  const reads = `import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\nimport test from 'node:test';\nimport cases from './cases/index.mjs';\n\ntest('${c1} reads', () => {\n  for (const name of ['golden/out.txt', 'io/c1.in', 'fixtures/.eslintrc', 'site/index.html']) assert.ok(readFileSync(new URL(name, import.meta.url)));\n  assert.ok(cases);\n});\n`;
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { 'scripts/proof-guard.mjs': '// the guard\n', [`${dir}/a.test.mjs`]: reads, [`${dir}/golden/out.txt`]: 'out\n', [`${dir}/io/c1.in`]: 'in\n', [`${dir}/fixtures/.eslintrc`]: '{}\n', [`${dir}/site/index.html`]: '<p></p>\n', [`${dir}/cases/index.mjs`]: 'export default 1;\n' },
    commits: [{ files: { [`${dir}/golden/out.json`]: '{}\n', [`${dir}/io/c1.out`]: 'out\n', [`${dir}/fixtures/.gitignore`]: 'x\n', [`${dir}/site.png`]: 'png\n', [`${dir}/cases.md`]: '# cases\n' }, message: `Add fixtures\n\nPart of #${ISSUE}` }],
  }), ['guard']);
  assert.deepEqual(problems(result, 'guard'), [], show(result));
});

test('once main holds the proof lanes, a package committed under node_modules, or a package.json edited to point a folder elsewhere, fails the guard', (t) => {
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { 'scripts/proof-guard.mjs': '// the guard\n', [`${dir}/cases/index.ts`]: 'export default { want: 3 };\n', [`${dir}/cases/package.json`]: '{ "type": "module" }\n', [`${dir}/a.test.ts`]: `import { it } from 'vitest';\nimport cases from './cases';\n\nit('${c1} sums', () => {\n  if (cases.want !== 3) throw Error('wrong');\n});\n` },
    commits: [{ files: { 'tests/node_modules/@demo/sum/index.js': 'export const f = () => 3;\n', [`${dir}/cases/package.json`]: '{ "type": "module", "main": "alt.ts" }\n', [`${dir}/cases/alt.ts`]: 'export default { want: 5 };\n' }, message: `Edit\n\nPart of #${ISSUE}` }],
  }), ['guard']);
  const refused = problems(result, 'guard');
  assert.ok(refused.some((found) => found.startsWith('FAIL guard: tests/node_modules/@demo/sum/index.js: a package committed under node_modules')), show(result));
  assert.ok(refused.some((found) => found.startsWith(`FAIL guard: ${dir}/cases/index.ts: shadowed by ${dir}/cases/package.json`)), show(result));
});

test("a colocated tagged test's snapshot and fixture are guarded as those under the test paths are", (t) => {
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: {
      'packages/sum/src/sum.test.ts': `import { it, expect } from 'vitest';\nimport { readFileSync } from 'node:fs';\n\nit('${c1} sums', () => {\n  expect(3).toMatchSnapshot();\n  expect(readFileSync('packages/sum/fixtures/expected.json', 'utf8')).toBe('3');\n});\n`,
      'packages/sum/src/__snapshots__/sum.test.ts.snap': `exports[\`${c1} sums 1\`] = \`3\`;\n`,
      'packages/sum/fixtures/expected.json': '3',
    },
    commits: [{ files: { 'packages/sum/src/__snapshots__/sum.test.ts.snap': `exports[\`${c1} sums 1\`] = \`5\`;\n`, 'packages/sum/fixtures/expected.json': '5' }, message: `Re-record\n\nPart of #${ISSUE}` }],
  }), ['guard']);
  for (const path of ['packages/sum/src/__snapshots__/sum.test.ts.snap', 'packages/sum/fixtures/expected.json']) assert.ok(problems(result, 'guard').some((found) => found.startsWith(`FAIL guard: ${path}: `)), show(result));
});

test('once main holds the proof lanes, a vitest config of any name, a project it lists, and a setup file it names anywhere are guarded', (t) => {
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { 'scripts/proof-guard.mjs': '// the guard\n', 'vitest.config.ts': "export default { test: { projects: ['./unit.projects.ts'], setupFiles: ['./vitest.setup.ts'] } };\n", 'unit.projects.ts': 'export default {};\n', 'vitest.e2e.config.mts': 'export default {};\n', 'vitest.setup.ts': '// setup\n', 'lib/alias.ts': '// product\n' },
    commits: [{ files: { 'unit.projects.ts': "export default { resolve: { alias: { x: './lib/fake.ts' } } };\n", 'vitest.e2e.config.mts': 'export default { x: 1 };\n', 'vitest.setup.ts': '// hollow\n', 'lib/alias.ts': '// fixed\n' }, message: `Edit\n\nPart of #${ISSUE}` }],
  }), ['guard']);
  const refused = problems(result, 'guard');
  for (const path of ['unit.projects.ts', 'vitest.e2e.config.mts', 'vitest.setup.ts']) assert.ok(refused.some((found) => found.startsWith(`FAIL guard: ${path}: `)), show(result));
  assert.ok(!refused.some((found) => found.includes('lib/alias.ts')), show(result));
});

test('a file beside a helper tests import by its whole name, and a fixture project\'s node_modules no test sits under, stand in for nothing', (t) => {
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { 'scripts/proof-guard.mjs': '// the guard\n', [`${dir}/cases.mjs`]: 'export default { want: 3 };\n', [`${dir}/a.test.mjs`]: `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport cases from './cases.mjs';\n\ntest('${c1} sums', () => {\n  assert.equal(cases.want, 3);\n});\n` },
    commits: [{ files: { [`${dir}/cases.json`]: '{}\n', 'tests/unit/fixtures/proj/node_modules/dep/index.js': 'export default 1;\n' }, message: `Add\n\nPart of #${ISSUE}` }],
  }), ['guard']);
  assert.deepEqual(problems(result, 'guard'), [], show(result));
});

test('once main holds the proof lanes, a package beside a shared helper a test imports, and a setup file a config names by a call, are guarded; code under test in a fixtures folder is not a fixture', (t) => {
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: {
      'scripts/proof-guard.mjs': '// the guard\n', 'tests/support/check.mjs': "export { expect } from 'chai';\n", 'vitest.config.ts': "export default { test: { setupFiles: fileURLToPath(new URL('./vitest.setup.ts', import.meta.url)) } };\n", 'vitest.setup.ts': '// setup\n',
      'lib/fixtures/factory.mjs': 'export const make = () => 4;\n', [`${dir}/a.test.mjs`]: `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { make } from '../../../lib/fixtures/factory.mjs';\nimport '../../support/check.mjs';\n\ntest('${c1} makes', () => {\n  assert.equal(make(), 3);\n});\n`,
    },
    commits: [{ files: { 'tests/support/node_modules/chai/index.js': 'export const expect = () => ({});\n', 'vitest.setup.ts': '// hollow\n', 'lib/fixtures/factory.mjs': 'export const make = () => 3;\n' }, message: `Edit\n\nPart of #${ISSUE}` }],
  }), ['guard']);
  const refused = problems(result, 'guard');
  for (const path of ['tests/support/node_modules/chai/index.js', 'vitest.setup.ts']) assert.ok(refused.some((found) => found.startsWith(`FAIL guard: ${path}: `)), show(result));
  assert.ok(!refused.some((found) => found.includes('lib/fixtures/factory.mjs')), show(result));
});

test("the config's setup entries are read past comments, through a const and in a config module it imports; a __fixtures__ script is a test's own; a fixture project's node_modules no test reaches is free", (t) => {
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: {
      'scripts/proof-guard.mjs': '// the guard\n',
      'vitest.config.ts': "import shared from './vitest.shared.ts';\nconst globalSetup = ['./global.setup.ts'];\nexport default { ...shared, test: {\n  setupFiles: [\n    // the project's matchers\n    './vitest.setup.ts',\n  ],\n  globalSetup,\n  // don't alias anything else\n  alias: { calc: './lib/impl.ts' },\n} };\n",
      'vitest.shared.ts': "export default { test: { setupFiles: ['./shared.setup.ts'] } };\n", 'vitest.setup.ts': '// setup\n', 'global.setup.ts': '// global\n', 'shared.setup.ts': '// shared\n', 'lib/impl.ts': 'export const f = () => 4;\n',
      'packages/calc/src/__fixtures__/expected.ts': 'export default 3;\n', 'packages/calc/src/sum.test.ts': `import { it, expect } from 'vitest';\nimport want from './__fixtures__/expected.ts';\n\nit('${c1} sums', () => {\n  expect(3).toBe(want);\n});\n`,
    },
    commits: [{ files: { 'vitest.setup.ts': '// hollow\n', 'global.setup.ts': '// hollow\n', 'shared.setup.ts': '// hollow\n', 'lib/impl.ts': 'export const f = () => 3;\n', 'packages/calc/src/__fixtures__/expected.ts': 'export default 4;\n', 'tests/unit/fixtures/proj/index.js': "import dep from 'dep';\n", 'tests/unit/fixtures/proj/node_modules/dep/index.js': 'export default 1;\n' }, message: `Edit\n\nPart of #${ISSUE}` }],
  }), ['guard']);
  const refused = problems(result, 'guard');
  for (const path of ['vitest.setup.ts', 'global.setup.ts', 'shared.setup.ts', 'packages/calc/src/__fixtures__/expected.ts']) assert.ok(refused.some((found) => found.startsWith(`FAIL guard: ${path}: `)), `${path}\n${show(result)}`);
  for (const path of ['lib/impl.ts', 'tests/unit/fixtures/proj/node_modules']) assert.ok(!refused.some((found) => found.includes(path)), `${path}\n${show(result)}`);
});

test("a workspace build can't rewrite a tagged test in the copy the lanes run", (t) => {
  const lock = JSON.stringify({ name: 'x', lockfileVersion: 3, requires: true, packages: { '': { name: 'x', workspaces: ['packages/*'] }, 'node_modules/lib': { resolved: 'packages/lib', link: true }, 'packages/lib': { name: 'lib', version: '1.0.0' } } });
  const build = "import { mkdirSync } from 'node:fs';\nmkdirSync('dist', { recursive: true });\n";
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: {
      'package.json': JSON.stringify({ name: 'x', private: true, type: 'module', workspaces: ['packages/*'] }), 'package-lock.json': lock,
      'packages/lib/package.json': JSON.stringify({ name: 'lib', version: '1.0.0', type: 'module', scripts: { build: 'node build.mjs' } }), 'packages/lib/build.mjs': build, 'packages/lib/src/impl.mjs': 'export const f = () => 4;\n',
      [`${dir}/a.test.mjs`]: `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { f } from '../../../packages/lib/src/impl.mjs';\n\ntest('${c1} sums', () => {\n  assert.equal(f(), 3);\n});\n`,
    },
    commits: [{ files: { 'packages/lib/src/impl.mjs': '// still wrong\nexport const f = () => 4;\n', 'packages/lib/build.mjs': `${build}import { readFileSync, writeFileSync } from 'node:fs';\nconst test = '../../${dir}/a.test.mjs';\nwriteFileSync(test, readFileSync(test, 'utf8').replace('f(), 3', 'f(), 4'));\nwriteFileSync('../../${dir}/planted.test.mjs', '');\n` }, message: `Edit\n\nCloses #${ISSUE}` }],
  }), ['trace']);
  assert.ok(problems(result, 'before').some((found) => found.includes(`${c1} sums: fails on the change`)), show(result));
  assert.notEqual(result.status, 0, show(result));
});

test("a workspace build can't plant a package a tagged test resolves to", (t) => {
  const lock = JSON.stringify({ name: 'x', lockfileVersion: 3, requires: true, packages: { '': { name: 'x', workspaces: ['packages/*'] }, 'node_modules/lib': { resolved: 'packages/lib', link: true }, 'packages/lib': { name: 'lib', version: '1.0.0' } } });
  const build = "import { mkdirSync } from 'node:fs';\nmkdirSync('dist', { recursive: true });\n";
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: {
      '.gitignore': 'node_modules\n', 'package.json': JSON.stringify({ name: 'x', private: true, type: 'module', workspaces: ['packages/*'] }), 'package-lock.json': lock,
      'packages/lib/package.json': JSON.stringify({ name: 'lib', version: '1.0.0', type: 'module', main: 'src/impl.mjs', scripts: { build: 'node build.mjs' } }), 'packages/lib/build.mjs': build, 'packages/lib/src/impl.mjs': 'export const f = () => 4;\n',
      [`${dir}/a.test.mjs`]: `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { f } from 'lib';\n\ntest('${c1} sums', () => {\n  assert.equal(f(), 3);\n});\n`,
    },
    commits: [{ files: { 'packages/lib/src/impl.mjs': '// still wrong\nexport const f = () => 4;\n', 'packages/lib/build.mjs': `${build}import { writeFileSync } from 'node:fs';\nmkdirSync('../../tests/node_modules/lib', { recursive: true });\nwriteFileSync('../../tests/node_modules/lib/package.json', '{ "name": "lib", "type": "module", "main": "index.mjs" }');\nwriteFileSync('../../tests/node_modules/lib/index.mjs', 'export const f = () => 3;\\n');\n` }, message: `Edit\n\nCloses #${ISSUE}` }],
  }), ['trace']);
  assert.ok(problems(result, 'before').some((found) => found.startsWith('FAIL before') && found.includes('fails on the change')), show(result));
  assert.notEqual(result.status, 0, show(result));
});

test('a file under the test paths a workspace build generates, which a tagged test reads, survives on the change', (t) => {
  const lock = JSON.stringify({ name: 'x', lockfileVersion: 3, requires: true, packages: { '': { name: 'x', workspaces: ['packages/*'] }, 'node_modules/lib': { resolved: 'packages/lib', link: true }, 'packages/lib': { name: 'lib', version: '1.0.0' } } });
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: {
      '.gitignore': 'node_modules\npackages/lib/test/generated.json\n', 'package.json': JSON.stringify({ name: 'x', private: true, type: 'module', workspaces: ['packages/*'] }), 'package-lock.json': lock,
      'packages/lib/package.json': JSON.stringify({ name: 'lib', version: '1.0.0', type: 'module', scripts: { build: 'node build.mjs' } }), 'packages/lib/src/impl.mjs': 'export const f = () => 4;\n',
      'packages/lib/build.mjs': "import { writeFileSync } from 'node:fs';\nimport { f } from './src/impl.mjs';\nwriteFileSync('test/generated.json', JSON.stringify({ value: f() }));\n",
      'packages/lib/test/a.test.mjs': `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { readFileSync } from 'node:fs';\n\ntest('${c1} sums', () => {\n  assert.equal(JSON.parse(readFileSync(new URL('./generated.json', import.meta.url), 'utf8')).value, 3);\n});\n`,
    },
    commits: [{ files: { 'packages/lib/src/impl.mjs': 'export const f = () => 3;\n' }, message: `Fix\n\nCloses #${ISSUE}` }],
  }), ['trace']);
  assert.ok(result.stdout.includes(`PASS before: packages/lib/test/a.test.mjs › ${c1} sums: failed on the merge base at its assertion`), show(result));
  assert.equal(result.status, 0, show(result));
});

test("once main holds the proof lanes, a package.json or source module the runner config imports for a value is the change's own code", (t) => {
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: {
      'scripts/proof-guard.mjs': '// the guard\n', 'package.json': JSON.stringify({ name: 'x', version: '1.0.0' }), 'lib/roots.ts': "export const roots = ['tests'];\n",
      'vitest.config.ts': "import pkg from './package.json' with { type: 'json' };\nimport { roots } from './lib/roots.ts';\nexport default { define: { __VERSION__: JSON.stringify(pkg.version) }, test: { include: roots.map((at) => `${at}/**/*.test.ts`) } };\n",
    },
    commits: [{ files: { 'package.json': JSON.stringify({ name: 'x', version: '1.0.0', description: 'sums' }), 'lib/roots.ts': "export const roots = ['tests'];\nexport const three = 3;\n" }, message: `Edit\n\nPart of #${ISSUE}` }],
  }), ['guard']);
  for (const path of ['package.json', 'lib/roots.ts']) assert.ok(!problems(result, 'guard').some((found) => found.includes(`${path}:`)), `${path}\n${show(result)}`);
});

test("a fixture project's committed packages a tagged test runs are the change's on the merge base too", (t) => {
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: {
      'src/cli.mjs': "const { n } = await import(process.argv[2]);\nconsole.log(String(n * 3));\n",
      'tests/fixtures/proj/main.mjs': "export { n } from 'dep';\n",
      'tests/fixtures/proj/node_modules/dep/package.json': '{ "name": "dep", "type": "module", "main": "index.mjs" }\n', 'tests/fixtures/proj/node_modules/dep/index.mjs': 'export const n = 1;\n',
      [`${dir}/a.test.mjs`]: `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { execFileSync } from 'node:child_process';\nimport { resolve } from 'node:path';\n\ntest('${c1} doubles', () => {\n  assert.equal(execFileSync(process.execPath, ['src/cli.mjs', resolve('tests/fixtures/proj/main.mjs')], { encoding: 'utf8' }).trim(), '2');\n});\n`,
    },
    commits: [{ files: { 'src/cli.mjs': "// cli\nconst { n } = await import(process.argv[2]);\nconsole.log(String(n * 3));\n", 'tests/fixtures/proj/node_modules/dep/index.mjs': 'export const n = 2 / 3;\n' }, message: `Edit\n\nCloses #${ISSUE}` }],
  }), ['trace']);
  assert.notEqual(result.status, 0, show(result));
  assert.ok(!result.stdout.includes('PASS before'), show(result));
});

const workspace = (build, base) => ({
  '.gitignore': 'node_modules\n', 'package.json': JSON.stringify({ name: 'x', private: true, type: 'module', workspaces: ['packages/*'] }),
  'package-lock.json': JSON.stringify({ name: 'x', lockfileVersion: 3, requires: true, packages: { '': { name: 'x', workspaces: ['packages/*'] }, 'node_modules/lib': { resolved: 'packages/lib', link: true }, 'packages/lib': { name: 'lib', version: '1.0.0' } } }),
  'packages/lib/package.json': JSON.stringify({ name: 'lib', version: '1.0.0', type: 'module', scripts: { build: 'node build.mjs' } }), 'packages/lib/build.mjs': build, ...base,
});

test("a workspace build can't link a tagged test's helper folder to code planted outside the test paths", (t) => {
  const plant = "import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';\nmkdirSync('../../y/z/w', { recursive: true });\nrenameSync('../../tests/acceptance/helpers', '../../y/z/w/helpers');\nsymlinkSync('../../y/z/w/helpers', '../../tests/acceptance/helpers');\nmkdirSync('../../y/packages/lib/src', { recursive: true });\nwriteFileSync('../../y/packages/lib/src/impl.mjs', 'export const f = () => 3;\\n');\n";
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: workspace('// builds\n', {
      'packages/lib/src/impl.mjs': 'export const f = () => 4;\n', 'tests/acceptance/helpers/h.mjs': "export { f } from '../../../packages/lib/src/impl.mjs';\n",
      [`${dir}/a.test.mjs`]: `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { f } from '../helpers/h.mjs';\n\ntest('${c1} sums', () => {\n  assert.equal(f(), 3);\n});\n`,
    }),
    commits: [{ files: { 'packages/lib/build.mjs': `// builds\n${plant}` }, message: `Edit\n\nCloses #${ISSUE}` }],
  }), ['trace']);
  assert.ok(problems(result, 'before').some((found) => found.includes(`${c1} sums: fails on the change`)), show(result));
  assert.notEqual(result.status, 0, show(result));
});

test("a workspace build can't plant an extensionless file a test's require resolves to", (t) => {
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: workspace('// builds\n', {
      'package.json': JSON.stringify({ name: 'x', private: true, workspaces: ['packages/*'] }), 'lib/impl.mjs': 'export const f = () => 4;\n', [`${dir}/helper.js`]: 'module.exports = { expected: 3 };\n',
      [`${dir}/a.test.mjs`]: `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { createRequire } from 'node:module';\nimport { f } from '../../../lib/impl.mjs';\n\ntest('${c1} sums', () => {\n  assert.equal(f(), createRequire(import.meta.url)('./helper').expected);\n});\n`,
    }),
    commits: [{ files: { 'packages/lib/build.mjs': `// builds\nimport { writeFileSync } from 'node:fs';\nwriteFileSync('../../${dir}/helper', 'module.exports = { expected: 4 };\\n');\n` }, message: `Edit\n\nCloses #${ISSUE}` }],
  }), ['trace']);
  assert.ok(problems(result, 'before').some((found) => found.includes(`${c1} sums: fails on the change`)), show(result));
  assert.notEqual(result.status, 0, show(result));
});

test("a workspace build can't rewrite a hollow tagged test in the copy the mutation lane runs", (t) => {
  const real = `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { f } from '../../../packages/lib/src/impl.ts';\n\ntest('${c1} sums', () => {\n  assert.equal(f(1, 2), 3);\n});\n`;
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: workspace('// builds\n', {
      'packages/lib/src/impl.ts': 'export const f = (a: number, b: number) => 0;\n',
      [`${dir}/a.test.mjs`]: `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { f } from '../../../packages/lib/src/impl.ts';\n\ntest('${c1} sums', () => {\n  assert.equal(typeof f, 'function');\n});\n`,
    }),
    link: true,
    commits: [{ files: { 'packages/lib/src/impl.ts': 'export const f = (a: number, b: number) => a + b;\n', 'packages/lib/build.mjs': `// builds\nimport { writeFileSync } from 'node:fs';\nwriteFileSync('../../${dir}/a.test.mjs', ${JSON.stringify(real)});\n` }, message: `Edit\n\nCloses #${ISSUE}` }],
  }), ['--release', 'mutation', 'trace']);
  if (!strykerPresent()) return assert.ok(problems(result, 'mutation').some((found) => found.startsWith('BLOCKED')), show(result));
  assert.ok(!result.stdout.includes('PASS mutation'), show(result));
  assert.notEqual(result.status, 0, show(result));
});

test("a process the change's build leaves running can't change the merge base the before lane runs", (t) => {
  // It rewrites the code under test in every other proof checkout it finds for 30 s.
  const tamper = "import { spawn } from 'node:child_process';\nimport { resolve } from 'node:path';\nconst script = `const { readdirSync, writeFileSync, existsSync } = require('fs');\nconst [own, dir] = process.argv.slice(1), end = Date.now() + 30000;\nconst tick = () => {\n  try { for (const name of readdirSync(dir)) { const path = dir + '/' + name + '/packages/lib/src/impl.mjs'; if (name.startsWith('deep-proof-checkout-') && dir + '/' + name !== own && existsSync(path)) writeFileSync(path, 'export const f = 1;\\\\n'); } } catch {}\n  if (Date.now() < end) setTimeout(tick, 5);\n};\ntick();`;\nspawn(process.execPath, ['-e', script, resolve('../..'), resolve('../../..')], { detached: true, stdio: 'ignore' }).unref();\n";
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: workspace('// builds\n', { 'packages/lib/src/impl.mjs': 'export const f = () => 4;\n' }),
    commits: [{ files: {
      'packages/lib/src/impl.mjs': 'export const f = () => 3;\n', 'packages/lib/build.mjs': `// builds\n${tamper}`,
      [`${dir}/a.test.mjs`]: `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { f } from '../../../packages/lib/src/impl.mjs';\n\ntest('${c1} sums', () => {\n  assert.equal(typeof f, 'function');\n});\n`,
    }, message: `Add f\n\nCloses #${ISSUE}` }],
  }), ['trace']);
  assert.ok(!result.stdout.includes('PASS before'), show(result));
  assert.notEqual(result.status, 0, show(result));
});

test("a workspace build can't plant a json file or a package.json that a test's import of a helper folder resolves to", (t) => {
  for (const [label, plant] of [
    ['json', `writeFileSync('../../${dir}/support.json', JSON.stringify({ expected: 4 }));`],
    ['package', `writeFileSync('../../${dir}/support/package.json', JSON.stringify({ main: 'data.json' }));\nwriteFileSync('../../${dir}/support/data.json', JSON.stringify({ expected: 4 }));`],
  ]) {
    const result = proof(repo(t, {
      issues: { [ISSUE]: ['Adds'] },
      base: workspace('// builds\n', {
        'package.json': JSON.stringify({ name: 'x', private: true, workspaces: ['packages/*'] }), 'lib/impl.mjs': 'export const f = () => 4;\n', [`${dir}/support/index.js`]: 'module.exports = { expected: 3 };\n',
        [`${dir}/a.test.mjs`]: `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { createRequire } from 'node:module';\nimport { f } from '../../../lib/impl.mjs';\n\ntest('${c1} sums', () => {\n  assert.equal(f(), createRequire(import.meta.url)('./support').expected);\n});\n`,
      }),
      commits: [{ files: { 'packages/lib/build.mjs': `// builds\nimport { writeFileSync } from 'node:fs';\n${plant}\n` }, message: `Edit\n\nCloses #${ISSUE}` }],
    }), ['trace']);
    assert.ok(problems(result, 'before').some((found) => found.includes(`${c1} sums: fails on the change`)), `${label}\n${show(result)}`);
  }
});

test("on a disk that ignores case, a build-planted Support.json or Package.json shadows a helper no more than its lower-case name, and a Vitest.config is the runner's config", (t) => {
  for (const [label, plant] of [
    ['json', `writeFileSync('../../${dir}/Support.json', JSON.stringify({ expected: 4 }));`],
    ['package', `writeFileSync('../../${dir}/support/Package.json', JSON.stringify({ main: 'data.json' }));\nwriteFileSync('../../${dir}/support/data.json', JSON.stringify({ expected: 4 }));`],
  ]) {
    const result = proof(repo(t, {
      issues: { [ISSUE]: ['Adds'] },
      base: workspace('// builds\n', {
        'package.json': JSON.stringify({ name: 'x', private: true, workspaces: ['packages/*'] }), 'lib/impl.mjs': 'export const f = () => 4;\n', [`${dir}/support/index.js`]: 'module.exports = { expected: 3 };\n',
        [`${dir}/a.test.mjs`]: `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { createRequire } from 'node:module';\nimport { f } from '../../../lib/impl.mjs';\n\ntest('${c1} sums', () => {\n  assert.equal(f(), createRequire(import.meta.url)('./support').expected);\n});\n`,
      }),
      commits: [{ files: { 'packages/lib/build.mjs': `// builds\nimport { writeFileSync } from 'node:fs';\n${plant}\n` }, message: `Edit\n\nCloses #${ISSUE}` }],
    }), ['trace']);
    assert.ok(problems(result, 'before').some((found) => found.includes(`${c1} sums: fails on the change`)), `${label}\n${show(result)}`);
  }
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: { 'scripts/proof-guard.mjs': '// the guard\n' },
    commits: [{ files: { 'Vitest.config.mjs': "export default { resolve: { alias: { './support': './lib/expected.mjs' } } };\n" }, message: `Edit\n\nPart of #${ISSUE}` }],
  }), ['guard']);
  assert.ok(problems(result, 'guard').some((found) => found.startsWith("FAIL guard: Vitest.config.mjs: the test runner's config")), show(result));
});

test('once main holds the proof lanes, the change re-pointing a package a test imports, in package.json or the lock, is a guarded edit; another package is free', (t) => {
  const lock = (chai) => JSON.stringify({ name: 'x', lockfileVersion: 3, requires: true, packages: { '': { name: 'x', devDependencies: { chai: chai.spec, left: '1.0.0' } }, 'node_modules/chai': chai.entry, 'node_modules/left': { version: '1.0.0' } } }, null, 2);
  const real = { spec: '^5.0.0', entry: { version: '5.0.0' } }, vendored = { spec: 'file:vendor/chai', entry: { resolved: 'vendor/chai', link: true } };
  const pkg = (spec, left = '1.0.0') => JSON.stringify({ name: 'x', devDependencies: { chai: spec, left } }, null, 2);
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: {
      'scripts/proof-guard.mjs': '// the guard\n', 'package.json': pkg(real.spec), 'package-lock.json': lock(real),
      [`${dir}/a.test.mjs`]: `import test from 'node:test';\nimport { assert } from 'chai';\n\ntest('${c1} sums', () => {\n  assert.equal(1, 1);\n});\n`,
    },
    commits: [
      { files: { 'package.json': pkg(vendored.spec), 'package-lock.json': lock(vendored), 'vendor/chai/index.js': 'export const assert = new Proxy({}, { get: () => () => {} });\n' }, message: `Vendor chai\n\nPart of #${ISSUE}` },
      { files: { 'package.json': pkg(vendored.spec, '2.0.0') }, message: `Bump left\n\nPart of #${ISSUE}` },
    ],
  }), ['guard']);
  const refused = problems(result, 'guard');
  for (const path of ['package.json', 'package-lock.json']) assert.ok(refused.some((found) => found.startsWith(`FAIL guard: ${path}: chai, a package a test imports, changed`)), `${path}\n${show(result)}`);
  assert.equal(refused.length, 2, show(result));
});

test("a workspace build can't replace the copy's link to a package with a folder of its own", (t) => {
  const scene = repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: workspace('// builds\n', {
      'packages/lib/package.json': JSON.stringify({ name: 'lib', version: '1.0.0', type: 'module', main: 'src/impl.mjs', scripts: { build: 'node build.mjs' } }), 'packages/lib/src/impl.mjs': 'export const f = () => 4;\n',
      [`${dir}/a.test.mjs`]: `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { f } from 'lib';\n\ntest('${c1} sums', () => {\n  assert.equal(f(), 3);\n});\n`,
    }),
    commits: [{ files: { 'packages/lib/build.mjs': "// builds\nimport { mkdirSync, rmSync, writeFileSync } from 'node:fs';\nrmSync('../../node_modules/lib');\nmkdirSync('../../node_modules/lib');\nwriteFileSync('../../node_modules/lib/package.json', '{ \"name\": \"lib\", \"type\": \"module\", \"main\": \"index.mjs\" }');\nwriteFileSync('../../node_modules/lib/index.mjs', 'export const f = () => 3;\\n');\n" }, message: `Edit\n\nCloses #${ISSUE}` }],
  });
  // The repository's install, as npm ci lays a workspace's link.
  mkdirSync(join(scene.cwd, 'node_modules'));
  symlinkSync('../packages/lib', join(scene.cwd, 'node_modules/lib'));
  const result = proof(scene, ['trace']);
  assert.ok(problems(result, 'before').some((found) => found.includes(`${c1} sums: fails on the change`)), show(result));
  assert.notEqual(result.status, 0, show(result));
});

test('a json file added beside a held module of its stem shadows nothing, as every resolver tries the module first', (t) => {
  const result = proof(repo(t, {
    issues: { [ISSUE]: ['Adds'] },
    base: {
      [`${dir}/cases.ts`]: 'export const want = 3;\n',
      [`${dir}/a.test.ts`]: `import { it, expect } from 'vitest';\nimport { want } from './cases';\n\nit('${c1} sums', () => {\n  expect(3).toBe(want);\n});\n`,
    },
    commits: [{ files: { [`${dir}/cases.json`]: '{ "want": 4 }\n' }, message: `Add data\n\nPart of #${ISSUE}` }],
  }), ['guard']);
  assert.ok(!problems(result, 'guard').some((found) => found.includes('cases')), show(result));
});
