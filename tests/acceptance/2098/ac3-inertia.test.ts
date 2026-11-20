// Criterion 3: a box given `inertia` twice its shape's spins up at half the angular acceleration under the same
// torque, within 1%. Its planted twin ignores the inertia.
//
// One world, two equal cubes far apart with no gravity, each on a hinge to the world through its centre whose
// velocity motor presses at `max_torque: 1` toward a speed neither comes near: `plain` writes no `inertia`, `doubled`
// writes twice the cube's own (README: The worlds). Each box's angular acceleration is its turn rate about the hinge
// after 1 s, over that second.
import { describe, expect, test } from 'vitest';
import {
  AC, DOUBLED, INERTIA_IGNORED, PLAIN, SPIN_STEPS, TIMEOUT, WITHIN, ask, bake, prebuild, spinFailures, spinUpOf, spinWorld, type SpinUp,
} from './helpers.ts';

prebuild(['release']);
const WORLD = 'the two cubes under the same torque';
const shown = (s: SpinUp): string => `${PLAIN} spins up at ${s.plain.toFixed(4)} deg/s², ${DOUBLED} at ${s.doubled.toFixed(4)} deg/s², ${(s.doubled / s.plain).toFixed(4)} of it`;

describe(`${AC[3]} a box given inertia twice its shape's spins up at half the angular acceleration under the same torque`, () => {
  test(`${AC[3]} the box given inertia twice its shape's spins up at half the angular acceleration of the same box without it, under the same torque, within 1%`, () => {
    const run = ask([bake(spinWorld(), SPIN_STEPS, [PLAIN, DOUBLED])]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const read = spinUpOf(run.replies[0]!, WORLD);
    expect(typeof read === 'string' ? read : '', `${WORLD} bake: each box's state after each of ${SPIN_STEPS} steps`).toBe('');
    console.log(`${WORLD}: ${shown(read as SpinUp)}`);
    const failures = spinFailures(read as SpinUp);
    expect(failures, `${WORLD}, baked 1 s from rest:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[3]} a planted program that ignores a body's inertia (${INERTIA_IGNORED}) is caught: the box spins up as fast as the one without it, and the failure names the box`, () => {
    const run = ask([bake(spinWorld(), SPIN_STEPS, [PLAIN, DOUBLED])], INERTIA_IGNORED);
    expect(run.problem, `${run.what} answers: the planted program runs`).toBe('');
    const read = spinUpOf(run.replies[0]!, `${WORLD} under ${INERTIA_IGNORED}`);
    expect(typeof read === 'string' ? read : '', `${INERTIA_IGNORED} ignores the inertia alone: it takes the world and bakes it`).toBe('');
    const s = read as SpinUp;
    console.log(`planted ${INERTIA_IGNORED}: ${shown(s)}`);
    expect(s.plain > 0 && Math.abs(s.doubled / s.plain - 1) <= WITHIN, `${INERTIA_IGNORED} spins ${DOUBLED} up as it spins ${PLAIN} up, within 1%: ${shown(s)}`).toBe(true);
    const failures = spinFailures(s);
    expect(failures.length, `${INERTIA_IGNORED}: the planted program is caught (the judge finds nothing wrong with an inertia ignored)`).toBeGreaterThan(0);
    expect(failures.some((f) => f.startsWith(`${DOUBLED}: `) && f.includes('not half of it within 1%')), `a failure names ${DOUBLED} and the half it missed; failures:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
