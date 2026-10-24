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
