// #569 acceptance: the mutation lane (criterion 8, and the mutant half of criterion 5), through
// `node scripts/proof.mjs mutation` on demand, `--release mutation`, and the default local run.
// StrykerJS is found as node_modules/.bin/stryker in the repository checked, which links this
// checkout's node_modules: without it the lane must be BLOCKED, naming StrykerJS, and these tests
// accept the real result only when it is there (README Reading 13).
import assert from 'node:assert/strict';
import test from 'node:test';
import { ISSUE, assertFails, criterionId, line, linesOf, named, noProblemNaming, problems, proof, repo, show, strykerPresent } from './helpers.mjs';

const C = ['The total is the sum of the prices', 'A discount takes a tenth off'];
const [c1, c2] = C.map((text) => criterionId(ISSUE, text));
const dir = `tests/acceptance/${ISSUE}`;
const SOURCE = 'packages/calc/src/calc.ts';

const LEGACY = 'export function legacy(n: number): number {\n  return n * 2;\n}\n';
const ADDED = `
export function total(prices: number[]): number {
  return prices.reduce((sum, price) => sum + price, 0);
}

export function discount(price: number): number {
  return price - price / 10;
}

export function unused(n: number): number {
  return n + 1;
}
`;
const after = LEGACY + ADDED;
const at = (text) => after.split('\n').findIndex((row) => row.includes(text)) + 1;
const DISCOUNT_LINE = at('return price - price / 10;');
const LEGACY_LINE = at('return n * 2;');
const UNUSED_LINE = at('return n + 1;');

const testFile = (imports, name, body) => `import assert from 'node:assert/strict';\nimport { it } from 'node:test';\nimport { ${imports} } from '../../../${SOURCE}';\n\nit('${name}', () => {\n  ${body}\n});\n`;
const scene = (t) => repo(t, {
  base: { 'packages/calc/package.json': '{ "name": "calc", "version": "0.0.0", "private": true, "type": "module" }\n', [SOURCE]: LEGACY },
  issues: { [ISSUE]: C },
  link: true,
  commits: [{
    files: {
      [SOURCE]: after,
      [`${dir}/total.test.mjs`]: testFile('total', `${c1} totals the prices`, 'assert.equal(total([1, 2, 3]), 6);'),
      // A planted test that asserts nothing: it calls discount and checks no result.
      [`${dir}/discount.test.mjs`]: testFile('discount', `${c2} discounts a price`, 'discount(100);'),
    },
    message: `Add total and discount\n\nPart of #${ISSUE}`,
  }],
});

function blockedOnStryker(result) {
  assertFails(result, 'mutation');
  line(result, ['BLOCKED'], 'mutation', 'StrykerJS');
}

test('#569.60ea8a8b the mutation lane lists every surviving mutant on an added line a tagged test executes, with its diff, and a test that asserts nothing makes its criterion INVALID', (t) => {
  const result = proof(scene(t), ['mutation']);
  if (!strykerPresent()) return blockedOnStryker(result);
  assert.equal(result.status, 1, show(result));
  // discount's added line: executed by the planted test, every mutant there survives.
  assert.match(result.stdout, new RegExp(`^SURVIVED ${SOURCE}:${DISCOUNT_LINE}\\b`, 'm'), show(result));
  assert.match(result.stdout, /^ {4}-\s*return price - price \/ 10;$/m, show(result));
  assert.match(result.stdout, /^ {4}\+.*\S/m, show(result));
  // Lines the change didn't add, and added lines no tagged test executes, are not listed.
  assert.doesNotMatch(result.stdout, new RegExp(`${SOURCE}:${LEGACY_LINE}\\b`), show(result));
  assert.doesNotMatch(result.stdout, new RegExp(`${SOURCE}:${UNUSED_LINE}\\b`), show(result));
  line(result, ['INVALID'], 'mutation', c2);
  noProblemNaming(result, 'mutation', c1);
});

test('#569.60ea8a8b the mutation lane runs in the release preflight and on demand, never in the local run', (t) => {
  const local = proof(scene(t));
  assert.deepEqual(linesOf(local, ['PASS', 'FAIL', 'BLOCKED', 'INVALID', 'INCONCLUSIVE'], 'mutation'), [], show(local));
  assert.doesNotMatch(local.stdout, /^SURVIVED /m, show(local));
  const release = proof(scene(t), ['--release', 'mutation']);
  if (!strykerPresent()) return blockedOnStryker(release);
  line(release, ['INVALID'], 'mutation', c2);
});

test('#569.46c12530 a new test with no planted wrong program counts once it kills a mutant; one that kills none fails, naming its criterion', (t) => {
  const result = proof(scene(t), ['before', 'mutation']);
  if (!strykerPresent()) return blockedOnStryker(result);
  assertFails(result, 'before');
  noProblemNaming(result, 'before', `${c1} totals the prices`, c1);
  line(result, ['FAIL', 'INVALID'], 'before', named(`${dir}/discount.test.mjs`, `${c2} discounts a price`), c2);
  assert.ok(problems(result, 'mutation').some((text) => text.includes(c2)), show(result));
});
