import assert from 'node:assert/strict';
import test from 'node:test';
import { OWN, affected, blocksOf, laneJson, listBlocks, scene, testFile } from './helpers.mjs';

const FOLDER = `tests/acceptance/${OWN}/`;
const FILES = [`${FOLDER}budgets.test.mjs`, `${FOLDER}plain.test.mjs`];

for (const [what, timed] of [['a string, not a list', 'budgets.test.mjs'], ['a list holding a number beside a name', ['budgets.test.mjs', 7]]]) {
  test(`#3419.965359ca a lane file whose timed list is out of shape (${what}) still runs its folder alone, and no file of the folder leaves a plain run`, (t) => {
    const box = scene(t, { commits: [{ files: { ...Object.fromEntries(FILES.map((file) => [file, testFile()])), [`${FOLDER}lane.json`]: laneJson({ timed }) } }] });
    const listed = affected(box, ['--list']);
    assert.equal(listed.status, 0, `affected.mjs --list did not run\n${listed.all}`);
    const blocks = listBlocks(listed.stdout);
    const left = FILES.filter((file) => JSON.stringify(blocksOf(blocks, file)) !== JSON.stringify(['alone node'])).map((file) => `${file} (listed in: ${blocksOf(blocks, file).join(', ') || 'none'})`);
    assert.deepEqual(left, [], `with "timed": ${JSON.stringify(timed)}, files of the folder left its plain alone run: ${left.join('; ')}\n${listed.all}`);
  });
}
