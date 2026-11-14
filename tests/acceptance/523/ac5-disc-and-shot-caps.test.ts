// #523.46a838d3: a disc launched at 7,200 deg/s on a hinge, 60° per 120 Hz step, writes fault speed_cap naming it on its
// first step and then turns at 5,400 deg/s, the backend's cap, which its joint_coordinate shows; a body launched at
// 500 m/s writes speed_cap and moves at 400 m/s.
//
// The disc fixture (README: The fixtures), baked for 1 s with its output `turn` (joint_coordinate) sampled once a step:
// a fault speed_cap naming `disc` at step 1, then joint_coordinate gaining 45° a step (5,400 deg/s) within 1% at every
// step from step 2, and over steps 1 to 120. The tolerance is 1%, as the issue gives none: Rapier turns a body by
// its linearized rotation, which at 45° a step falls about 0.3% short of 45°. The shot fixture, baked for 0.5 s with its
// body states: a fault speed_cap naming `shot`, then 400 m/s (0.1%) at every step, its position gaining 400 m/s
// too. The twin `speed_cap_silent` caps as the backend does but writes no fault row, and must fail both.
import { describe, it } from 'vitest';
import {
  ANGULAR_CAP, CRITERIA, LINEAR_CAP, RATE, TIMEOUT, bakeSteps, caught, disc, fmt, isFault, names, near, none, physics, prebuild,
  readingsOf, rowText, rowsOf, shot, speed, statesOf, stepAt, stepFailures, type JsonObject, type Planted,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[5];
const PER_STEP_TURN = ANGULAR_CAP / RATE;

function faultFailures(reply: JsonObject, body: string, what: string, step?: number): string[] {
  const rows = rowsOf(reply, what);
  if (rows.some((r) => isFault(r, 'speed_cap') && names(r, body) && (step === undefined || r.step === step))) return [];
  const faults = rows.filter((r) => r.kind === 'fault').map(rowText).join('; ') || 'none';
  return [`${what}: no fault speed_cap naming ${body}${step === undefined ? '' : ` at step ${step}`} (fault rows: ${faults})`];
}

/** The disc: speed_cap naming it on step 1, then 45° a step by its joint_coordinate. */
function discFailures(planted?: Planted): string[] {
  const steps = stepAt(1);
  const what = 'the disc at 7,200 deg/s';
  const [reply] = physics([bakeSteps(disc(), steps)], planted, what);
  const s = readingsOf(reply!, 'turn', steps + 1, what).map((x) => x.value);
  const rate = ((s[steps]! - s[1]!) * RATE) / (steps - 1);
  return [
    ...faultFailures(reply!, 'disc', what, 1),
    ...stepFailures(2, steps, (k) => near(s[k]! - s[k - 1]!, PER_STEP_TURN, 0.01), (k) => `step ${k} turns ${fmt(s[k]! - s[k - 1]!)}°`)
      .map((m) => `joint_coordinate doesn't turn ${PER_STEP_TURN}° a step (${ANGULAR_CAP} deg/s, 1%) at ${m}`),
    ...(near(rate, ANGULAR_CAP, 0.01) ? [] : [`joint_coordinate turns ${fmt(rate)} deg/s over steps 1 to ${steps}, not ${ANGULAR_CAP} deg/s within 1%`]),
  ];
}

/** The shot: speed_cap naming it, then 400 m/s by its states and its positions. */
function shotFailures(planted?: Planted): string[] {
  const steps = stepAt(0.5);
  const what = 'the shot at 500 m/s';
  const [reply] = physics([bakeSteps(shot(), steps, { read: ['shot'] })], planted, what);
  const states = statesOf(reply!, 'shot', steps + 1, what);
  const moved = ((states[steps]!.pos[0] - states[1]!.pos[0]) * RATE) / (steps - 1);
  return [
    ...faultFailures(reply!, 'shot', what),
    ...stepFailures(1, steps, (k) => near(speed(states[k]!.linear), LINEAR_CAP, 0.001), (k) => `step ${k} at ${fmt(speed(states[k]!.linear))} m/s`)
      .map((m) => `the shot doesn't move at ${LINEAR_CAP} m/s (0.1%) at ${m}`),
    ...(near(moved, LINEAR_CAP, 0.001) ? [] : [`the shot's position moves ${fmt(moved)} m/s over steps 1 to ${steps}, not ${LINEAR_CAP} m/s`]),
  ];
}

describe(`${ID} the backend's caps write fault speed_cap naming what they capped, and the readings show the capped motion`, () => {
  it(`${ID} (disc) a disc launched at 7,200 deg/s on a hinge writes fault speed_cap naming it on its first step, then turns at 5,400 deg/s, which its joint_coordinate shows`, () => {
    none(discFailures(), 'the disc is capped at 5,400 deg/s, and says so');
  }, TIMEOUT);

  it(`${ID} (shot) a body launched at 500 m/s writes speed_cap and moves at 400 m/s`, () => {
    none(shotFailures(), 'the shot is capped at 400 m/s, and says so');
  }, TIMEOUT);

  it(`${ID} (twin: speed_cap_silent) a planted backend that caps the disc and the shot but writes no fault fails both`, () => {
    caught(discFailures('speed_cap_silent'), 'speed_cap_silent, judged on the disc');
    caught(shotFailures('speed_cap_silent'), 'speed_cap_silent, judged on the shot');
  }, TIMEOUT);
});
