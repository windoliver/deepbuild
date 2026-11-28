import assert from 'node:assert/strict';
import test from 'node:test';
import { OTHER, OWN, affected, blocksOf, failLines, guard, laneJson, listBlocks, scene, testFile } from './acceptance/3419/helpers.mjs';

const OWN_FOLDER = `tests/acceptance/${OWN}-ac1-70212996/`;
const OTHER_FOLDER = `tests/acceptance/${OTHER}-ac1/`;

test('a new <issue>-<suffix>/ suite with a lane file runs alone and passes the guard with no tag; one in another issue\'s folder is refused, naming it', (t) => {
  const box = scene(t, { commits: [{ files: { [`${OWN_FOLDER}suite.test.mjs`]: testFile(), [`${OWN_FOLDER}lane.json`]: laneJson() } }] });
  const checked = guard(box);
  assert.deepEqual(failLines(checked.stdout), [], checked.all);
  assert.equal(checked.status, 0, checked.all);
  const listed = affected(box, ['--list']);
  assert.equal(listed.status, 0, listed.all);
  assert.deepEqual(blocksOf(listBlocks(listed.stdout), `${OWN_FOLDER}suite.test.mjs`), ['alone node'], listed.all);

  const planted = scene(t, { commits: [{ files: { [`${OTHER_FOLDER}suite.test.mjs`]: testFile(), [`${OTHER_FOLDER}lane.json`]: laneJson() } }] });
  const refused = guard(planted);
  assert.notEqual(refused.status, 0, refused.all);
  assert.ok(failLines(refused.stdout).some((line) => line.includes(`${OTHER_FOLDER}lane.json`)), refused.all);
});
