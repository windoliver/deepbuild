// #3310 acceptance: the before lane runs no by-hand test file, and a criterion only a by-hand file tags stays
// open. Reached only through `node scripts/proof.mjs before [trace]` from this checkout with its cwd at a
// scratch git repository that holds its own `scripts/lanes.mjs` exporting `byHand` (README: Surfaces).
//
// The scratch repositories, the proof runner and the line assertions are #569's (tests/acceptance/569/helpers.mjs).
// Every tag is built at runtime from its criterion's text for a planted issue no real issue's tags can match.
import assert from 'node:assert/strict';
import test from 'node:test';
import { criterionId, line, linesOf, named, noProblemNaming, problems, proof, repo, show } from '../569/helpers.mjs';

// The planted issue. #93101's tags start `#93101.`, which no tag of a real issue (#1 to a few thousand) starts with.
const N = 93101;
const C = ['The sum of two numbers is their total', 'Half a number is it divided by two', 'Doubling a number multiplies it by two'];
const [c1, c2, c3] = C.map((text) => criterionId(N, text));
const dir = `tests/acceptance/${N}`;

// The merge base's arithmetic is wrong; the change fixes it.
const BUGGY = 'export const add = (a, b) => a - b;\nexport const half = (n) => n;\nexport const double = (n) => n;\n';
const FIXED = 'export const add = (a, b) => a + b;\nexport const half = (n) => n / 2;\nexport const double = (n) => n * 2;\n';
const testFile = (path, name, body) => {
  const up = '../'.repeat(path.split('/').length - 1);
  return `import assert from 'node:assert/strict';\nimport { it } from 'node:test';\nimport { add, double, half } from '${up}src/cart.mjs';\n\nit('${name}', () => {\n  ${body}\n});\n`;
};
/** The repository's own lane lists, as its scripts/lanes.mjs exports them. */
const lanes = (byHand) => `export const byHand = ${JSON.stringify(byHand)};\nexport const timed = [];\n`;

/**
 * A change naming #N (`word`), whose merge base already holds `scripts/lanes.mjs` listing `byHand`, and whose
 * commit fixes the arithmetic and adds `tests`: { path: [name, body] }.
 */
const scene = (t, byHand, tests, word = 'Part of') => repo(t, {
  base: { 'src/cart.mjs': BUGGY, 'scripts/lanes.mjs': lanes(byHand) },
  issues: { [N]: C },
  commits: [{
    files: { 'src/cart.mjs': FIXED, ...Object.fromEntries(Object.entries(tests).map(([path, [name, body]]) => [path, testFile(path, name, body)])) },
    message: `Fix the arithmetic\n\n${word} #${N}`,
  }],
});

// Criterion 1's scene: a by-hand test of c1 that fails on the change, and two tests of #N not on the list: one that
// passes on the change and fails on the merge base at its assertion, and one that fails on the change.
const HAND_NAME = `${c1} adds two numbers, by hand`;
const PROVEN = [`${dir}/half.test.mjs`, `${c2} halves a number`];
const FAILING = [`${dir}/double.test.mjs`, `${c3} doubles a number, wrongly`];
const unlisted = {
  [PROVEN[0]]: [PROVEN[1], 'assert.equal(half(8), 4);'],
  [FAILING[0]]: [FAILING[1], 'assert.equal(double(2), 5);'],
};

/** A before line, of any state or none (`before: …`), naming `path` as by hand. */
const byHandLine = (result, path) => result.lines.find((text) => /^(?:[A-Z]+ )?before: /.test(text) && text.includes(path) && /by hand/i.test(text));

function assertLeftOut(result, path) {
  // No FAIL, BLOCKED, INVALID or INCONCLUSIVE before line names the by-hand file or its test.
  noProblemNaming(result, 'before', path, HAND_NAME);
  // It is not run either: no PASS before line names its test.
  assert.ok(!linesOf(result, ['PASS'], 'before').some((text) => text.includes(HAND_NAME)), `the by-hand test was judged\n${show(result)}`);
  assert.ok(byHandLine(result, path), `no before line names ${path} as by hand\n${show(result)}`);
  // The tests of #N not on the list are run and judged as today.
  line(result, ['PASS'], 'before', named(...PROVEN), 'failed on the merge base at its assertion');
  line(result, ['FAIL'], 'before', named(...FAILING), 'fails on the change');
  assert.equal(result.status, 1, `the unlisted failing test still fails the run\n${show(result)}`);
}

test('#3310.b5cddbf4 a by-hand file listed by its path, failing on the change, gets no FAIL, BLOCKED or INCONCLUSIVE before line, a before line names it as by hand, and the tests not on the list are run and judged as today', (t) => {
  const path = `${dir}/hand.test.mjs`;
  const result = proof(scene(t, [path], { [path]: [HAND_NAME, 'assert.equal(add(2, 3), 6);'], ...unlisted }), ['before']);
  assertLeftOut(result, path);
});

test('#3310.b5cddbf4 a by-hand file under a folder entry ending in /, failing on the change, gets no FAIL, BLOCKED or INCONCLUSIVE before line, a before line names it as by hand, and the tests not on the list are run and judged as today', (t) => {
  const path = `${dir}/first-draft/hand.test.mjs`;
  const result = proof(scene(t, [`${dir}/first-draft/`], { [path]: [HAND_NAME, 'assert.equal(add(2, 3), 6);'], ...unlisted }), ['before']);
  assertLeftOut(result, path);
});

test('#3310.5f3438ea a change saying Closes, where the only test of one criterion is listed by hand and passes on the change and fails on the merge base at its assertion: trace refuses Closes with that criterion open, and the run exits non-zero', (t) => {
  const hand = `${dir}/hand.test.mjs`;
  const result = proof(scene(t, [hand], {
    [hand]: [`${c1} adds two numbers`, 'assert.equal(add(2, 3), 5);'],
    [PROVEN[0]]: [PROVEN[1], 'assert.equal(half(8), 4);'],
    [`${dir}/double.test.mjs`]: [`${c3} doubles a number`, 'assert.equal(double(2), 4);'],
  }, 'Closes'), ['before', 'trace']);
  const refusal = line(result, ['FAIL'], 'trace', `Closes #${N}`);
  assert.ok(refusal.includes(c1), `the refusal does not name ${c1} open: ${refusal}\n${show(result)}`);
  for (const id of [c2, c3]) assert.ok(!refusal.includes(id), `${id} is named open though its unlisted test proves it: ${refusal}`);
  assert.notEqual(result.status, 0, show(result));
  // The unlisted tests are still proven, so only the by-hand criterion is open.
  assert.deepEqual(problems(result, 'before'), [], show(result));
});
