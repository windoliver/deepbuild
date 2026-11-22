// #1838 criterion 2: `node scripts/affected.mjs`, this checkout's copied into a scratch tree, run on a change that
// deletes a test file (README: Surfaces).
import assert from 'node:assert/strict';
import test from 'node:test';
import { affectedTree, lastLine, LONG, planLines, run, sandbox, show } from './helpers.mjs';

const nodeTest = (name) => `import assert from 'node:assert/strict';
import test from 'node:test';
import { one } from '../src/one.mjs';

test('${name}', () => {
  assert.equal(one(), 1);
});
`;
const DELETED = 'tests/one.test.mjs';
const KEPT = 'tests/two.test.mjs';

// The merge base holds src/one.mjs and two tests that import it; the change edits src/one.mjs and deletes one test.
const scene = (t) => affectedTree(sandbox(t), {
  base: { 'src/one.mjs': 'export const one = () => 1;\n', [DELETED]: nodeTest('one is one'), [KEPT]: nodeTest('one is still one') },
  change: { 'src/one.mjs': '// One, the number.\nexport const one = () => 1;\n', [DELETED]: null },
  message: 'Edit one and delete a test of it',
});

test('#1838.241106cb affected.mjs on a change that deletes a test file plans no run for it, runs the test the change leaves, and ends with its verdict line', LONG, (t) => {
  const tree = scene(t);
  const result = run([process.execPath, 'scripts/affected.mjs'], tree);
  assert.doesNotMatch(result.stderr, /ENOENT/, `affected.mjs read a file the change deleted\n${show(result)}`);
  const plans = planLines(result.stdout);
  for (const line of plans) assert.ok(!line.includes(DELETED), `affected.mjs plans a run of ${DELETED}, which the change deletes: ${line}\n${show(result)}`);
  assert.ok(plans.some((line) => line.includes(KEPT)), `affected.mjs plans no run of ${KEPT}, which imports the changed file\n${show(result)}`);
  assert.match(lastLine(result.stdout), /^(?:PASS|FAIL|BLOCKED|INVALID|INCONCLUSIVE) affected: /, `the run does not end with its verdict line\n${show(result)}`);
  assert.match(lastLine(result.stdout), /\b1 passed\b/, `the kept test did not run and pass\n${show(result)}`);
});
