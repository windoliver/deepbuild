// #523.c74d0c1b: in kinematic mode, a gear of ratio 2 between two hinges, the first driven at 90°/s, turns the second by
// twice the first's angle within 0.1° at 2 s; a pulley of ratio 1 keeps its two lengths' sum within 1e-5 m; and a
// two-link arm of 1 m links whose tip a driver moves outward from 1 m at 0.5 m/s writes a jam at 2 s within one step,
// naming the joint; a planted solve that stops at its iteration cap and reports success fails, naming the step.
//
// Criterion 6's scene (README: The fixtures) holds three kinematic worlds, each baked in the scene (#1918's form) with
// its readings sampled once a step:
// - gears, 2 s: `turn_in` reads 180° (90°/s for 2 s) within 0.1°, and `turn_out` twice that, 360° (turning either
//   way, as the issue fixes the ratio, not the sense), within 0.1°.
// - pulley, 2 s: at every step, the left weight's distance from (−1, 2, 0) plus the right's from (1, 2, 0) is 4 m within
//   1e-5 m, while the left one follows its driver down to −0.5 m.
// - arm, 2.2 s: the first jam row (README: Rows this suite reads) is at step 239, 240 or 241 and names one of the arm's
//   joints. The twin `solve_cap_reports_success` must fail it, the failure naming step 240.
import { describe, expect, it } from 'vitest';
import {
  ARM_JOINTS, CRITERIA, GROUND_A, GROUND_B, ROPE, TIMEOUT, bakeScene, caught, fmt, isJam, machines, names, none, physics,
  positionsOf, prebuild, readingsOf, rowText, rowsOf, stepAt, stepFailures, type Planted,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[6];
const AT = stepAt(2);
const distance = (p: number[], q: number[]): number => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);

/** The arm's first jam: within one step of 2 s, naming one of its joints. */
function jamFailures(planted?: Planted): string[] {
  const steps = stepAt(2.2);
  const what = 'the two-link arm';
  const [reply] = physics([bakeScene(machines(), 'arm', steps)], planted, what);
  const rows = rowsOf(reply!, what);
  const jam = rows.find(isJam);
  if (!jam) return [`no jam in ${steps} steps, none within one step of step ${AT} (2 s), where the arm is straight and its tip's driver moves on: the solve reported success (rows: ${rows.slice(0, 8).map(rowText).join('; ') || 'none'})`];
  const f: string[] = [];
  if (Math.abs(jam.step - AT) > 1) f.push(`the first jam is at step ${jam.step}, not within one step of step ${AT} (2 s): ${rowText(jam)}`);
  if (!ARM_JOINTS.some((j) => names(jam, j))) f.push(`the jam at step ${jam.step} names none of the arm's joints (${ARM_JOINTS.join(', ')}): ${rowText(jam)}`);
  return f;
}

describe(`${ID} the kinematic solve: gears, pulleys and a jam it never reports as success`, () => {
  it(`${ID} (gear) a gear of ratio 2 between two hinges, the first driven at 90°/s, turns the second by twice the first's angle within 0.1° at 2 s`, () => {
    const what = 'the gears';
    const [reply] = physics([bakeScene(machines(), 'gears', AT)], undefined, what);
    const first = readingsOf(reply!, 'turn_in', AT + 1, what)[AT]!.value;
    const second = readingsOf(reply!, 'turn_out', AT + 1, what)[AT]!.value;
    const off = Math.min(Math.abs(second - 2 * first), Math.abs(second + 2 * first));
    none([
      ...(Math.abs(first - 180) <= 0.1 ? [] : [`the driven hinge reads ${fmt(first)}° at 2 s, not 180° (90°/s) within 0.1°`]),
      ...(off <= 0.1 ? [] : [`the second hinge reads ${fmt(second)}° at 2 s, not twice the first's ${fmt(first)}° within 0.1° (off by ${fmt(off)}°)`]),
    ], 'the gear turns the second hinge twice the first\'s angle');
  }, TIMEOUT);

  it(`${ID} (pulley) a pulley of ratio 1 keeps its two lengths' sum within 1e-5 m while its driver lowers one side`, () => {
    const what = 'the pulley';
    const [reply] = physics([bakeScene(machines(), 'pulley', AT)], undefined, what);
    const left = positionsOf(reply!, 'left_at', AT + 1, what);
    const right = positionsOf(reply!, 'right_at', AT + 1, what);
    const sum = (k: number): number => distance(left[k]!, GROUND_A) + distance(right[k]!, GROUND_B);
    none([
      ...(Math.abs(left[AT]![1]! + 0.5) <= 1e-4 ? [] : [`the left weight is at y = ${fmt(left[AT]![1]!)} m at 2 s, not its driver's −0.5 m`]),
      ...stepFailures(0, AT, (k) => Math.abs(sum(k) - ROPE) <= 1e-5, (k) => `step ${k}: ${fmt(sum(k))} m`).map((m) => `the two lengths don't sum to ${ROPE} m within 1e-5 m at ${m}`),
    ], 'the pulley keeps its rope\'s length');
  }, TIMEOUT);

  it(`${ID} (jam) a two-link arm of 1 m links whose tip a driver moves outward from 1 m at 0.5 m/s writes a jam at 2 s within one step, naming the joint`, () => {
    none(jamFailures(), 'the arm jams when it can reach no further');
  }, TIMEOUT);

  it(`${ID} (twin: solve_cap_reports_success) a planted solve that stops at its iteration cap and reports success fails, naming the step`, () => {
    const f = jamFailures('solve_cap_reports_success');
    caught(f, 'solve_cap_reports_success, judged on the arm');
    expect(f.join('\n'), 'the failure names the step the arm jams at').toContain(`step ${AT}`);
  }, TIMEOUT);
});
