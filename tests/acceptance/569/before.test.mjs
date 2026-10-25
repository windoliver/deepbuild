// #569 acceptance: fails before (criteria 4 to 6). Each new or changed tagged test runs on the merge
// base in a temporary checkout, through `node scripts/proof.mjs before`.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ISSUE, assertFails, criterionId, footprint, line, named, noProblemNaming, problems, proof, repo, show } from './helpers.mjs';

const C = [
  'The sum of two numbers is their total',
  'A check that asserts nothing proves nothing',
  'Tax is a tenth of the price',
  'Doubling a number multiplies it by two',
  'A discount takes a tenth off',
  'A discounted price is a number below the price',
];
const [c1, c2, c3, c4, c5, c6] = C.map((text) => criterionId(ISSUE, text));
const issues = { [ISSUE]: C };
const dir = `tests/acceptance/${ISSUE}`;
const testFile = (imports, name, body) => `import assert from 'node:assert/strict';\nimport { it } from 'node:test';\n${imports}\n\nit('${name}', () => {\n  ${body}\n});\n`;

// Criterion 4: the merge base has a bug in add; the fix corrects it and adds tax and double.
const BUGGY = 'export const add = (a, b) => a - b;\n';
const FIXED = 'export const add = (a, b) => a + b;\nexport const double = (n) => n * 2;\n';
const fixTests = {
  real: [`${dir}/add.test.mjs`, `${c1} adds two numbers`, testFile("import { add } from '../../../src/cart.mjs';", `${c1} adds two numbers`, 'assert.equal(add(2, 3), 5);')],
  vacuous: [`${dir}/vacuous.test.mjs`, `${c2} holds`, testFile('', `${c2} holds`, 'assert.ok(1 === 1);')],
  imports: [`${dir}/tax.test.mjs`, `${c3} taxes a tenth`, testFile("import { tax } from '../../../src/tax.mjs';", `${c3} taxes a tenth`, 'assert.equal(tax(100), 10);')],
  typeError: [`${dir}/double.test.mjs`, `${c4} doubles a number`, testFile("import * as cart from '../../../src/cart.mjs';", `${c4} doubles a number`, 'assert.equal(cart.double(2), 4);')],
};
const fixScene = (t) => repo(t, {
  base: { 'src/cart.mjs': BUGGY },
  issues,
  commits: [{
    files: { 'src/cart.mjs': FIXED, 'src/tax.mjs': 'export const tax = (n) => n / 10;\n', ...Object.fromEntries(Object.values(fixTests).map(([path, , content]) => [path, content])) },
    message: `Fix add, add tax and double\n\nCloses #${ISSUE}`,
  }],
});

test('#569.a7450c6d a fix test asserting 1 === 1 passes on the merge base and fails the preflight, naming the test; the real fix test, failing its assertion there, passes', (t) => {
  const scene = fixScene(t);
  const before = footprint(scene.cwd);
  const result = proof(scene, ['before']);
  assertFails(result, 'before');
  const [vacuousPath, vacuousName] = fixTests.vacuous;
  line(result, ['FAIL', 'INVALID'], 'before', named(vacuousPath, vacuousName), 'passed on the merge base');
  const [realPath, realName] = fixTests.real;
  noProblemNaming(result, 'before', realName, realPath);
  line(result, ['PASS'], 'before', named(realPath, realName), 'merge base');
  // The base run happens in a temporary checkout: the repository's worktrees, refs and status are unchanged.
  assert.equal(footprint(scene.cwd), before, show(result));
});

test('#569.a7450c6d a fix test that fails on the merge base only because its import is missing there fails the preflight, naming "failed on the base before its assertion"', (t) => {
  const result = proof(fixScene(t), ['before']);
  assertFails(result, 'before');
  const [path, name] = fixTests.imports;
  const found = line(result, ['FAIL', 'INVALID'], 'before', named(path, name), 'failed on the base before its assertion');
  assert.ok(/ERR_MODULE_NOT_FOUND|src\/tax\.mjs/.test(found), `the line names no missing import: ${found}`);
});

