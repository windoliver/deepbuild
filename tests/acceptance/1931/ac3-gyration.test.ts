// Criterion 3: a 1 kg body under `magnetic {field: (0, 0, 3) T, charge: 2 C}`, started at the origin at (3, 0, 0) m/s,
// keeps its speed at 3 m/s within 0.1% at every step for 5 s, and its path stays between y = −1.000 m and 0 m: a
// circle of radius m·v ÷ (q·B) = 0.5 m within 1%, turning once every 2π·m ÷ (q·B) = 1.047 s. A planted law that holds
// q (v × B) over the step reaches 6.345 m/s at 5 s and y = −1.514 m and fails, naming the speed. A planted law that
// takes B × v turns the other way, between y = 0 m and +1.000 m, and fails, naming the side.
import { describe, expect, test } from 'vitest';
import {
  AC, GYRATION, GYRATION_RADIUS, GYRATION_STEPS, GYRATION_TURN, HELD_SPEED, HELD_Y, ION, ION_SPEED, PRINTED, SPEED_WITHIN, TIMEOUT, WITHIN,
  ask, bake, failFailures, gyrationFailures, gyrationOf, gyrationWorld, kitCall, mm3, numberOf, prebuild, rowOf, show, sideOf, signed, yOf,
  type Gyration, type KitResult,
} from './helpers.ts';

prebuild(['release']);
const HELD = 'magnetic_force_held';
const CROSSED = 'magnetic_b_cross_v';
const shown = (g: Gyration): string =>
  `speed farthest from 3 m/s ${g.speeds[g.worst]!.toFixed(5)} m/s (step ${g.worst}), ${g.speeds[GYRATION_STEPS]!.toFixed(5)} m/s at 5 s; y from ${g.y[0].toFixed(5)} to ${g.y[1].toFixed(5)} m, x from ${g.x[0].toFixed(5)} to ${g.x[1].toFixed(5)} m; radius ${g.radius.toFixed(5)} m, worked ${GYRATION_RADIUS} m; one turn every ${g.turn === null ? 'never' : `${g.turn.toFixed(5)} s`}, worked ${GYRATION_TURN.toFixed(3)} s`;

