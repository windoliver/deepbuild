// #523.93bf83d7: a flywheel launched at 22,800 deg/s on a hinge, 190° per 120 Hz step, writes fault speed_cap on its
// first step.
//
// The flywheel fixture (README: The fixtures) at 22,800 deg/s, with no outputs, baked for 0.1 s. Its occurrence list
// must hold a `fault` row whose fault kind is speed_cap at step 1 (README: Rows this suite reads). The twin
// `speed_cap_silent` caps as the backend does but writes no fault row, and must fail.
import { describe, it } from 'vitest';
import { CRITERIA, TIMEOUT, bakeSteps, caught, flywheel, isFault, none, physics, prebuild, rowText, rowsOf, stepAt, type JsonObject, type Planted } from './helpers.ts';

prebuild();

const ID = CRITERIA[2];
const STEPS = stepAt(0.1);
const bake = (planted?: Planted): JsonObject => physics([bakeSteps(flywheel(22_800, false), STEPS)], planted, 'the flywheel at 22,800 deg/s')[0]!;

/** A fault speed_cap at step 1. */
function faultFailures(reply: JsonObject): string[] {
  const rows = rowsOf(reply, 'the flywheel at 22,800 deg/s');
  if (rows.some((r) => r.step === 1 && isFault(r, 'speed_cap'))) return [];
  const faults = rows.filter((r) => r.kind === 'fault').map(rowText).join('; ') || 'none';
  return [`no fault speed_cap at step 1, the flywheel's first step, which would turn its hinge 190° (fault rows: ${faults})`];
}

describe(`${ID} a hinge that would turn 180° or more in a step writes fault speed_cap`, () => {
  it(`${ID} (fault) a flywheel launched at 22,800 deg/s on a hinge, 190° per 120 Hz step, writes fault speed_cap on its first step`, () => {
    none(faultFailures(bake()), 'the flywheel at 22,800 deg/s writes fault speed_cap on step 1');
  }, TIMEOUT);

  it(`${ID} (twin: speed_cap_silent) a planted backend that caps the flywheel but writes no fault fails`, () => {
    caught(faultFailures(bake('speed_cap_silent')), 'speed_cap_silent, judged on the flywheel at 22,800 deg/s');
  }, TIMEOUT);
});
