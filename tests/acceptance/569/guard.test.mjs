// #569 acceptance: the test guard (criteria 1 to 3), through `node scripts/proof.mjs guard` (and,
// once, the default local run) in scratch repositories.
import test from 'node:test';
import { ISSUE, OTHER, assertFails, assertPasses, criterionId, line, named, noProblemNaming, proof, repo } from './helpers.mjs';

const C = [
  'The sum of two numbers is their total',
  'The receipt lists each line with its price',
  'An empty receipt is one empty line',
];
const [c1, c2, c3] = C.map((text) => criterionId(ISSUE, text));
const otherTag = criterionId(OTHER, 'The other issue holds its own criterion');

const FILE = `tests/acceptance/${ISSUE}/cart.test.mjs`;
const GOLDEN = `tests/acceptance/${ISSUE}/fixtures/receipt.golden.txt`;
const n1 = `${c1} adds two numbers`;
const n2 = `${c2} lists each line with its price`;
const n3 = `${c3} prints an empty receipt`;
const untagged = 'formats a price with no criterion';

const CODE = "export const add = (a, b) => a + b;\nexport const receipt = (items) => items.map(([name, price]) => `${name} ${price}`).join('\\n') + '\\n';\nexport const price = (n) => `${n}`;\n";

// The tagged test file at the merge base; `edit` rewrites parts of it for a planted change.
function cart({ skip1 = false, skip2 = false, expected1 = 5, drop1 = false, untaggedBody = "assert.equal(price(3), '3');", added = '' } = {}) {
  const t1 = drop1 ? '' : `it${skip1 ? '.skip' : ''}('${n1}', () => {\n  assert.equal(add(2, 3), ${expected1});\n});\n\n`;
  return `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';
import { add, price, receipt } from '../../../src/cart.mjs';

${t1}it${skip2 ? '.skip' : ''}('${n2}', () => {
  const golden = readFileSync(new URL('fixtures/receipt.golden.txt', import.meta.url), 'utf8');
  assert.equal(receipt([['tea', 3], ['cake', 4]]), golden);
});

it('${n3}', () => {
  assert.equal(receipt([]), '\\n');
});

it('${untagged}', () => {
  ${untaggedBody}
});
${added}`;
}

const OTHER_FILE = `tests/acceptance/${OTHER}/other.test.mjs`;
const otherTest = (expected) => `import assert from 'node:assert/strict';\nimport { it } from 'node:test';\nimport { add } from '../../../src/cart.mjs';\n\nit('${otherTag} adds zero', () => {\n  assert.equal(add(0, 0), ${expected});\n});\n`;
const UNIT_FILE = 'tests/unit/price.test.mjs';
const unitTest = (expected) => `import assert from 'node:assert/strict';\nimport { it } from 'node:test';\nimport { price } from '../../src/cart.mjs';\n\nit('prints a price', () => {\n  assert.equal(price(1), ${expected});\n});\n`;

const BASE_FILES = {
  'src/cart.mjs': CODE,
  [FILE]: cart(),
  [GOLDEN]: 'tea 3\ncake 4\n',
  [OTHER_FILE]: otherTest(0),
  [UNIT_FILE]: unitTest("'1'"),
};
const ISSUES = { [ISSUE]: C, [OTHER]: ['The other issue holds its own criterion'] };
const scene = (t, commits, extra = {}) => repo(t, { base: BASE_FILES, issues: ISSUES, commits, ...extra });

// Criterion 1: each planted edit fails the guard, naming the test and so its criterion.

test('#569.a14ef07d it.skip added to a tagged test fails the guard, naming the test and its criterion', (t) => {
  const result = proof(scene(t, [{ files: { [FILE]: cart({ skip1: true }) }, message: `Skip the sum test\n\nCloses #${ISSUE}` }]), ['guard']);
  assertFails(result, 'guard');
  line(result, ['FAIL'], 'guard', named(FILE, n1), c1);
  noProblemNaming(result, 'guard', n2, n3, untagged);
});

test('#569.a14ef07d it.skip left uncommitted in the worktree fails the guard too', (t) => {
  const result = proof(scene(t, [{ files: { 'src/cart.mjs': `${CODE}// touched\n` }, message: `Touch the cart\n\nCloses #${ISSUE}` }], { uncommitted: { [FILE]: cart({ skip1: true }) } }), ['guard']);
  assertFails(result, 'guard');
  line(result, ['FAIL'], 'guard', named(FILE, n1), c1);
});

test('#569.a14ef07d deleting a tagged test, its file kept, fails the guard, naming the test and its criterion', (t) => {
  const result = proof(scene(t, [{ files: { [FILE]: cart({ drop1: true }) }, message: `Drop the sum test\n\nCloses #${ISSUE}` }]), ['guard']);
  assertFails(result, 'guard');
  line(result, ['FAIL'], 'guard', named(FILE, n1), c1);
});

