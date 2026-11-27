// #3419 criterion 4 (#3419.965359ca): a lane file whose timed list is out of shape still runs its folder alone, and no
// file of the folder leaves a plain run. Reached through the scene's own `node scripts/affected.mjs --list`: every file
// of the folder must be listed in the alone block and in no other (not timed, slow, skipped or parallel). The failure
// message names each file that left. This passes on the base, which reads no timed list at all (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { OWN, affected, blocksOf, laneJson, listBlocks, scene, testFile } from './helpers.mjs';

const FOLDER = `tests/acceptance/${OWN}/`;
const FILES = [`${FOLDER}budgets.test.mjs`, `${FOLDER}plain.test.mjs`];

// Out of shape: a name where a list of names belongs, and a list holding a number beside a name.
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
