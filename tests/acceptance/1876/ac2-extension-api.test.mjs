// #1876 criterion 2: every method in packages/contracts/extension-api.json is named in the design's Extension API
// block, and a planted `deep.ghost` entry fails the design links lane, naming it (README: Criteria and tests).
import assert from 'node:assert/strict';
import test from 'node:test';
import { API, CHECKOUT, DESIGN, apiBlock, clean, dotted, namesDotted, read, rows, runLane, shown, unfailed, write } from './helpers.mjs';

const METHOD = 'deep.ghost';

test('AC2 #1876.4ae35244 the Extension API block names every method of packages/contracts/extension-api.json, and a planted `deep.ghost` entry fails the design links lane, naming it', (t) => {
  const copy = clean(t);
  const problems = [];
  // The tree: the checkout's own design and extension-api.json.
  const block = apiBlock(read(CHECKOUT, DESIGN));
  const unnamed = rows(CHECKOUT, API).map(({ method }) => method).filter((method) => !dotted(method).test(block.text));
  if (unnamed.length) problems.push(`the Extension API block (${DESIGN}:${block.from} to ${block.to}) doesn't name ${unnamed.length} of the methods in ${API}: ${unnamed.join(', ')}`);
  // The plant: one more entry in the copy's extension-api.json, the last entry's shape under the planted name.
  const entries = rows(copy.repo, API);
  assert.ok(!entries.some(({ method }) => method === METHOD) && !dotted(METHOD).test(apiBlock(read(copy.repo, DESIGN)).text), `\`${METHOD}\` is already a method or already in the Extension API block, so planting it would prove nothing`);
  write(copy.repo, API, `${JSON.stringify([...entries, { ...entries.at(-1), method: METHOD }], null, 2)}\n`);
  const run = runLane(copy.repo, copy.issues);
  const planted = `a planted \`${METHOD}\` entry in ${API}`;
  problems.push(...unfailed(run, planted));
  if (run.status !== 0 && !namesDotted(run, METHOD)) problems.push(`on ${planted}, the lane failed without naming \`${METHOD}\`: ${shown(run)}`);
  if (problems.length) assert.fail(problems.join('\n\n'));
});
