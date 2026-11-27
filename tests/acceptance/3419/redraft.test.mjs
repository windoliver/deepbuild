import assert from 'node:assert/strict';
import test from 'node:test';
import { OWN, affected, blocksOf, failLines, guard, laneJson, listBlocks, scene, testFile } from './helpers.mjs';

const LANDED = { [`tests/acceptance/${OWN}/suite.test.mjs`]: testFile() };
const NEW = `tests/acceptance/${OWN}-redraft-ac1/`;
const PLAIN = `tests/acceptance/${OWN}-redraft-ac3/`;
const OLD = `tests/acceptance/${OWN}-redraft-ac2/`;

test('#3419.b70aa6a5 a new redraft folder with a lane file runs alone and passes the guard with no approval tag; the same lane file in a redraft folder that held a file at the merge base is refused, naming the folder', (t) => {
  const box = scene(t, { base: LANDED, commits: [{ files: { [`${NEW}redraft.test.mjs`]: testFile(), [`${NEW}lane.json`]: laneJson(), [`${PLAIN}redraft.test.mjs`]: testFile() } }] });

  const checked = guard(box);
  assert.deepEqual(failLines(checked.stdout), [], `the guard refuses a new redraft folder's lane file, committed with no approval tag\n${checked.all}`);
  assert.equal(checked.status, 0, `the guard exits non-zero on a new redraft folder's lane file\n${checked.all}`);
  assert.match(checked.stdout, /^PASS guard: /m, `the guard prints no PASS line\n${checked.all}`);

  const listed = affected(box, ['--list']);
  assert.equal(listed.status, 0, `affected.mjs --list did not run\n${listed.all}`);
  const blocks = listBlocks(listed.stdout);
  assert.deepEqual(blocksOf(blocks, `${PLAIN}redraft.test.mjs`), ['parallel node'], `a redraft folder with no lane file is not in the parallel block alone\n${listed.all}`);
  assert.deepEqual(blocksOf(blocks, `${NEW}redraft.test.mjs`), ['alone node'], `the new redraft folder with a lane file does not run in the alone block, and only there\n${listed.all}`);

  const landed = scene(t, { base: { ...LANDED, [`${OLD}redraft.test.mjs`]: testFile() }, commits: [{ files: { [`${OLD}lane.json`]: laneJson() } }] });
  const refused = guard(landed);
  assert.notEqual(refused.status, 0, `the guard passes a lane file added to ${OLD}, whose file landed before it\n${refused.all}`);
  assert.ok(failLines(refused.stdout).some((line) => line.includes(OLD)), `no FAIL line of the guard names ${OLD}\n${refused.all}`);
});
