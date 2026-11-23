// #1327 AC3: removing or changing a landed lane.json with no approval fails the guard, naming the file. Reached
// through the scene's own `node scripts/proof.mjs guard` (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { LANDED, guard, laneJson, scene, suiteFile } from './helpers.mjs';

const SUITE = `tests/acceptance/${LANDED}/suite.test.ts`;
const LANE = `tests/acceptance/${LANDED}/lane.json`;
const landed = { [SUITE]: suiteFile(LANDED), [LANE]: laneJson() };

function assertRefused(checked, how) {
  assert.notEqual(checked.status, 0, `the guard exits 0 when ${how} with no approval\n${checked.all}`);
  assert.ok(checked.stdout.split('\n').some((line) => /^FAIL\b/.test(line) && line.includes(LANE)), `no FAIL line names ${LANE} when ${how} with no approval\n${checked.all}`);
}

test('#1327.1272c2b3 changing a landed lane.json with no approval fails the guard, naming the file', (t) => {
  const box = scene(t, { base: landed, change: { [LANE]: laneJson({ why: 'Reworded: its tests share the machine one port.' }) }, issue: LANDED, subject: 'Reword the lane' });
  assertRefused(guard(box), `a commit changes ${LANE}`);
});

test('#1327.1272c2b3 removing a landed lane.json with no approval fails the guard, naming the file', (t) => {
  const box = scene(t, { base: landed, remove: [LANE], issue: LANDED, subject: 'Drop the lane' });
  assertRefused(guard(box), `a commit removes ${LANE}`);
});
