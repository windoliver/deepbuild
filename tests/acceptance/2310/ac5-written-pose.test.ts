// #2310.df957af4: "An articulated hinge whose second body is written 45° from straight down, its anchors together,
// starts there: at step 1 with gravity 0 the body is at (0.7071, −0.7071) m from the hinge within 0.1 mm and stays there
// for 1 s. The same body written 2 mm off its anchor is refused, naming the joint and the 2 mm. A planted wrapper that
// leaves every articulated joint at coordinate 0 starts the body straight down and fails, naming the body"
//
// The world (README: The worlds): the ball `arm` on the articulated hinge `hinge` to the world at the origin, about
// +Z, with no gravity; its anchor is 1 m above its centre in its own frame, so at coordinate 0 it hangs straight down
// at (0, −1) m, and it is written turned 45° about +Z with its centre at (sin 45°, −cos 45°) m, its anchors together.
// Baked 1 s and read from the body's states: after every step from 1 to 120 its centre is within 0.1 mm of
// (0.7071, −0.7071, 0) m.
//
// Written 2 mm farther from the hinge along the same line, its anchors are 2 mm apart: the check refuses it with an
// error `physics.articulation_gap` at `joints/hinge` whose `actual` is the gap, 0.002 m (README: The refusals); with
// its anchors together the same world is accepted.
//
// On `--planted articulated_starts_at_zero` the body is at (0, −1) m after step 1, and the judge's failure names it.
import { describe, expect, it } from 'vitest';
import {
  AC, ARM, GAP, HINGE, OFF, OPEN, PLACE, RATE, TIMEOUT, acceptedFailures, armAt, ask, bake, check, fmt, gapFailures, judged, placeFailures,
  prebuild, runOf, written, type Planted, type Run,
} from './helpers.ts';

prebuild(['release']);

const ID = AC[5];
const TWIN: Planted = 'articulated_starts_at_zero';
const WORLD = 'the articulated hinge whose body is written 45° from straight down';

describe(`${ID} the bodies an articulated joint holds start where the document puts them`, () => {
  it(`${ID} an articulated hinge whose second body is written 45° from straight down, its anchors together, starts there: at step 1 with gravity 0 the body is at (0.7071, −0.7071) m from the hinge within 0.1 mm and stays there for 1 s`, () => {
    const w = written();
    const run = ask([bake(w, RATE)]);
    expect(run.problem, `${run.what} answers the bake`).toBe('');
    const failures = judged(runOf(w, run.replies[0], WORLD, RATE + 1), placeFailures);
    expect(failures, `${WORLD}, baked 1 s:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} the same body written 2 mm off its anchor is refused, naming the joint and the 2 mm`, () => {
    const run = ask([check(written(true, OFF)), check(written())]);
    expect(run.problem, `${run.what} answers the two checks`).toBe('');
    const failures = [
      ...gapFailures(run.replies[0], HINGE, OFF, 'the body written 2 mm off its anchor'),
      // The refusal is the gap's: the same world with its anchors together is accepted.
      ...acceptedFailures(run.replies[1], `${WORLD}, its anchors together,`),
    ];
    expect(failures, `the checks (${GAP}):\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: ${TWIN}) a planted wrapper that leaves every articulated joint at coordinate 0 starts the body straight down and fails, naming the body`, () => {
    const w = written();
    const run = ask([bake(w, RATE)], { planted: TWIN });
    expect(run.problem, `deep-physics --planted ${TWIN} runs and answers the bake`).toBe('');
    const read = runOf(w, run.replies[0], WORLD, RATE + 1);
    expect(typeof read === 'string' ? read : '', `--planted ${TWIN} bakes ${WORLD}`).toBe('');
    const r = read as Run;
    const failures = placeFailures(r);
    expect(failures.length, `${TWIN} is caught: the judge that passes the real program finds something wrong with its bake`).toBeGreaterThan(0);
    const at = armAt(r, 1);
    const down = Math.hypot(at[0], at[1] + 1, at[2]);
    expect(down, `${TWIN} starts the body straight down: after step 1 it is at (${fmt(at[0])}, ${fmt(at[1])}) m from the hinge, where (0, −1) m is straight down and (${fmt(PLACE[0])}, ${fmt(PLACE[1])}) m is where it is written`).toBeLessThanOrEqual(OPEN);
    expect(failures.some((f) => f.startsWith(`${ARM}: `)), `a failure names the body ${ARM}:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
