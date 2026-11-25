// #3310: the before lane runs no by-hand file, but trace still reads its tags. A by-hand first draft whose tag names a
// criterion the issue no longer holds fails trace, as a file the lane runs does (#569's "a tag naming a criterion the
// edited issue no longer holds fails the lane").
import assert from 'node:assert/strict';
import test from 'node:test';
import { criterionId, line, proof, repo, show } from './acceptance/569/helpers.mjs';

const N = 93102;
const C = ['Half a number is it divided by two'];
const [held] = C.map((text) => criterionId(N, text));
const stale = criterionId(N, 'Half a number is it divided by three');
const file = (tag) => `import assert from 'node:assert/strict';\nimport { it } from 'node:test';\nimport { half } from '../../../src/cart.mjs';\n\nit('${tag} halves a number', () => {\n  assert.equal(half(8), 4);\n});\n`;

test('a by-hand file whose tag names no criterion of the issue fails trace', (t) => {
  const scene = repo(t, {
    base: { 'src/cart.mjs': 'export const half = (n) => n;\n', 'scripts/lanes.mjs': `export const byHand = ['tests/acceptance/${N}/old.test.mjs'];\nexport const timed = [];\n` },
    issues: { [N]: C },
    commits: [{
      files: { 'src/cart.mjs': 'export const half = (n) => n / 2;\n', [`tests/acceptance/${N}/old.test.mjs`]: file(stale), [`tests/acceptance/${N}/half.test.mjs`]: file(held) },
      message: `Fix half\n\nPart of #${N}`,
    }],
  });
  const result = proof(scene, ['before', 'trace']);
  line(result, ['FAIL'], 'trace', stale, 'names no criterion', 'by hand');
  assert.ok(!result.lines.some((text) => text.startsWith('FAIL trace') && text.includes(held)), `the held criterion's tag was refused\n${show(result)}`);
  assert.equal(result.status, 1, show(result));
});
