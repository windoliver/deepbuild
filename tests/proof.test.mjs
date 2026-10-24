// Regressions of the proof lanes (#569) that its acceptance suite doesn't cover.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ISSUE, criterionId, git, named, problems, proof, repo, show, write } from './acceptance/569/helpers.mjs';

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
