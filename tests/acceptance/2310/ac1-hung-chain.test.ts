// #2310.e54abd92: "In a new fixture at 120 Hz and 4 substeps, a chain of ten 0.1 kg links of 0.1 m on articulated ball
// joints hangs from the world with a 10 kg bob of radius 0.05 m at its end. Over 4 s no joint's two anchors are more
// than 0.1 mm apart at any step and the bob's centre stays 1.05 m from the fixed point within 0.1 mm. A planted wrapper
// that builds the joints as separate ones opens a joint 17.5 mm and fails, naming the joint and the step"
//
// The chain (README: The worlds) is baked 4 s, 480 steps, and read from the bake: every body's state after every step.
// A joint's opening is the distance between its two anchors, each worked out from its body's state and the joint's
// frame. The judge is helpers' `hungFailures`: at every step from the built world to step 480 no joint's anchors are
// more than 0.1 mm apart, and the bob's centre is 1.05 m from the fixed point within 0.1 mm.
//
// The new fixture is the kit's `articulated/loaded_chain` (README: The fixtures in the behavior kit): the kit's data
// holds it once with the criterion's chain, 1.05 m and 0.1 mm, naming the cap `articulations`; the reference backend
// passes it; and its own world, baked over its own steps, passes the same judge.
//
// The same judge runs on `--planted articulated_built_separate`: its widest opening is the issue's 17.5 mm, to half a
// unit of that last digit, and a failure names that joint and the step.
import { describe, expect, it } from 'vitest';
import {
  AC, HELD, LOADED_CHAIN, PRINTED_MM, SEPARATE_OPENS, TIMEOUT, ask, bake, bakeFixture, chain, chainData, fixtureNamed, heldFailures,
  hungFailures, judged, mm, openings, passFailures, prebuild, runOf, widest, type Fixture, type Planted, type Run,
} from './helpers.ts';

prebuild(['release']);

const ID = AC[1];
const TWIN: Planted = 'articulated_built_separate';
const WORLD = 'the chain hung with a 10 kg bob';

describe(`${ID} a chain of ten 0.1 kg links on articulated ball joints carries a 10 kg bob and never opens`, () => {
  it(`${ID} hung from the world with a 10 kg bob, over 4 s no joint's two anchors are more than 0.1 mm apart at any step and the bob's centre stays 1.05 m from the fixed point within 0.1 mm`, () => {
    const w = chain({ bob: 10 });
    const run = ask([bake(w)]);
    expect(run.problem, `${run.what} answers the bake`).toBe('');
    const failures = judged(runOf(w, run.replies[0], WORLD), (r) => hungFailures(w, r));
    expect(failures, `${WORLD}, on articulated ball joints, baked 4 s:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} the behavior kit holds the new fixture ${LOADED_CHAIN} once, the criterion's chain at 120 Hz and 4 substeps with 1.05 m and 0.1 mm, rapier3d passes it, and its own world baked holds as the criterion says`, () => {
    const kit = ask([{ call: 'behavior_fixtures' }, { call: 'behavior_kit' }]);
    expect(kit.problem, `${kit.what} answers the kit's calls`).toBe('');
    const found = fixtureNamed(kit.replies[0], LOADED_CHAIN);
    expect(typeof found === 'string' ? found : '', `the kit's data holds the new fixture ${LOADED_CHAIN}`).toBe('');
    const fixture = found as Fixture;
    const data = chainData(fixture, 10, false);
    const failures = [...heldFailures(fixture, HELD.chain), ...data.failures, ...passFailures(kit.replies[1], fixture, HELD.chain)];
    expect(failures, `${LOADED_CHAIN} in the kit's data and in its report on rapier3d:\n  ${failures.join('\n  ')}`).toEqual([]);

    // The fixture's own world, baked over its own steps, holds as the criterion says.
    const own = ask([bakeFixture(fixture)]);
    expect(own.problem, `${own.what} answers the bake of ${LOADED_CHAIN}'s own world`).toBe('');
    const held = judged(runOf(fixture.world, own.replies[0], `${LOADED_CHAIN}'s world`, fixture.steps + 1), (r) => hungFailures(fixture.world, r, data.hung!));
    expect(held, `${LOADED_CHAIN}'s own world, baked ${fixture.steps} steps:\n  ${held.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: ${TWIN}) a planted wrapper that builds the joints as separate ones opens a joint 17.5 mm and fails, naming the joint and the step`, () => {
    const w = chain({ bob: 10 });
    const run = ask([bake(w)], { planted: TWIN });
    expect(run.problem, `deep-physics --planted ${TWIN} runs and answers the bake`).toBe('');
    const read = runOf(w, run.replies[0], WORLD);
    expect(typeof read === 'string' ? read : '', `--planted ${TWIN} bakes ${WORLD}`).toBe('');
    const r = read as Run;
    const failures = hungFailures(w, r);
    expect(failures.length, `${TWIN} is caught: the judge that passes the real program finds something wrong with its bake`).toBeGreaterThan(0);
    const wide = widest(openings(w, r));
    expect(Math.abs(wide.worst - SEPARATE_OPENS), `${TWIN} opens a joint 17.5 mm (its widest: ${wide.joint}, ${mm(wide.worst)} mm at step ${wide.step})`).toBeLessThanOrEqual(PRINTED_MM);
    const named = failures.some((f) => f.startsWith(`${wide.joint}: step ${wide.first}: `) && f.includes(`${mm(wide.worst)} mm at the most, at step ${wide.step}`));
    expect(named, `a failure names the joint ${wide.joint}, the step it first opens at (${wide.first}) and the step it is widest at (${wide.step}):\n  ${failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
