// #523.188f7266: a 2 kg body hanging still from a fixed joint reads joint_force 19.62 N within 1% with substeps 1, 4
// and 8, and the same joint with breaks_at force 15 N breaks within over_steps steps at each.
//
// The hanging-body fixture (README: The fixtures) at each substep count, baked for 1 s: joint_force's force at every
// step from 0.25 s on is m·g = 19.62 N within 1%; with breaks_at {force: 15, over_steps: 6} it breaks once, naming the
// hook, at step 6 (or 7, as the next step starts). The twin `joint_force_per_step` divides the last substep's impulse
// by the step's length instead of the substep's, so it reads 19.62 ÷ substeps, and must fail both.
import { describe, it } from 'vitest';
import {
  BOB_WEIGHT, CRITERIA, OVER_STEPS, TIMEOUT, bakeSteps, caught, fmt, hanging, isBreak, names, near, none, physics, prebuild, readingsOf,
  rowText, rowsOf, stepAt, stepFailures, type Planted,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[4];
const SUBSTEPS = [1, 4, 8];
const STEPS = stepAt(1);

/** joint_force reads m·g within 1% at every step from 0.25 s on, at each substep count. */
function readingFailures(planted?: Planted): string[] {
  const replies = physics(SUBSTEPS.map((n) => bakeSteps(hanging(n, false), STEPS)), planted, 'the hanging body');
  return SUBSTEPS.flatMap((n, i) => {
    const s = readingsOf(replies[i]!, 'load', STEPS + 1, `the hanging body at substeps ${n}`);
    return stepFailures(stepAt(0.25), STEPS, (k) => near(s[k]!.value, BOB_WEIGHT, 0.01), (k) => `step ${k} reads ${fmt(s[k]!.value)} N`)
      .map((m) => `substeps ${n}: joint_force isn't ${fmt(BOB_WEIGHT)} N within 1% at ${m}`);
  });
}

/** With breaks_at force 15 N, one break naming the hook at step over_steps (or the next), at each substep count. */
function breakFailures(planted?: Planted): string[] {
  const replies = physics(SUBSTEPS.map((n) => bakeSteps(hanging(n, true), STEPS)), planted, 'the hanging body with breaks_at');
  return SUBSTEPS.flatMap((n, i) => {
    const breaks = rowsOf(replies[i]!, `the hanging body with breaks_at at substeps ${n}`).filter(isBreak);
    const all = breaks.map(rowText).join('; ') || 'none';
    const b = breaks[0];
    if (breaks.length !== 1 || !b) return [`substeps ${n}: ${breaks.length} break occurrences in 1 s, not one (${all})`];
    const f: string[] = [];
    if (!names(b, 'hook')) f.push(`substeps ${n}: the break doesn't name the joint hook: ${rowText(b)}`);
    if (b.step < OVER_STEPS || b.step > OVER_STEPS + 1) f.push(`substeps ${n}: the break is at step ${b.step}, not within over_steps (${OVER_STEPS}) steps: ${rowText(b)}`);
    return f;
  });
}

describe(`${ID} a hanging body's joint force is its weight at any substep count, and breaks_at reads it`, () => {
  it(`${ID} (reading) a 2 kg body hanging still from a fixed joint reads joint_force 19.62 N within 1% with substeps 1, 4 and 8`, () => {
    none(readingFailures(), 'joint_force is the hanging body\'s weight');
  }, TIMEOUT);

  it(`${ID} (break) the same joint with breaks_at force 15 N breaks within over_steps steps with substeps 1, 4 and 8`, () => {
    none(breakFailures(), 'breaks_at force 15 N breaks the hook');
  }, TIMEOUT);

  it(`${ID} (twin: joint_force_per_step) a planted force that divides by the step's length, not the substep's, fails the reading and the break`, () => {
    caught(readingFailures('joint_force_per_step'), 'joint_force_per_step, judged on the reading');
    caught(breakFailures('joint_force_per_step'), 'joint_force_per_step, judged on the break');
  }, TIMEOUT);
});
