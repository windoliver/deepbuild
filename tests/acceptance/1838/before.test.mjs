// #1838 criterion 3: the before lane, `node scripts/proof.mjs before` from this checkout, run in a scratch repository
// whose change fixes a module and adds tagged tests of it that fail on the merge base at their assertions
// (README: Surfaces).
import assert from 'node:assert/strict';
import test from 'node:test';
import { criterionId, linesFor, LONG, named, proof, repository, sandbox, show } from './helpers.mjs';

// The planted issue each fixture change names, and its criteria.
const ISSUE = 9838;
const SUMS = 'Two numbers add up to their sum';
const HALVES = 'Sums and halves are both right';
const [sums, halves] = [SUMS, HALVES].map((text) => criterionId(ISSUE, text));
const dir = `tests/acceptance/${ISSUE}`;

// What the change fixes: the module is wrong on main.
const WRONG = 'export const add = (a, b) => a - b;\nexport const half = (n) => n;\n';
const RIGHT = 'export const add = (a, b) => a + b;\nexport const half = (n) => n / 2;\n';

// A test whose assertion message holds a line shaped like a stack frame, outside the checkout.
const MESSAGE = { path: `${dir}/message.test.mjs`, name: `${sums} adds two numbers` };
const messageTest = `import assert from 'node:assert/strict';
import { it } from 'node:test';
import { add } from '../../../src/sums.mjs';

it(${JSON.stringify(MESSAGE.name)}, () => {
  assert.equal(add(2, 3), 5, 'add(2, 3) is not 5\\nat /tmp/x.js:1:1');
});
`;
// A parent test with no assertion of its own, whose two subtests each fail on the merge base at their assertions.
const PARENT = { path: `${dir}/parent.test.mjs`, name: `${halves} sums and halves` };
const SUBTESTS = ['adds', 'halves'].map((name) => `${PARENT.name} › ${name}`);
const parentTest = `import assert from 'node:assert/strict';
import test from 'node:test';
import { add, half } from '../../../src/sums.mjs';

test(${JSON.stringify(PARENT.name)}, async (t) => {
  await t.test('adds', () => {
    assert.equal(add(2, 3), 5);
  });
  await t.test('halves', () => {
    assert.equal(half(8), 4);
  });
});
`;

let lane;
// One run of the lane serves both tests: it takes a minute or more on a loaded machine.
function before(t) {
  if (!lane) {
    const box = sandbox(t);
    const cwd = repository(box, {
      base: { 'src/sums.mjs': WRONG },
      change: { 'src/sums.mjs': RIGHT, [MESSAGE.path]: messageTest, [PARENT.path]: parentTest },
      message: `Fix add and half\n\nPart of #${ISSUE}`,
    });
    lane = proof(box, cwd, { [ISSUE]: [SUMS, HALVES] }, ['before']);
  }
  return lane;
}

const proven = (result, key) => {
  const lines = linesFor(result, 'before', key);
  assert.ok(lines.length, `the before lane names no ${key}\n${show(result)}`);
  for (const line of lines) assert.match(line, /^PASS before: /, `${key} is not proven\n${show(result)}`);
};

test('#1838.737ec09d in the before lane, a test that fails on the merge base at its assertion, with a line `at /tmp/x.js:1:1` inside its assertion message, is proven at that assertion', LONG, (t) => {
  const result = before(t);
  proven(result, named(MESSAGE.path, MESSAGE.name));
  assert.match(linesFor(result, 'before', named(MESSAGE.path, MESSAGE.name))[0], /at its assertion/, show(result));
});

test('#1838.737ec09d in the before lane, a parent test whose subtests are each proven reads proven', LONG, (t) => {
  const result = before(t);
  for (const name of SUBTESTS) proven(result, named(PARENT.path, name));
  proven(result, named(PARENT.path, PARENT.name));
});
