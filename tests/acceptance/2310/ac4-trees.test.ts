// #2310.96ed9c5c: "A square of four bodies joined by four articulated hinges is refused at check, naming the hinge that
// closes the loop, and with that one hinge left separate the world is accepted and steps. A body that is the `b` of two
// articulated joints is refused, naming the second. `breaks_at` on an articulated joint is refused, naming the field. A
// planted check that only counts joints against bodies accepts the square and fails, naming the joint"
//
// Each refusal is read from the `check` call's `issues` (README: The refusals). The square (README: The worlds) is four
// bars `side_1` to `side_4` joined corner to corner by the hinges `corner_1` to `corner_4`, each body the `b` of
// exactly one of them, so nothing but the loop is wrong with it; the hinge that closes the loop is `corner_4`, the last
// in canonical order. Its refusal is an error `physics.articulation_tree` at `joints/corner_4`, and none at another
// corner. With `corner_4` left separate the check raises no error, and a bake of 1 s holds a state of every body after
// every step and a step hash that changes with every step, the square falling. `load`, the `b` of both `hold_1` and
// `hold_2`, is refused with the same code at `joints/hold_2` and not at `joints/hold_1`. `breaks_at` on the articulated
// ball joint `rod` is refused by an error at `joints/rod/breaks_at`, and the same joint without it is accepted.
//
// On `--planted articulated_tree_counts_only` the square's check raises no error, and the judge's failure names
// `corner_4`.
import { describe, expect, it } from 'vitest';
import {
  AC, CLOSES, CORNERS, HOLDS, RATE, ROD, TIMEOUT, TREE, acceptedFailures, ask, bake, breakable, check, fieldFailures, heldTwice, judged, prebuild,
  repeats, runOf, square, treeFailures, type Planted,
} from './helpers.ts';

prebuild(['release']);

const ID = AC[4];
const TWIN: Planted = 'articulated_tree_counts_only';
const SQUARE = 'the square of four bodies joined by four articulated hinges';
const OPENED = `the square with ${CLOSES} left separate`;
const OTHERS = CORNERS.filter((c) => c !== CLOSES);

describe(`${ID} the articulated joints of a world form trees: a loop, a body held twice and breaks_at are refused at check`, () => {
  it(`${ID} a square of four bodies joined by four articulated hinges is refused at check, naming the hinge that closes the loop, and with that one hinge left separate the world is accepted and steps`, () => {
    const opened = square([CLOSES]);
    const run = ask([check(square()), check(opened), bake(opened, RATE)]);
    expect(run.problem, `${run.what} answers the two checks and the bake`).toBe('');
    const failures = [
      ...treeFailures(run.replies[0], CLOSES, OTHERS, SQUARE),
      ...acceptedFailures(run.replies[1], OPENED),
      ...judged(runOf(opened, run.replies[2], OPENED, RATE + 1), (r) => (repeats(r.hashes).length ? [`${OPENED} doesn't step: under gravity its step hash repeats the step before's at ${repeats(r.hashes).length} of ${RATE} steps (first at step ${repeats(r.hashes)[0]!})`] : [])),
    ];
    expect(failures, `${SQUARE}, and ${OPENED}:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} a body that is the b of two articulated joints is refused, naming the second, and breaks_at on an articulated joint is refused, naming the field`, () => {
    const run = ask([check(heldTwice()), check(breakable(true, true)), check(breakable(true, false))]);
    expect(run.problem, `${run.what} answers the three checks`).toBe('');
    const failures = [
      ...treeFailures(run.replies[0], HOLDS[1], [HOLDS[0]], `the body that is the b of both ${HOLDS[0]} and ${HOLDS[1]}`),
      ...fieldFailures(run.replies[1], ROD, 'breaks_at', `breaks_at on the articulated joint ${ROD}`),
      // The refusal is the field's: the same articulated joint without it is accepted.
      ...acceptedFailures(run.replies[2], `the articulated joint ${ROD} with breaks_at left out`),
    ];
    expect(failures, `the checks:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: ${TWIN}) a planted check that only counts joints against bodies accepts the square and fails, naming the joint`, () => {
    const run = ask([check(square())], { planted: TWIN });
    expect(run.problem, `deep-physics --planted ${TWIN} runs and answers the check`).toBe('');
    const accepted = acceptedFailures(run.replies[0], SQUARE);
    expect(accepted, `${TWIN} accepts the square: its four hinges are no more than its four bodies`).toEqual([]);
    const failures = treeFailures(run.replies[0], CLOSES, OTHERS, SQUARE);
    expect(failures.length, `${TWIN} is caught: the judge that passes the real check finds no ${TREE} naming ${CLOSES}`).toBeGreaterThan(0);
    expect(failures.some((f) => f.startsWith(`${CLOSES}: `)), `a failure names the joint ${CLOSES}:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