describe(`${AC[3]} a magnetic law turns a charged body's velocity about the field without changing its speed`, () => {
  test(`${AC[3]} the body keeps 3 m/s within 0.1% at every step for 5 s on a circle of radius 0.5 m within 1%, between y = −1.000 m and 0 m, turning once every 1.047 s`, () => {
    expect([GYRATION_RADIUS.toFixed(1), GYRATION_TURN.toFixed(3)], 'm·v ÷ (q·B) and 2π·m ÷ (q·B), as the issue prints them').toEqual(['0.5', '1.047']);
    const run = ask([bake(gyrationWorld(), GYRATION_STEPS, [ION])]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const read = gyrationOf(run.replies[0]!, ION, 'the gyration world');
    expect(typeof read === 'string' ? read : '', `${GYRATION}: the gyration world bakes, a state of its body after each of ${GYRATION_STEPS} steps`).toBe('');
    console.log(`${GYRATION}: ${shown(read as Gyration)}`);
    const failures = gyrationFailures(GYRATION, read as Gyration);
    expect(failures, `${GYRATION} baked 5 s:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[3]} a planted law that holds q (v × B) over the step (${HELD}) reaches 6.345 m/s at 5 s and y = −1.514 m and fails, naming the speed`, () => {
    const run = ask([bake(gyrationWorld(), GYRATION_STEPS, [ION]), kitCall()], { planted: HELD });
    expect(run.problem, `${run.what} answers: the planted law runs`).toBe('');
    const read = gyrationOf(run.replies[0]!, ION, `the gyration world under ${HELD}`);
    expect(typeof read === 'string' ? read : '', `${HELD} bakes the gyration world`).toBe('');
    const g = read as Gyration;
    console.log(`planted ${HELD}: ${shown(g)}`);
    // What the wrong law does, as the issue prints it: 6.345 m/s at 5 s, and a path that reaches down to y = −1.514 m.
    const last = g.speeds[GYRATION_STEPS]!;
    expect(Math.abs(last - HELD_SPEED) <= PRINTED, `${HELD} reaches ${HELD_SPEED} m/s at 5 s: its body's speed there is ${last} m/s`).toBe(true);
    expect(Math.abs(g.y[0] - HELD_Y) <= PRINTED, `${HELD} reaches y = ${signed(HELD_Y)} m: its body's lowest y is ${g.y[0]} m`).toBe(true);
    // The judge that passes the real law fails on it, naming the speed.
    const failures = gyrationFailures(GYRATION, g);
    expect(failures.length, `${HELD}: the planted law is caught (the judge finds nothing wrong with a body at ${mm3(last)} m/s)`).toBeGreaterThan(0);
    expect(failures.some((x) => x.includes(GYRATION) && x.includes(`its speed is ${HELD_SPEED.toFixed(3)} m/s`)), `a failure names ${GYRATION} and the speed, ${HELD_SPEED.toFixed(3)} m/s; failures:\n  ${failures.join('\n  ')}`).toBe(true);

    // The kit's own row fails, naming the speed: the one farthest from 3 m/s, the 6.345 m/s its body reaches.
    const row = rowOf(run.replies[1]!, GYRATION, `behavior_kit under ${HELD}`);
    expect(typeof row === 'string' ? row : '', `the kit's report under ${HELD} holds ${GYRATION} once`).toBe('');
    const r = row as KitResult;
    const kit = failFailures(r);
    const speed = numberOf(r, 'speed');
    if (speed === null || !(Math.abs(speed - HELD_SPEED) <= PRINTED)) kit.push(`${GYRATION}'s fail names the speed ${show(r.raw['speed'])}, not the ${HELD_SPEED} m/s its body reaches`);
    expect(kit, `${GYRATION}'s row under ${HELD}:\n  ${kit.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[3]} a planted law that takes B × v (${CROSSED}) turns the other way, between y = 0 m and +1.000 m, and fails, naming the side`, () => {
    const run = ask([bake(gyrationWorld(), GYRATION_STEPS, [ION]), kitCall()], { planted: CROSSED });
    expect(run.problem, `${run.what} answers: the planted law runs`).toBe('');
    const read = gyrationOf(run.replies[0]!, ION, `the gyration world under ${CROSSED}`);
    expect(typeof read === 'string' ? read : '', `${CROSSED} bakes the gyration world`).toBe('');
    const g = read as Gyration;
    console.log(`planted ${CROSSED}: ${shown(g)}`);
    // What the wrong law does, as the issue prints it: the same circle on the other side, from y = 0 m up to +1.000 m.
    expect(Math.abs(g.y[0]) <= PRINTED && Math.abs(g.y[1] - 1) <= PRINTED, `${CROSSED} turns the other way, between y = 0 m and +1.000 m: its body's path lies between y = ${g.y[0]} m and ${g.y[1]} m`).toBe(true);
    // The judge that passes the real law fails on it, naming the side, and for the side alone: its speed and its circle hold.
    const failures = gyrationFailures(GYRATION, g);
    expect(failures.length, `${CROSSED}: the planted law is caught (the judge finds nothing wrong with a path on ${sideOf(g.y)})`).toBeGreaterThan(0);
    expect(failures.every((x) => x.includes(GYRATION) && x.includes('the +y side')), `every failure names ${GYRATION} and the side, the +y side; failures:\n  ${failures.join('\n  ')}`).toBe(true);

    // The kit's own row fails, naming the side: its path's y from 0 m to +1.000 m, beside a radius and a speed that hold.
    const row = rowOf(run.replies[1]!, GYRATION, `behavior_kit under ${CROSSED}`);
    expect(typeof row === 'string' ? row : '', `the kit's report under ${CROSSED} holds ${GYRATION} once`).toBe('');
    const r = row as KitResult;
    const kit = failFailures(r);
    const y = yOf(r);
    if (!y || !(Math.abs(y[0]) <= PRINTED && Math.abs(y[1] - 1) <= PRINTED)) kit.push(`${GYRATION}'s fail names the side as y ${show(r.raw['y'])}, not the lowest and highest y of a path from 0 m to +1.000 m`);
    if (r.measured === null || !(Math.abs(r.measured - GYRATION_RADIUS) <= WITHIN * GYRATION_RADIUS)) kit.push(`${GYRATION}'s row reads a radius of ${show(r.measured)} m, not the ${GYRATION_RADIUS} m the mirrored circle keeps`);
    const speed = numberOf(r, 'speed');
    if (speed === null || !(Math.abs(speed - ION_SPEED) <= SPEED_WITHIN * ION_SPEED)) kit.push(`${GYRATION}'s row reads a speed of ${show(r.raw['speed'])} m/s, not the ${ION_SPEED} m/s the mirrored circle keeps`);
    expect(kit, `${GYRATION}'s row under ${CROSSED}:\n  ${kit.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
