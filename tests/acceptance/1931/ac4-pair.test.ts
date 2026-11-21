// Criterion 4: two 1 kg bodies under `lennard_jones {epsilon: 1 J, sigma: 0.5 m, cutoff: 1.25 m}` and
// `drag {linear: 2}`, released at rest 0.7 m apart, are 2^(1/6) × σ = 0.5612 m apart at 10 s, within 0.5%. A planted
// law without the factor 2 rests them at 0.500 m and fails, naming the fixture, the answer and the distance. Two bodies
// released 1.3 m apart, past the cutoff, are still 1.3 m apart at 10 s, and a planted law without the cutoff closes
// them to 0.561 m and fails.
import { describe, expect, test } from 'vitest';
import {
  AC, APART, LEFT, NO_CUTOFF_CLOSES, NO_FACTOR_REST, PAIR, PAIR_STEPS, PAST_CUTOFF, PRINTED, REST, RIGHT, TIMEOUT, apartOf, ask, bake,
  failFailures, kitCall, mm3, pairWorld, prebuild, restFailures, rowOf, show, stillFailures, type KitResult,
} from './helpers.ts';

prebuild(['release']);
const NO_FACTOR = 'lennard_jones_no_factor_2';
const NO_CUTOFF = 'lennard_jones_no_cutoff';
const near = (): ReturnType<typeof bake> => bake(pairWorld(APART), PAIR_STEPS, [LEFT, RIGHT]);
const far = (): ReturnType<typeof bake> => bake(pairWorld(PAST_CUTOFF), PAIR_STEPS, [LEFT, RIGHT]);
const shown = (apart: readonly number[]): string =>
  `${apart[0]!.toFixed(4)} m apart as built, ${apart[PAIR_STEPS]!.toFixed(6)} m at 10 s (nearest ${Math.min(...apart).toFixed(4)} m)`;

