// #2243.710b06f5: "In a new fixture at 120 Hz, two character bodies of radius 0.3 m and offset 0.01 m walk toward each
// other at 2 m/s along x, their axes 4 m apart. They come to rest with their axes 0.3 + 0.3 + 0.01 = 0.61 m apart
// within 1 mm, and each writes `contact_begin` naming the other within four steps of (4 − 0.61) ÷ 4 = 0.8475 s. At the
// end of every step the distance between their axes is at least 0.609 m, and from 1 s to 3 s neither moves more than
// 1 mm. A planted wrapper that moves both against the last step's poses reads 0.600 m on step 102 and fails, naming
// the step and both bodies"
//
// The head-on world (README: The world) is baked 3 s, 360 steps, with both bodies' moves stamped at step 0, and read
// from the bake: each body's state after every step (`bodies.<ID>[k]`, its `pos` and its own `character.touching`) and
// the occurrence rows. The judge is helpers' `headOnFailures`: no step from 1 to 360 ends with the axes under 0.609 m
// apart; at every step from 120 to 360 the axes are 0.61 m apart within 1 mm and each body is within 1 mm of where it
// stood at step 120; and each body's controller first touches the other within four steps of step 101.7, with a
// `contact_begin` row of the pair at that step. The same judge runs on `--planted characters_against_last_step`.
import { describe, expect, it } from 'vitest';
import {
  AC, BOUND, GUARD, HERO, TIMEOUT, apart, ask, bakeCall, fmt, headOnFailures, headOnTrack, headOnWorld, pairOf, prebuild, under,
  type Planted,
} from './helpers.ts';

prebuild(['release']);

const ID = AC[1];
const WORLD = 'the head-on world';
const TWIN: Planted = 'characters_against_last_step';

describe(`${ID} two character bodies walking head-on stop at each other and never end a step inside one another`, () => {
  it(`${ID} walking toward each other at 2 m/s from 4 m apart they come to rest 0.61 m apart within 1 mm, each writes contact_begin naming the other within four steps of 0.8475 s, no step ends with their axes under 0.609 m apart, and from 1 s to 3 s neither moves more than 1 mm`, () => {
    const run = ask([bakeCall(headOnWorld(), headOnTrack())]);
    expect(run.problem, 'deep-physics bakes the head-on world').toBe('');
    const failures = headOnFailures(pairOf(run.replies[0]!, WORLD), WORLD);
    expect(failures, `${WORLD}, baked 3 s:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: ${TWIN}) a planted wrapper that moves both against the last step's poses reads 0.600 m on step 102 and fails, naming the step and both bodies`, () => {
    const run = ask([bakeCall(headOnWorld(), headOnTrack())], { planted: TWIN });
    expect(run.problem, `deep-physics --planted ${TWIN} runs and bakes the head-on world`).toBe('');
    const p = pairOf(run.replies[0]!, WORLD);
    const failures = headOnFailures(p, WORLD);
    expect(failures.length, `${TWIN} is caught: the judge that passes the real program finds something wrong with its bake`).toBeGreaterThan(0);
    expect(under(p.guard, p.hero, BOUND).first, `the first step ${TWIN} ends with the axes under ${BOUND} m apart`).toBe(102);
    expect(Math.abs(apart(p, 102) - 0.6), `${TWIN} reads 0.600 m on step 102 (it reads ${fmt(apart(p, 102))} m)`).toBeLessThanOrEqual(0.0005);
    const named = failures.some((f) => f.startsWith('step 102: ') && new RegExp(`\\b${GUARD}\\b`).test(f) && new RegExp(`\\b${HERO}\\b`).test(f));
    expect(named, `a failure names step 102 and both bodies, ${GUARD} and ${HERO}:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
