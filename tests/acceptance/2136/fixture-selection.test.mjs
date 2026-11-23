// #2136, criterion 4: affected.mjs never runs a fixture project's test as one of the repo's own. Reached by running
// `node scripts/affected.mjs --list <paths>` in a scratch tree holding this checkout's scripts and its real gate
// fixture case answered-fail (README: The affected.mjs tree); --list prints the plan, block by block, and runs nothing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CHECKOUT, affected, affectedTree, dump, real, repoFiles, sandbox } from './helpers.mjs';

const CASE = 'packages/conformance/fixtures/gate/cases/answered-fail/';
// The issue's own example: a source file of the case, whose test/cart.test.js imports it.
const SOURCE = `${CASE}base/src/cart.js`;
const PLAIN = 'src/plain-2136.mjs', PLAIN_TEST = 'tests/fixture-2136/plain.test.mjs';

test('#2136.3bd30215 a change to a source file of a gate fixture case puts no file under packages/*/fixtures/ in any block of the plan', async (t) => {
  const box = sandbox(t);
  const caseFiles = repoFiles(CHECKOUT).filter((path) => path.startsWith(CASE));
  assert.ok(caseFiles.includes(SOURCE) && caseFiles.some((path) => path.startsWith(`${CASE}base/test/`)), `this checkout's gate fixture case ${CASE} no longer holds ${SOURCE} and a test beside it`);
  const tree = affectedTree(box, {
    ...Object.fromEntries(caseFiles.map((path) => [path, real(path)])),
    'packages/conformance/package.json': real('packages/conformance/package.json'),
    // One of the repo's own, changed beside it, so the plan is seen to have blocks.
    [PLAIN]: 'export const plain = 1;\n',
    [PLAIN_TEST]: `import test from 'node:test';\nimport { plain } from '../../${PLAIN}';\ntest('plain is one', () => { if (plain !== 1) throw Error('not one'); });\n`,
  });
  const run = await affected(box, tree, ['--list', SOURCE, PLAIN]);
  const out = dump(box, run);
  assert.equal(run.status, 0, `affected.mjs --list did not print its plan\n${out}`);
  // Each block's line: `<block> <runner>: <file> <file> ...`, with a note in brackets after a block --timed or --slow runs.
  const blocks = run.stdout.split('\n').flatMap((line) => {
    const [, block, files] = line.match(/^((?:parallel|alone|timed|slow) (?:vitest|node)): (.*?)(?: \(--\w+ runs them\))?$/) ?? [];
    return block ? [{ block, files: files.split(' ') }] : [];
  });
  assert.ok(blocks.some(({ files }) => files.includes(PLAIN_TEST)), `the plan has no block holding ${PLAIN_TEST}, the repo's own test the change reaches\n${out}`);
  const fixtures = blocks.flatMap(({ block, files }) => files.filter((file) => /^packages\/[^/]+\/fixtures\//.test(file)).map((file) => `${block}: ${file}`));
  assert.deepEqual(fixtures, [], `a change to ${SOURCE} puts a fixture project's file in a block of the plan\n${out}`);
});
