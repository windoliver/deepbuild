// #3035.2a1744e4: "Each joint swept from its lower to its upper limit keeps every anchor pair within 1 mm, as
// `physics.articulation_gap` requires, and a prismatic joint limited to 0.2 m travels 0.2 m"
//
// The fixture (README: The fixtures and their numbers) is fixtures/lift.urdf: `sled` on the prismatic `rail` along the
// file's +Z, limited 0 to 0.2 m, and `hand` on the revolute `wrist` about the file's +Y, limited ±1.5708 rad.
//
// The converted world is held three ways (README: Readings, the sweep):
// - its limits: `rail` a slider of 0 to 0.2 m, `wrist` a hinge of ±90.000° within 0.001°;
// - as `physics.articulation_gap` requires: every joint is written `articulated: true`, the only joints that rule
//   holds, and the base's check of the world as converted raises no error, so no pair is written 1 mm apart;
// - swept: each of the two joints is placed at 21 positions from its lower to its upper limit by the base's
//   kinematic solve, the other at 0 (helpers.ts `placing`). At every position each joint's two anchors, worked from
//   the two bodies' states in the bake and the joint's own frames, are within 1 mm; the swept joint's
//   `joint_coordinate` reads its lower limit at the first position and its upper limit at the last, so the sweep
//   really reaches both; and `sled` is 0.2 m up our +Y, the file's +Z, from where it was at the lower limit.
import { describe, expect, it } from 'vitest';
import {
  AC, LIFT_IDS, SWEEP, TIMEOUT, articulatedFailures, check, checkFailures, convert, fixture, liftLimitFailures, openHub, physics, placedOf, placing, prebuild, sweepFailures,
  sweepOf,
} from './helpers.ts';
import { LIFT, R0, TRAVEL, missingFrom, modelWorld, type JsonObject } from './model.ts';

prebuild(['shipped']);

const ID = AC[3];
const FILE = LIFT.file;
const SWEPT = [LIFT_IDS.rail, LIFT_IDS.wrist];

/** A world's check and its sweep on the base's runner, judged: its failures. */
function judged(world: JsonObject, what: string): string[] {
  const sweep = sweepOf(world);
  const run = physics([check(world), placing(world, sweep.placements)]);
  if (run.problem) return [run.problem];
  const refused = checkFailures(run.replies[0], what);
  const placed = placedOf(world, sweep.placements, run.replies[1], `${what}, swept`);
  return [...refused, ...(typeof placed === 'string' ? [placed] : sweepFailures(world, sweep, placed, SWEPT))];
}

describe(`${ID} each converted joint, swept between its limits, keeps its anchors together`, () => {
  it(`${ID} each joint swept from its lower to its upper limit keeps every anchor pair within 1 mm, as physics.articulation_gap requires, and a prismatic joint limited to 0.2 m travels 0.2 m`, async () => {
    expect(missingFrom(fixture(FILE), LIFT), `${FILE} holds the links, joints and numbers the model works from`).toEqual([]);

    // The measure, proved on a lift written by hand in our units: it passes that lift, and fails it with the rail's
    // upper limit written 0.1 m, naming the rail. None of this is the work's.
    const byHand = modelWorld(LIFT, R0);
    expect(sweepOf(byHand).placements.length, 'the sweep reads 21 positions of each of the two joints').toBe(2 * (SWEEP + 1));
    const control = judged(byHand, 'the lift written by hand');
    expect(control, `the measure reads the lift written by hand in our units:\n  ${control.join('\n  ')}`).toEqual([]);
    const short = modelWorld(LIFT, R0);
    ((short['joints'] as JsonObject)[LIFT_IDS.rail] as JsonObject)['limits'] = { min: 0, max: TRAVEL / 2 };
    const wrong = judged(short, 'the lift written by hand with its rail limited to 0.1 m');
    expect(wrong.some((f) => f.startsWith(`${LIFT_IDS.rail}: `) && f.includes('travels')), `the measure fails a rail that travels 0.1 m, naming it:\n  ${wrong.join('\n  ')}`).toBe(true);

    const c = await convert(await openHub(), FILE);
    expect(typeof c === 'string' ? c : '', `deep_job converts ${FILE} (import {from: urdf})`).toBe('');
    const world = (c as Exclude<typeof c, string>).world;
    const limits = liftLimitFailures(world);
    expect(limits, `the prismatic joint is a slider limited 0 to 0.2 m and the revolute one a hinge limited to ±90.000°:\n  ${limits.join('\n  ')}`).toEqual([]);
    const loose = articulatedFailures(world);
    expect(loose, `every converted joint is articulated, so physics.articulation_gap holds it:\n  ${loose.join('\n  ')}`).toEqual([]);
    const failures = judged(world, 'the converted lift');
    expect(failures, `the converted lift, checked as converted and swept by the base's kinematic solve:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
