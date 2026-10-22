// Regressions of the proof lanes (#569) that its acceptance suite doesn't cover.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ISSUE, criterionId, named, problems, proof, repo, show } from './acceptance/569/helpers.mjs';

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