describe(`${AC[4]} a lennard_jones pair under a drag rests at 2^(1/6) × σ, and a pair past the cutoff takes no force`, () => {
  test(`${AC[4]} two bodies released at rest 0.7 m apart are 0.5612 m apart at 10 s, within 0.5%`, () => {
    expect(REST.toFixed(4), '2^(1/6) × σ, as the issue prints it').toBe('0.5612');
    const run = ask([near()]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const apart = apartOf(run.replies[0]!, LEFT, RIGHT, 'the pair released 0.7 m apart');
    expect(typeof apart === 'string' ? apart : '', `${PAIR}: the pair's world bakes, a state of each body after each of ${PAIR_STEPS} steps`).toBe('');
    console.log(`${PAIR}: ${shown(apart as number[])}, worked ${REST.toFixed(4)} m`);
    const failures = restFailures(PAIR, apart as number[]);
    expect(failures, `${PAIR} baked 10 s:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[4]} two bodies released 1.3 m apart, past the cutoff, are still 1.3 m apart at 10 s, beside the pair inside it, which the same law moves`, () => {
    const run = ask([far(), near()]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const [past, inside] = [apartOf(run.replies[0]!, LEFT, RIGHT, 'the pair released 1.3 m apart'), apartOf(run.replies[1]!, LEFT, RIGHT, 'the pair released 0.7 m apart')];
    const unread = [past, inside].filter((x): x is string => typeof x === 'string');
    expect(unread, 'the two pairs\' worlds bake, a state of each body after each step').toEqual([]);
    console.log(`past the cutoff: ${shown(past as number[])}; inside it: ${shown(inside as number[])}`);
    const failures = stillFailures(past as number[]);
    // The comparison isn't vacuous: in the same run the law moves the pair released inside the cutoff, by more than a tenth of a metre.
    const moved = Math.abs((inside as number[])[PAIR_STEPS]! - APART);
    if (!(moved > 0.1)) failures.push(`nothing shows the law moves a pair: the one released ${APART} m apart, inside the cutoff, is ${mm3((inside as number[])[PAIR_STEPS]!)} m apart at 10 s`);
    expect(failures, `the pair past the cutoff, baked 10 s:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[4]} a planted law without the factor 2 (${NO_FACTOR}) rests them at 0.500 m and fails, naming ${PAIR}, the answer 0.5612 m and the distance`, () => {
    const run = ask([near(), kitCall()], { planted: NO_FACTOR });
    expect(run.problem, `${run.what} answers: the planted law runs`).toBe('');
    const read = apartOf(run.replies[0]!, LEFT, RIGHT, `the pair released 0.7 m apart under ${NO_FACTOR}`);
    expect(typeof read === 'string' ? read : '', `${NO_FACTOR} bakes the pair's world`).toBe('');
    const apart = read as number[];
    console.log(`planted ${NO_FACTOR}: ${shown(apart)}`);
    // What the wrong law does, as the issue prints it: the pair rests 0.500 m apart.
    const rests = apart[PAIR_STEPS]!;
    expect(Math.abs(rests - NO_FACTOR_REST) <= PRINTED, `${NO_FACTOR} rests them at ${NO_FACTOR_REST.toFixed(3)} m: at 10 s they are ${rests} m apart`).toBe(true);
    // The judge that passes the real law fails on it, naming the fixture, the answer and the distance.
    const failures = restFailures(PAIR, apart);
    expect(failures.length, `${NO_FACTOR}: the planted law is caught (the judge finds nothing wrong with a pair resting ${mm3(rests)} m apart)`).toBeGreaterThan(0);
    expect(failures.some((x) => [PAIR, `the answer ${REST.toFixed(4)} m`, `${NO_FACTOR_REST.toFixed(3)} m apart`].every((n) => x.includes(n))), `a failure names ${PAIR}, the answer ${REST.toFixed(4)} m and the distance ${NO_FACTOR_REST.toFixed(3)} m; failures:\n  ${failures.join('\n  ')}`).toBe(true);

    // The kit's own fail names them in its row: the fixture, the interface's answer and the 0.500 m it measured.
    const row = rowOf(run.replies[1]!, PAIR, `behavior_kit under ${NO_FACTOR}`);
    expect(typeof row === 'string' ? row : '', `the kit's report under ${NO_FACTOR} holds ${PAIR} once`).toBe('');
    const r = row as KitResult;
    const kit = failFailures(r);
    if (r.answer === null || Math.abs(r.answer - 0.5612) > 0.00005) kit.push(`${PAIR}'s fail names the answer ${show(r.answer)}, not 0.5612 m`);
    if (r.measured === null || !(Math.abs(r.measured - NO_FACTOR_REST) <= PRINTED)) kit.push(`${PAIR}'s fail reads ${show(r.measured)} m, not the ${NO_FACTOR_REST.toFixed(3)} m the pair rests at`);
    expect(kit, `${PAIR}'s row under ${NO_FACTOR}:\n  ${kit.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[4]} a planted law without the cutoff (${NO_CUTOFF}) closes the pair released 1.3 m apart to 0.561 m and fails`, () => {
    const run = ask([far()], { planted: NO_CUTOFF });
    expect(run.problem, `${run.what} answers: the planted law runs`).toBe('');
    const read = apartOf(run.replies[0]!, LEFT, RIGHT, `the pair released 1.3 m apart under ${NO_CUTOFF}`);
    expect(typeof read === 'string' ? read : '', `${NO_CUTOFF} bakes the world of the pair past the cutoff`).toBe('');
    const apart = read as number[];
    console.log(`planted ${NO_CUTOFF}: ${shown(apart)}`);
    // What the wrong law does, as the issue prints it: at 10 s the pair has closed to 0.561 m.
    const closed = apart[PAIR_STEPS]!;
    expect(Math.abs(closed - NO_CUTOFF_CLOSES) <= PRINTED, `${NO_CUTOFF} closes them to ${NO_CUTOFF_CLOSES} m: at 10 s they are ${closed} m apart`).toBe(true);
    // The judge that passes the real law fails on it.
    const failures = stillFailures(apart);
    expect(failures.length, `${NO_CUTOFF}: the planted law is caught (the judge finds nothing wrong with a pair closed to ${mm3(closed)} m)`).toBeGreaterThan(0);
  }, TIMEOUT);
});
