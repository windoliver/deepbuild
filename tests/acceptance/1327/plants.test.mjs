// #1327 AC2: planted lane.json files that ask for a skip, for by-hand and for a timed grant are each refused, naming
// the file; a planted one in another issue's folder is refused the same way. A plant counts as refused when the scene's
// guard (`node scripts/proof.mjs guard`) or the lanes it reads (scripts/lanes.mjs and affected.mjs, loaded by
// lanes-view.mjs) exit non-zero with output naming the lane.json's path (README).
import assert from 'node:assert/strict';
import test from 'node:test';
import { OTHER, OWN, guard, laneJson, lanesView, scene, suiteFile } from './helpers.mjs';

const SUITE = `tests/acceptance/${OWN}/suite.test.ts`;
const LANE = `tests/acceptance/${OWN}/lane.json`;

function refusal(box, lane, files) {
  const checked = guard(box), lanes = lanesView(box, files);
  const byGuard = checked.status !== 0 && `${checked.stdout}\n${checked.stderr}`.includes(lane);
  const byLanes = lanes.status !== 0 && `${lanes.stdout}\n${lanes.stderr}`.includes(lane);
  return { refused: byGuard || byLanes, lanes, all: `guard: ${checked.all}\nlanes: ${lanes.all}` };
}

for (const [what, field] of [['a skip', { skip: true }], ['by-hand', { byHand: true }], ['a timed grant', { timed: true }]]) {
  test(`#1327.57d2718c a planted lane.json that asks for ${what} (${JSON.stringify(field)}) is refused, naming the file`, (t) => {
    const box = scene(t, { change: { [SUITE]: suiteFile(OWN), [LANE]: laneJson(field) } });
    const { refused, lanes, all } = refusal(box, LANE, [SUITE]);
    assert.ok(refused, `neither the guard nor the lanes refuse ${LANE}, naming it, when it asks for ${what}\n${all}`);
    // Refused, it grants nothing: the lanes that still read leave the suite neither skipped nor timed.
    if (lanes.view) assert.doesNotMatch(lanes.view[SUITE].block ?? '', /^(?:skipped|timed)\//, `the lanes grant what ${LANE} asks\n${JSON.stringify(lanes.view, null, 2)}`);
  });
}

test("#1327.57d2718c a planted lane.json in another issue's folder is refused the same way, naming the file", (t) => {
  const otherSuite = `tests/acceptance/${OTHER}/suite.test.ts`, otherLane = `tests/acceptance/${OTHER}/lane.json`;
  // #9328's suite landed on main; the change, Part of #9327, adds its own suite and a lane.json in #9328's folder.
  const box = scene(t, { base: { [otherSuite]: suiteFile(OTHER) }, change: { [SUITE]: suiteFile(OWN), [otherLane]: laneJson() } });
  const { refused, all } = refusal(box, otherLane, [SUITE, otherSuite]);
  assert.ok(refused, `neither the guard nor the lanes refuse ${otherLane}, a lane.json a change Part of #${OWN} plants in #${OTHER}'s folder, naming it\n${all}`);
});