test('#569.a14ef07d rewriting a tagged test\'s expected value to the new output fails the guard, naming the test and its criterion', (t) => {
  const result = proof(scene(t, [{
    files: { 'src/cart.mjs': CODE.replace('a + b', 'a + b + 1'), [FILE]: cart({ expected1: 6 }) },
    message: `Sum differently\n\nCloses #${ISSUE}`,
  }]), ['guard']);
  assertFails(result, 'guard');
  line(result, ['FAIL'], 'guard', named(FILE, n1), c1);
});

test('#569.a14ef07d re-recording the golden a tagged test reads fails the guard, naming the golden, the test and its criterion', (t) => {
  const result = proof(scene(t, [{
    files: { 'src/cart.mjs': CODE.replace('`${name} ${price}`', () => '`${name}: ${price}`'), [GOLDEN]: 'tea: 3\ncake: 4\n' },
    message: `Colon in receipts\n\nCloses #${ISSUE}`,
  }]), ['guard']);
  assertFails(result, 'guard');
  line(result, ['FAIL'], 'guard', GOLDEN, named(FILE, n2), c2);
});

test('#569.a14ef07d the default local proof run includes the guard: it.skip fails it', (t) => {
  const result = proof(scene(t, [{ files: { [FILE]: cart({ skip1: true }) }, message: `Skip the sum test\n\nCloses #${ISSUE}` }]));
  assertFails(result, 'guard');
  line(result, ['FAIL'], 'guard', named(FILE, n1), c1);
});

// Criterion 2: the same edit as its own approved proposal passes; the approval covers only what it names.

const code = { files: { 'src/cart.mjs': `${CODE}export const tax = (n) => n / 10;\n` }, message: `Add tax\n\nCloses #${ISSUE}` };

test('#569.9a8442f7 the it.skip edit sent as its own proposal and approved by you passes the guard', (t) => {
  const result = proof(scene(t, [code, {
    files: { [FILE]: cart({ skip1: true }) },
    message: 'Propose skipping the sum test',
    approve: { items: [named(FILE, n1)] },
  }]), ['guard']);
  assertPasses(result, 'guard');
});

test('#569.9a8442f7 an approval for one test lets no other test\'s edit through, naming the second test', (t) => {
  const result = proof(scene(t, [code, {
    files: { [FILE]: cart({ skip1: true, skip2: true }) },
    message: 'Propose skipping two tests',
    approve: { items: [named(FILE, n1)] },
  }]), ['guard']);
  assertFails(result, 'guard');
  line(result, ['FAIL'], 'guard', named(FILE, n2), c2);
  noProblemNaming(result, 'guard', n1);
});

test('#569.9a8442f7 an approved proposal that also carries the change it would let pass is not its own proposal, and fails', (t) => {
  const result = proof(scene(t, [{
    files: { 'src/cart.mjs': `${CODE}export const tax = (n) => n / 10;\n`, [FILE]: cart({ skip1: true }) },
    message: `Add tax and skip the sum test\n\nCloses #${ISSUE}`,
    approve: { items: [named(FILE, n1)] },
  }]), ['guard']);
  assertFails(result, 'guard');
  line(result, ['FAIL'], 'guard', named(FILE, n1), c1);
});

for (const [how, signer] of [['unsigned', null], ['signed by a key the approvers file does not list', 'stranger']]) {
  test(`#569.9a8442f7 an approval ${how} is no approval: the edit fails the guard`, (t) => {
    const result = proof(scene(t, [code, {
      files: { [FILE]: cart({ skip1: true }) },
      message: 'Propose skipping the sum test',
      approve: { items: [named(FILE, n1)], signer },
    }]), ['guard']);
    assertFails(result, 'guard');
    line(result, ['FAIL'], 'guard', named(FILE, n1), c1);
  });
}

// Criterion 3: only added tests, or edits to tests no criterion of the issue tags, pass.

test('#569.fe787486 a change that only adds tests, to a tagged file and in a new file, passes the guard', (t) => {
  const added = `\nit('${c3} prints one line per item', () => {\n  assert.equal(receipt([['tea', 3]]), 'tea 3\\n');\n});\n`;
  const result = proof(scene(t, [code, {
    files: {
      [FILE]: cart({ added }),
      [`tests/acceptance/${ISSUE}/tax.test.mjs`]: `import assert from 'node:assert/strict';\nimport { it } from 'node:test';\nimport { tax } from '../../../src/cart.mjs';\n\nit('${c1} taxes a tenth', () => {\n  assert.equal(tax(10), 1);\n});\n`,
    },
    message: `Add tests\n\nCloses #${ISSUE}`,
  }]), ['guard']);
  assertPasses(result, 'guard');
});

test('#569.fe787486 edits to tests no criterion of the issue tags pass the guard: an untagged test beside tagged ones, another issue\'s test and an untagged file', (t) => {
  const result = proof(scene(t, [{
    files: {
      'src/cart.mjs': CODE.replace('`${n}`', () => '`$${n}`'),
      [FILE]: cart({ untaggedBody: "assert.equal(price(3), '$3');" }),
      [OTHER_FILE]: otherTest('0 + 0'),
      [UNIT_FILE]: unitTest("'$1'"),
    },
    message: `Dollar prices\n\nCloses #${ISSUE}`,
  }]), ['guard']);
  assertPasses(result, 'guard');
});
