// Criterion 2: the box on a kinematic platform that reaches 2 m/s in a straight line over 1 s and holds it 5 s is
// within 1 mm of its place on it at every step, as it is at the merge base.
//
// The same bake is read on this checkout's build and on the merge base's (#191's `mergeBasePhysics`), and each is
// held to the bound. The merge base holds it already, so this test passes there, as it should: it is here so that
// whatever carries a box on a turning body leaves one on a body that moves in a straight line where it was.
import { describe, expect, test } from 'vitest';
import {
  AC, BASE_TIMEOUT, BOX, PLACE_WITHIN, ask, askBase, leftBehind, placeRead, platformBake, prebuild, withBase,
} from './helpers.ts';

prebuild(['release']);
withBase();

const mm = (m: number | null): string => (m === null ? 'unread' : `${(m * 1000).toFixed(4)} mm`);

describe(`${AC[2]} the straight platform: a box on a kinematic platform that reaches 2 m/s over 1 s and holds it 5 s`, () => {
  test(`${AC[2]} the box is within 1 mm of its place on the platform at every step, here and at the merge base`, () => {
    const run = ask([platformBake()]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const here = placeRead(run.replies[0]!, 'the box on the platform');
    const there = askBase([platformBake()]);
    expect(there.problem, `${there.what} answers`).toBe('');
    const base = placeRead(there.replies[0]!, `the box on the platform at the merge base ${there.sha.slice(0, 12)}`);
    console.log(`the box's farthest from its place on the platform: ${mm(here.measured)} here, ${mm(base.measured)} at the merge base ${there.sha.slice(0, 12)} (within ${PLACE_WITHIN * 1000} mm)`);
    // Not vacuous: the same judge fails the same bake once the box is left where it was built.
    const left = placeRead(leftBehind(run.replies[0]!), 'the same bake with the box left where it was built');
    expect(left.failures.some((f) => f.startsWith(`${BOX}:`) && /\bstep \d+\b/.test(f)), `the judge fails a box the platform leaves behind, naming it and the step:\n  ${left.failures.join('\n  ')}`).toBe(true);
    const failures = [...here.failures, ...base.failures];
    expect(failures, `the box on the straight platform:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, BASE_TIMEOUT);
});
