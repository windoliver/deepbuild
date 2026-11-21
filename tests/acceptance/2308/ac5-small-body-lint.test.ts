// Criterion 5: a 1 cm die in a world at the defaults raises `physics.small_body` of kind `unit`, naming the die, its
// 0.01 m extent and 0.01 as the length, and of kind `soft`, naming a sink of 0.55 mm, 50 Hz and no change of
// `step_rate`. A 5 cm cube raises none of kind `unit`, and the die raises neither in the fixture's world. A planted
// lint that reads only the first shape of each body misses a die whose thin shape is its second and fails, naming the
// body.
import { describe, expect, test } from 'vitest';
import {
  AC, DIE, SIDE, SMALL_BODY, TIMEOUT, ask, check, cubeWorld, lintFailures, prebuild, quietFailures, secondShapeDie, show,
  sinkAt, type JsonObject, type Planted,
} from './helpers.ts';

prebuild(['release']);

const PLANTED: Planted = 'lint_reads_first_shape';
const KINDS = ['unit', 'soft'] as const;
const raised = (reply: JsonObject): string => show(reply['issues']).slice(0, 900);

describe(`${AC[5]} ${SMALL_BODY}, a lint run at check, names a body too small for the world's solver length and contact frequency`, () => {
  test(`${AC[5]} a 1 cm die at the defaults raises kind unit (the die, 0.01 m, 0.01) and kind soft (0.55 mm, 50 Hz, no change of step_rate), a die whose thin shape is its second the same, a 5 cm cube none of kind unit, and the die neither in the fixture's world`, () => {
    // The issue's closed form prints as its 0.55 mm.
    expect((sinkAt(30) * 1000).toFixed(2), 'the sink 2 × g ÷ (2π × 30)² as the issue prints it, mm').toBe('0.55');
    const run = ask([check(cubeWorld(DIE, SIDE, 'defaults')), check(secondShapeDie()), check(cubeWorld('cube', 0.05, 'defaults')), check(cubeWorld(DIE, SIDE, 'fixture'))]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const [die, second, cube, fixture] = [run.replies[0]!, run.replies[1]!, run.replies[2]!, run.replies[3]!];
    console.log(`the die at the defaults: ${raised(die)}\nthe 5 cm cube at the defaults: ${raised(cube)}\nthe die in the fixture's world: ${raised(fixture)}`);
    const failures = [
      ...lintFailures(die, DIE, 'a 1 cm die at the defaults'),
      ...lintFailures(second, DIE, 'a die at the defaults whose thin shape is its second'),
      ...quietFailures(cube, ['unit'], 'a 5 cm cube at the defaults'),
      ...quietFailures(fixture, KINDS, 'the 1 cm die in the fixture\'s world'),
    ];
    expect(failures, `${SMALL_BODY} at check:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[5]} a planted lint that reads only the first shape of each body misses a die whose thin shape is its second and fails, naming the body`, () => {
    const run = ask([check(cubeWorld(DIE, SIDE, 'defaults')), check(secondShapeDie())], { planted: PLANTED });
    expect(run.problem, `${run.what} answers`).toBe('');
    const [die, second] = [run.replies[0]!, run.replies[1]!];
    console.log(`planted ${PLANTED}: the die whose thin shape is its second raises ${raised(second)}`);
    // It is the lint but for that: a die whose one shape is thin still raises both kinds.
    const first = lintFailures(die, DIE, `a 1 cm die at the defaults under ${PLANTED}`);
    expect(first, `the planted lint still reads a die's first shape:\n  ${first.join('\n  ')}`).toEqual([]);
    const missed = quietFailures(second, KINDS, `a die whose thin shape is its second under ${PLANTED}`);
    expect(missed, `the planted lint misses the die whose thin shape is its second:\n  ${missed.join('\n  ')}`).toEqual([]);
    const failures = lintFailures(second, DIE, `a die whose thin shape is its second under ${PLANTED}`);
    expect(failures.length > 0 && failures.every((f) => f.startsWith(`${DIE}:`)), `the judge that passes the real lint fails on the planted one, naming the body:\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
