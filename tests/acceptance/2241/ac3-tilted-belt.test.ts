// Criterion 3: on the belt tilted 10° up along its +X, the box reaches 1 m/s up the slope at
// 1 ÷ (g × (0.5 cos 10° − sin 10°)) = 0.320 s within 2 steps and then holds that speed within 1%. A planted wrapper
// that takes the speed along level ground instead of in the contact's plane holds the box at cos 10° of it, 0.985 m/s,
// and fails the 1% bound, naming the fixture.
import { describe, expect, test } from 'vitest';
import {
  ALONG_LEVEL, AC, PRINTED, RATE, REACH_TILTED, REFERENCE, SPEED, STEPS, TILTED, TIMEOUT, UP_SLOPE, WITHIN, ask, bake, carried, dataFailures,
  failFailures, fixtureNamed, holdFailures, kitCall, passFailures, prebuild, reachFailures, rowOf, show, tiltedBelt,
  type Carried, type Fixture, type KitResult,
} from './helpers.ts';

prebuild(['release']);
const AXIS = 'up the slope';
const PLANTED = 'belt_speed_along_level_ground';

/** Everything wrong with the tilted belt's bake: the time its box reaches the belt's speed up the slope, and that it holds it to 2 s. */
const judge = (c: Carried): string[] => [...reachFailures(TILTED, c, AXIS, REACH_TILTED), ...holdFailures(TILTED, c, AXIS)];
const shown = (c: Carried): string =>
  `reaches 1 m/s ${AXIS} at ${c.reached === null ? 'no step' : `step ${c.reached} (${(c.reached / RATE).toFixed(3)} s)`}, worked ${REACH_TILTED.toFixed(3)} s; ${c.speeds[STEPS]!.toFixed(4)} m/s at 2 s`;

describe(`${AC[3]} a belt tilted 10° up along its +X carries the box up the slope at its speed, taken in the contact's plane`, () => {
  test(`${AC[3]} the box reaches 1 m/s up the slope at 0.320 s within 2 steps and then holds that speed within 1%`, () => {
    expect([REACH_TILTED.toFixed(3), ALONG_LEVEL.toFixed(3)], '1 ÷ (g × (0.5 cos 10° − sin 10°)) and cos 10° of 1 m/s, as the issue prints them').toEqual(['0.320', '0.985']);
    const run = ask([bake(tiltedBelt())]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const c = carried(run.replies[0]!, UP_SLOPE, 'the belt tilted 10° with tangent_speed 1');
    expect(typeof c === 'string' ? c : '', `${TILTED}: the tilted belt's world bakes, a state of its box after each of 240 steps`).toBe('');
    console.log(`${TILTED}: ${shown(c as Carried)}`);
    const failures = judge(c as Carried);
    expect(failures, `${TILTED} baked 2 s:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[3]} the behavior kit holds the fixture ${TILTED} once, the criterion's box and belt with 1 m/s and the 1% bound, and ${REFERENCE} passes it`, () => {
    const run = ask([{ call: 'behavior_fixtures' }, kitCall()]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const held = fixtureNamed(run.replies[0]!, TILTED, 'behavior_fixtures');
    expect(typeof held === 'string' ? held : '', `the kit's data holds the fixture ${TILTED}`).toBe('');
    const f = held as Fixture;
    const failures = dataFailures(f, SPEED, 0, '1 m/s');
    const read = rowOf(run.replies[1]!, TILTED, 'behavior_kit');
    if (typeof read === 'string') failures.push(read);
    else {
      console.log(`${TILTED}: measured ${String(read.measured)} m/s against ${String(read.answer)} m/s ${show(read.tolerance ?? null)} → ${read.result}`);
      failures.push(...passFailures(read, f, REFERENCE, SPEED));
    }
    expect(failures, `${TILTED} in the kit's data and on ${REFERENCE}:\n  ${failures.join('\n  ')}`).toEqual([]);
    // The judge's own wrong answer: the same row measuring the 0.985 m/s of a speed taken along level ground.
    expect(passFailures({ ...(read as KitResult), measured: ALONG_LEVEL }, f, REFERENCE, SPEED).length, 'the pass judge catches a box held at cos 10° of the speed').toBeGreaterThan(0);
  }, TIMEOUT);

  test(`${AC[3]} a planted wrapper that takes the speed along level ground (${PLANTED}) holds the box at 0.985 m/s and fails the 1% bound, naming ${TILTED}`, () => {
    const run = ask([bake(tiltedBelt()), kitCall()], { planted: PLANTED });
    expect(run.problem, `${run.what} answers: the planted wrapper runs`).toBe('');
    const [baked, report] = [run.replies[0]!, run.replies[1]!];
    const read = carried(baked, UP_SLOPE, `the belt tilted 10° with tangent_speed 1 under ${PLANTED}`);
    expect(typeof read === 'string' ? read : '', `${PLANTED} bakes the tilted belt`).toBe('');
    const c = read as Carried;
    console.log(`planted ${PLANTED}: ${shown(c)}`);
    // It holds the box at cos 10° of the belt's speed: 0.985 m/s as printed, through the second second.
    const held = c.speeds.slice(RATE + 1).filter((v) => !(Math.abs(v - 0.985) <= PRINTED));
    expect(held.length, `${PLANTED} holds the box at 0.985 m/s up the slope from 1 s to 2 s; ${held.length} steps read otherwise, the first ${String(held[0])} m/s`).toBe(0);
    const failures = judge(c);
    expect(failures.length, `${PLANTED}: the planted wrapper is caught (the judge finds nothing wrong with a box held at 0.985 m/s)`).toBeGreaterThan(0);
    expect(failures.some((x) => x.includes(TILTED)), `a failure names the fixture ${TILTED}; failures:\n  ${failures.join('\n  ')}`).toBe(true);
    // The kit's own row fails the 1% bound, naming the fixture, with the 0.985 m/s it measured.
    const row = rowOf(report, TILTED, `behavior_kit under ${PLANTED}`);
    expect(typeof row === 'string' ? row : '', `the kit's report under ${PLANTED} holds ${TILTED} once`).toBe('');
    const r = row as KitResult;
    const kit = failFailures(r, r.backend);
    if (r.answer !== SPEED || JSON.stringify(r.tolerance) !== JSON.stringify({ relative: WITHIN })) kit.push(`${TILTED}'s fail names the answer and tolerance ${show(r.answer)} ${show(r.tolerance ?? null)}, not 1 m/s and the 1% bound`);
    if (r.measured === null || !(Math.abs(r.measured - 0.985) <= PRINTED)) kit.push(`${TILTED}'s fail reads ${show(r.measured)} m/s, not the 0.985 m/s the wrapper holds the box at`);
    expect(kit, `${TILTED}'s row under ${PLANTED}:\n  ${kit.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
