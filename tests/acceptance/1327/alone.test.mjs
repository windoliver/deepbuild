// #1327 AC1: a new suite with a lane.json runs alone, and the guard passes with no tag on its commit.
// Reached through the scene's own `node scripts/proof.mjs guard`, affected.mjs's plan() and the unit lane's commands
// (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { OWN, failLines, guard, laneJson, lanesView, scene, suiteFile } from './helpers.mjs';

const SUITE = `tests/acceptance/${OWN}/suite.test.ts`;
const LANE = `tests/acceptance/${OWN}/lane.json`;
// A suite already on main, with no lane.json: it stays in the parallel block, so alone comes from the lane.json.
const PLAIN = 'tests/acceptance/9331/suite.test.ts';

test('#1327.73a69977 a new suite whose folder holds a lane.json runs in the alone block (affected.mjs and the unit lane), and the guard passes its commit with no approval tag', (t) => {
  const box = scene(t, { base: { [PLAIN]: suiteFile(9331) }, change: { [SUITE]: suiteFile(OWN), [LANE]: laneJson() } });

  const checked = guard(box);
  assert.deepEqual(failLines(checked.stdout), [], `the guard refuses the new suite's commit\n${checked.all}`);
  assert.equal(checked.status, 0, `the guard exits non-zero on the new suite's commit\n${checked.all}`);
  assert.match(checked.stdout, /^PASS guard: /m, `the guard prints no PASS line\n${checked.all}`);

  const lanes = lanesView(box, [SUITE, PLAIN]);
  assert.equal(lanes.status, 0, `the lanes could not be read\n${lanes.all}`);
  assert.equal(lanes.view[PLAIN].block, 'parallel/vitest', `a suite with no lane.json is not in the parallel block\n${JSON.stringify(lanes.view, null, 2)}`);
  assert.equal(lanes.view[SUITE].block, 'alone/vitest', `affected.mjs does not put the suite with a lane.json in the alone block\n${JSON.stringify(lanes.view, null, 2)}`);
  assert.equal(lanes.view[SUITE].unit, 'alone', `the unit lane does not run the suite with a lane.json in its alone command, and only there\n${JSON.stringify(lanes.view, null, 2)}`);
});
