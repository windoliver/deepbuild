// #569 acceptance: the trace lane (criterion 7), through `node scripts/proof.mjs trace` with the
// planted issue's body read from DEEP_PROOF_ISSUES.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ISSUE, assertFails, assertPasses, criterionId, line, linesOf, proof, repo, show } from './helpers.mjs';

const C = ['The sum of two numbers is their total', 'Half a number is it divided by two', 'Doubling a number multiplies it by two'];
const EDITED = 'Doubling a number multiplies it by two, for negative numbers too';
const [c1, c2, c3] = C.map((text) => criterionId(ISSUE, text));
const c3edited = criterionId(ISSUE, EDITED);
const dir = `tests/acceptance/${ISSUE}`;

const BUGGY = 'export const add = (a, b) => a - b;\nexport const half = (n) => n;\nexport const double = (n) => n;\n';
const FIXED = 'export const add = (a, b) => a + b;\nexport const half = (n) => n / 2;\nexport const double = (n) => n * 2;\n';
const testFile = (name, body, how = 'it') => `import assert from 'node:assert/strict';\nimport { it } from 'node:test';\nimport { add, double, half } from '../../../src/cart.mjs';\n\n${how}('${name}', () => {\n  ${body}\n});\n`;
const T1 = { [`${dir}/add.test.mjs`]: testFile(`${c1} adds two numbers`, 'assert.equal(add(2, 3), 5);') };
const T2 = { [`${dir}/half.test.mjs`]: testFile(`${c2} halves a number`, 'assert.equal(half(8), 4);') };
const T3 = (tag = c3, how = 'it', body = 'assert.equal(double(2), 4);') => ({ [`${dir}/double.test.mjs`]: testFile(`${tag} doubles a number`, body, how) });

const scene = (t, tests, word = 'Closes', criteria = C) => repo(t, {
  base: { 'src/cart.mjs': BUGGY },
  issues: { [ISSUE]: criteria },
  commits: [{ files: { 'src/cart.mjs': FIXED, ...tests }, message: `Fix the arithmetic\n\n${word} #${ISSUE}` }],
});

/** The line that reads Part of: it names every open criterion and no proven one. */
function partOf(result, open, proven) {
  const found = line(result, ['FAIL'], 'trace', `Part of #${ISSUE}`);
  for (const id of open) assert.ok(found.includes(id), `${id} is not named open: ${found}`);
  for (const id of proven) assert.ok(!found.includes(id), `${id} is named open though its test proves it: ${found}`);
  return found;
}

test('#569.4ad4295a tests tagging criteria 1 and 2 of a three-criterion issue: Closes is refused, the change reads Part of, naming criterion 3', (t) => {
  const result = proof(scene(t, { ...T1, ...T2 }), ['trace']);
  assertFails(result, 'trace');
  partOf(result, [c3], [c1, c2]);
});

test('#569.4ad4295a with every criterion tagged by a test that ran, failed on the merge base and passes, Closes passes the trace lane', (t) => {
  assertPasses(proof(scene(t, { ...T1, ...T2, ...T3() }), ['trace']), 'trace');
});

test('#569.4ad4295a a change that says Part of passes the trace lane and still names criterion 3 as open', (t) => {
  const result = proof(scene(t, { ...T1, ...T2 }, 'Part of'), ['trace']);
  assertPasses(result, 'trace');
  assert.ok(linesOf(result, ['PASS'], 'trace').some((text) => text.includes(c3)), `criterion 3 is not named open\n${show(result)}`);
});

test('#569.4ad4295a a skipped test for criterion 3 is no test that ran: Closes is refused, naming criterion 3', (t) => {
  const result = proof(scene(t, { ...T1, ...T2, ...T3(c3, 'it.skip') }), ['trace']);
  assertFails(result, 'trace');
  partOf(result, [c3], [c1, c2]);
});

test('#569.4ad4295a a test for criterion 3 that passes on the merge base failed on no wrong program: Closes is refused, naming criterion 3', (t) => {
  const result = proof(scene(t, { ...T1, ...T2, ...T3(c3, 'it', 'assert.equal(double(0), 0);') }), ['trace']);
  assertFails(result, 'trace');
  partOf(result, [c3], [c1, c2]);
});

test('#569.4ad4295a a tag naming a criterion the edited issue no longer holds fails the lane, naming the tag', (t) => {
  const result = proof(scene(t, { ...T1, ...T2, ...T3() }, 'Closes', [C[0], C[1], EDITED]), ['trace']);
  assertFails(result, 'trace');
  line(result, ['FAIL'], 'trace', c3);
  partOf(result, [c3edited], [c1, c2]);
});
