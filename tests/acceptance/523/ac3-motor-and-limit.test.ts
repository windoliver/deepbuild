// #523.959eb1ca: a hinge with breaks_at torque 20 N·m holds while its velocity motor presses its arm against a wall at
// max_torque 50 N·m for 2 s, and breaks with one break occurrence once its arm's weight, 50 N·m about its axis, rests on
// its limit for over_steps steps; joint_force reads only the lock and limit impulses in both.
//
// Two worlds with the same arm and hinge (README: The fixtures; breaks_at {torque: 20, over_steps: 6}):
// - held: no gravity; the motor presses the arm up against a ball 0.8 m out, so the wall pushes back 62.5 N there and the
//   pin holds 62.5 N, while the limit (±90°) is far away: joint_force's force is the pin's 62.5 N (5%) and its torque,
//   with no limit engaged and the motor's 50 N·m left out, is under 5% of 50 N·m; no break in 2 s.
// - broken: gravity, no motor, the arm level on its lower limit (0°): the limit holds 50 N·m about the axis, so the joint
//   breaks once, at step 6 or 7 (the 6th step past 20 N·m, or the start of the next), its break row and joint_force's
//   torque on the steps before it reading past 20 N·m: the limit's impulse counts.
// joint_force's samples here must carry the torque (README: Readings): a hinge's limit is a torque about its axis.
import { describe, it } from 'vitest';
import {
  ARM_TORQUE, BREAK_TORQUE, CRITERIA, OVER_STEPS, PIN_FORCE, TIMEOUT, bakeSteps, fmt, isBreak, names, near, none, physics, prebuild,
  pressedArm, readingsOf, restingArm, rowText, rowsOf, stepAt, stepFailures, type Sample,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[3];
const torqueOf = (s: Sample): number => s.torque ?? Number.NaN;

describe(`${ID} a joint's force, joint_force and breaks_at count its locks and limits, never its motor`, () => {
  it(`${ID} (held) the hinge holds for 2 s while its velocity motor presses its arm against a wall at max_torque 50 N·m; joint_force reads the pin's 62.5 N and no motor torque`, () => {
    const steps = stepAt(2);
    const [reply] = physics([bakeSteps(pressedArm(), steps)], undefined, 'the pressed arm');
    const what = 'the pressed arm';
    const s = readingsOf(reply!, 'load', steps + 1, what);
    const from = stepAt(1);
    none([
      ...rowsOf(reply!, what).filter(isBreak).map((r) => `the hinge broke while the motor pressed: ${rowText(r)}`),
      ...stepFailures(from, steps, (k) => near(s[k]!.value, PIN_FORCE, 0.05), (k) => `step ${k} reads ${fmt(s[k]!.value)} N`)
        .map((m) => `joint_force's force isn't the pin's ${PIN_FORCE} N (5%) at ${m}`),
      ...stepFailures(from, steps, (k) => Math.abs(torqueOf(s[k]!)) <= 0.05 * ARM_TORQUE, (k) => `step ${k} reads ${fmt(torqueOf(s[k]!))} N·m`)
        .map((m) => `joint_force's torque isn't under ${0.05 * ARM_TORQUE} N·m (no limit engaged, the motor's ${ARM_TORQUE} N·m left out) at ${m}`),
    ], 'the motor\'s impulse is in neither joint_force nor breaks_at');
  }, TIMEOUT);

  it(`${ID} (broken) the arm's weight, 50 N·m about the hinge, resting on its limit breaks it after over_steps steps with one break occurrence; the break and joint_force read the limit's torque past 20 N·m`, () => {
    const steps = stepAt(1);
    const what = 'the arm on its limit';
    const [reply] = physics([bakeSteps(restingArm(), steps)], undefined, what);
    const s = readingsOf(reply!, 'load', steps + 1, what);
    const breaks = rowsOf(reply!, what).filter(isBreak);
    const f: string[] = [];
    if (breaks.length !== 1) f.push(`${breaks.length} break occurrences in 1 s, not one: ${breaks.map(rowText).join('; ') || 'none'}`);
    const b = breaks[0];
    if (b) {
      if (!names(b, 'elbow')) f.push(`the break doesn't name the hinge elbow: ${rowText(b)}`);
      if (b.step < OVER_STEPS || b.step > OVER_STEPS + 1) f.push(`the break is at step ${b.step}, not after ${OVER_STEPS} steps on the limit (step ${OVER_STEPS}, or ${OVER_STEPS + 1} as the next step starts): ${rowText(b)}`);
      const t = b.raw['torque'];
      if (!(typeof t === 'number' && t > BREAK_TORQUE)) f.push(`the break's torque is ${String(t)}, not past breaks_at's ${BREAK_TORQUE} N·m: ${rowText(b)}`);
      const first = Math.max(1, b.step - OVER_STEPS + 1);
      f.push(...stepFailures(first, b.step - 1, (k) => torqueOf(s[k]!) > BREAK_TORQUE, (k) => `step ${k} reads ${fmt(torqueOf(s[k]!))} N·m`)
        .map((m) => `joint_force's torque before the break isn't past ${BREAK_TORQUE} N·m (the limit's impulse) at ${m}`));
    }
    none(f, 'the limit\'s impulse counts in breaks_at and joint_force');
  }, TIMEOUT);
});
