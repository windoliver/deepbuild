// #2243.94c09b0c: "One of them walks at 2 m/s into the other, which wants no move: it stops with their axes 0.61 m apart
// within 1 mm, and the standing one's position never changes by more than 1e-6 m. A planted wrapper that lets the
// walker's approach move the standing one fails, naming the body"
//
// The head-on world (README: The world) with one move on its track, baked 3 s and read from the bake, once for each
// body as the walker: `guard`, the earlier in canonical order, walking into `hero`, and `hero` walking into `guard`,
// since which of them moves first differs. The judge is helpers' `standingFailures`: the standing body's `pos` after
// every step is within 1e-6 m of where it was built, and through the last second (steps 240 to 360; the walker
// arrives at (4 − 0.61) ÷ 2 = 1.695 s) the axes are 0.61 m apart within 1 mm. The same judge runs on
// `--planted approach_moves_standing`, where it must fail in a run whose standing body moved, naming that body.
import { describe, expect, it } from 'vitest';
import {
  AC, BODIES, STILL, TIMEOUT, ask, bakeCall, fmt, headOnWorld, movedBy, other, pairOf, prebuild, standingFailures, walk,
  type Asked, type Body, type Planted,
} from './helpers.ts';

prebuild(['release']);

const ID = AC[2];
const TWIN: Planted = 'approach_moves_standing';
const run = (walker: Body): string => `${walker} walking into ${other(walker)}, which wants no move`;
/** One process baking the world twice: each body in turn the only one with a move. */
const bakes = (planted?: Planted): Asked => ask(BODIES.map((walker) => bakeCall(headOnWorld(), [walk(walker)])), planted ? { planted } : {});
/** Each run's judge, and how far its standing body got from where it was built. */
function judged(asked: Asked): { stander: Body; failures: string[]; moved: ReturnType<typeof movedBy> }[] {
  return BODIES.map((walker, i) => {
    const p = pairOf(asked.replies[i]!, run(walker));
    return { stander: other(walker), failures: standingFailures(p, walker, run(walker)), moved: movedBy(p, other(walker)) };
  });
}

describe(`${ID} a character body that wants no move stays where it is when another walks into it`, () => {
  it(`${ID} whichever of the two walks at 2 m/s into the other, it stops with their axes 0.61 m apart within 1 mm, and the standing one's position never changes by more than 1e-6 m`, () => {
    const asked = bakes();
    expect(asked.problem, 'deep-physics bakes the world with one body walking, once for each body').toBe('');
    const failures = judged(asked).flatMap((j) => j.failures);
    expect(failures, `one body walking into the other, baked 3 s:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: ${TWIN}) a planted wrapper that lets the walker's approach move the standing one fails, naming the body`, () => {
    const asked = bakes(TWIN);
    expect(asked.problem, `deep-physics --planted ${TWIN} runs and bakes the world with one body walking, once for each body`).toBe('');
    const runs = judged(asked);
    const failures = runs.flatMap((j) => j.failures);
    expect(failures.length, `${TWIN} is caught: the judge that passes the real program finds something wrong with its bakes`).toBeGreaterThan(0);
    const moved = runs.filter((j) => j.moved.first >= 0);
    expect(moved.length, `${TWIN} moves a standing body more than ${STILL} m (the standing bodies' farthest: ${runs.map((j) => `${j.stander} ${fmt(j.moved.worst)} m`).join(', ')})`).toBeGreaterThan(0);
    for (const j of moved) {
      expect(j.failures.some((f) => f.startsWith(`${j.stander}: the standing body `)), `a failure names the standing body ${j.stander}:\n  ${j.failures.join('\n  ')}`).toBe(true);
    }
  }, TIMEOUT);
});