test('#569.a7450c6d a fix test that fails on the merge base only with a TypeError from calling a function the fix adds fails the preflight, naming "failed on the base before its assertion"', (t) => {
  const result = proof(fixScene(t), ['before']);
  assertFails(result, 'before');
  const [path, name] = fixTests.typeError;
  const found = line(result, ['FAIL', 'INVALID'], 'before', named(path, name), 'failed on the base before its assertion');
  assert.ok(found.includes('TypeError'), `the line names no TypeError: ${found}`);
});

// Criterion 5: new code the merge base doesn't have. Each criterion names its planted wrong
// program in tests/acceptance/<issue>/twins.json; each twin replaces the files under its folder.
const DISCOUNT = 'export const discount = (price) => price - price / 10;\n';
const newCodeScene = (t) => repo(t, {
  base: { 'src/cart.mjs': FIXED },
  issues,
  commits: [{
    files: {
      'src/discount.mjs': DISCOUNT,
      [`${dir}/discount.test.mjs`]: testFile("import { discount } from '../../../src/discount.mjs';", `${c5} takes a tenth off`, 'assert.equal(discount(100), 90);'),
      [`${dir}/discounted.test.mjs`]: testFile("import { discount } from '../../../src/discount.mjs';", `${c6} is a number`, "assert.equal(typeof discount(100), 'number');"),
      [`${dir}/twins.json`]: `${JSON.stringify({ [c5]: ['no-discount'], [c6]: ['tenth-added'] }, null, 2)}\n`,
      [`${dir}/twins/no-discount/src/discount.mjs`]: 'export const discount = (price) => price;\n',
      [`${dir}/twins/tenth-added/src/discount.mjs`]: 'export const discount = (price) => price + price / 10;\n',
    },
    message: `Add discount\n\nCloses #${ISSUE}`,
  }],
});

test('#569.46c12530 a new test of code the merge base lacks passes when it fails on the planted wrong program its criterion names', (t) => {
  const result = proof(newCodeScene(t), ['before']);
  noProblemNaming(result, 'before', `${c5} takes a tenth off`, c5);
  line(result, ['PASS'], 'before', named(`${dir}/discount.test.mjs`, `${c5} takes a tenth off`), 'no-discount');
});

test('#569.46c12530 a new test that fails neither on the merge base at its assertion nor on its planted wrong program fails the preflight, naming the criterion', (t) => {
  const result = proof(newCodeScene(t), ['before']);
  assertFails(result, 'before');
  line(result, ['FAIL', 'INVALID'], 'before', named(`${dir}/discounted.test.mjs`, `${c6} is a number`), c6);
});

// Criterion 6: the merge base's checkout can't install (its package-lock.json is not JSON); the change repairs it.
const PACKAGE = '{ "name": "fixture", "version": "1.0.0", "private": true, "type": "module" }\n';
const LOCK = `${JSON.stringify({ name: 'fixture', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'fixture', version: '1.0.0' } } }, null, 2)}\n`;

test('#569.26d13489 a test that cannot run on the merge base because its base checkout cannot install is BLOCKED, naming the cause, never a pass', (t) => {
  const [path, name, content] = fixTests.real;
  const result = proof(repo(t, {
    base: { 'package.json': PACKAGE, 'package-lock.json': '{ this lockfile is not JSON\n', 'src/cart.mjs': BUGGY },
    issues,
    commits: [{ files: { 'package-lock.json': LOCK, 'src/cart.mjs': FIXED, [path]: content }, message: `Fix add and the lockfile\n\nCloses #${ISSUE}` }],
  }), ['before']);
  assertFails(result, 'before');
  line(result, ['BLOCKED'], 'before', named(path, name), 'npm ci');
  assert.ok(!problems(result, 'before').some((text) => text.startsWith('FAIL') && text.includes(name)), `an install that broke is not the test failing\n${show(result)}`);
  assert.ok(!result.lines.some((text) => text.startsWith('PASS before') && text.includes(name)), show(result));
});
