import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { FIXTURE, OWN, affected, blocksOf, importingTestFile, laneJson, listBlocks, scene } from './helpers.mjs';

const FOLDER = `tests/acceptance/${OWN}/`;
const TIMED = `${FOLDER}budgets.test.mjs`, SLOW = `${FOLDER}build.test.mjs`, PLAIN = `${FOLDER}plain.test.mjs`;

test('#3419.e45cd630 a lane file naming one file timed and one slow: affected.mjs --list lists each in its block, and a run without --timed or --slow reads INCONCLUSIVE naming both, never PASS', (t) => {
  const box = scene(t, { commits: [{ files: {
    [`${FOLDER}fixture.mjs`]: FIXTURE, [PLAIN]: importingTestFile(), [TIMED]: importingTestFile(), [SLOW]: importingTestFile(),
    [`${FOLDER}lane.json`]: laneJson({ timed: ['budgets.test.mjs'], slow: ['build.test.mjs'] }),
  } }] });

  const listed = affected(box, ['--list', `${FOLDER}fixture.mjs`]);
  assert.equal(listed.status, 0, `affected.mjs --list did not run\n${listed.all}`);
  const blocks = listBlocks(listed.stdout);
  assert.deepEqual(blocksOf(blocks, TIMED), ['timed node'], `affected.mjs --list does not list ${TIMED} in the timed block, and only there\n${listed.all}`);
  assert.deepEqual(blocksOf(blocks, SLOW), ['slow node'], `affected.mjs --list does not list ${SLOW} in the slow block, and only there\n${listed.all}`);
  assert.deepEqual(blocksOf(blocks, PLAIN), ['alone node'], `affected.mjs --list does not list the folder's other file in the alone block\n${listed.all}`);

  const results = join(box.dir, 'results.json');
  const run = affected(box, [`--results=${results}`, `${FOLDER}fixture.mjs`]);
  const lines = run.stdout.split('\n');
  for (const file of [TIMED, SLOW]) assert.ok(lines.some((line) => line.startsWith('INCONCLUSIVE ') && line.includes(file)), `no INCONCLUSIVE line of the run without --timed or --slow names ${file}\n${run.all}`);
  const summary = lines.find((line) => / affected: /.test(line)) ?? '';
  assert.doesNotMatch(summary, /^(?:PASS|NO NEW FAILURES) /, `the run without --timed or --slow reads ${summary}\n${run.all}`);
  assert.notEqual(run.status, 0, `the run without --timed or --slow exits 0\n${run.all}`);
  let states = {};
  try { states = Object.fromEntries(JSON.parse(readFileSync(results, 'utf8')).files.map(({ file, state }) => [file, state])); } catch {}
  assert.equal(states[PLAIN], 'PASS', `the run did not run the folder's other file and read it PASS, so it proves nothing about the two\n${run.all}\nresults: ${JSON.stringify(states)}`);
  for (const file of [TIMED, SLOW]) assert.notEqual(states[file], 'PASS', `the run without --timed or --slow reads ${file} PASS\n${run.all}`);
});
