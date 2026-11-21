// #2310.4ec9a54e: "The same chain with a 100 kg bob, gravity turned square to it so it is let go level: the bob passes
// its lowest point at √(2 × 9.81 × 1.05) = 4.539 m/s within 1%, and no joint opens 0.1 mm over 4 s. Swung into a static
// wall, the bob of the 10 kg chain writes `hit` naming the wall, and its centre is never more than 1 mm past the place
// where it touches. The planted wrapper's chain falls apart and fails, naming the first joint to open and the step"
//
// Criterion 1's chain (README: The worlds) with gravity along +X, square to the chain as written, baked 4 s and read
// from the bake. With the 100 kg bob the judge is helpers' `swungFailures`: the bob's speed at the step nearest where
// its centre crosses the line through the fixed point along gravity is 4.539 m/s within 1%, and no joint's anchors are
// more than 0.1 mm apart at any step. With the 10 kg bob and a static wall whose face the bob meets as it passes its
// lowest point, the judge is `struckFailures`: the occurrence list holds a `hit` between the bob and the wall, the
// bob's centre is never more than 1 mm nearer the wall than where it touches it, and no joint opens.
//
// The swing is in the kit as `articulated/swing` (README: The fixtures in the behavior kit): the criterion's chain
// with 4.539 m/s and 1%, naming the cap `articulations`; the reference backend passes it, and its own world baked
// passes the same judge.
//
// On `--planted articulated_built_separate` the 100 kg chain falls apart, a joint's anchors farther apart than a link
// is long, and the judge's first failure names the first joint to open and the step; the wall's judge fails on it too.
import { describe, expect, it } from 'vitest';
import {
  AC, HELD, LINK, SWUNG_CHAIN, TIMEOUT, ask, bake, bakeFixture, chain, chainData, firstToOpen, fixtureNamed, heldFailures, judged, mm,
  openFailures, openings, passFailures, prebuild, runOf, struckFailures, swungFailures, widest, type Fixture, type Planted, type Run,
} from './helpers.ts';

prebuild(['release']);

const ID = AC[2];
const TWIN: Planted = 'articulated_built_separate';
const SWUNG = 'the chain with a 100 kg bob, let go level';
const STRUCK = 'the chain with a 10 kg bob, swung into the wall';

describe(`${ID} the chain let go level swings as a rod of its length, never opens, and its bob stops at a wall`, () => {
  it(`${ID} with a 100 kg bob and gravity turned square to it, the bob passes its lowest point at √(2 × 9.81 × 1.05) = 4.539 m/s within 1%, and no joint opens 0.1 mm over 4 s`, () => {
    const w = chain({ bob: 100, level: true });
    const run = ask([bake(w)]);
    expect(run.problem, `${run.what} answers the bake`).toBe('');
    const failures = judged(runOf(w, run.replies[0], SWUNG), (r) => swungFailures(w, r));
    expect(failures, `${SWUNG}, on articulated ball joints, baked 4 s:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} swung into a static wall, the bob of the 10 kg chain writes hit naming the wall, its centre is never more than 1 mm past the place where it touches, and no joint opens`, () => {
    const w = chain({ bob: 10, level: true, wall: true });
    const run = ask([bake(w)]);
    expect(run.problem, `${run.what} answers the bake`).toBe('');
    const failures = judged(runOf(w, run.replies[0], STRUCK), (r) => struckFailures(w, r));
    expect(failures, `${STRUCK}, on articulated ball joints, baked 4 s:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} the behavior kit holds the swing as ${SWUNG_CHAIN} once, the criterion's chain let go level with 4.539 m/s and 1%, rapier3d passes it, and its own world baked holds as the criterion says`, () => {
    const kit = ask([{ call: 'behavior_fixtures' }, { call: 'behavior_kit' }]);
    expect(kit.problem, `${kit.what} answers the kit's calls`).toBe('');
    const found = fixtureNamed(kit.replies[0], SWUNG_CHAIN);
    expect(typeof found === 'string' ? found : '', `the kit's data holds the swing, ${SWUNG_CHAIN}`).toBe('');
    const fixture = found as Fixture;
    const data = chainData(fixture, 100, true);
    const failures = [...heldFailures(fixture, HELD.swing), ...data.failures, ...passFailures(kit.replies[1], fixture, HELD.swing)];
    expect(failures, `${SWUNG_CHAIN} in the kit's data and in its report on rapier3d:\n  ${failures.join('\n  ')}`).toEqual([]);

    // The fixture's own world, baked over its own steps, holds as the criterion says.
    const own = ask([bakeFixture(fixture)]);
    expect(own.problem, `${own.what} answers the bake of ${SWUNG_CHAIN}'s own world`).toBe('');
    const held = judged(runOf(fixture.world, own.replies[0], `${SWUNG_CHAIN}'s world`, fixture.steps + 1), (r) => swungFailures(fixture.world, r, data.hung!));
    expect(held, `${SWUNG_CHAIN}'s own world, baked ${fixture.steps} steps:\n  ${held.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: ${TWIN}) the planted wrapper's chain falls apart and fails, naming the first joint to open and the step`, () => {
    const [swung, struck] = [chain({ bob: 100, level: true }), chain({ bob: 10, level: true, wall: true })];
    const run = ask([bake(swung), bake(struck)], { planted: TWIN });
    expect(run.problem, `deep-physics --planted ${TWIN} runs and answers the bakes`).toBe('');
    const read = runOf(swung, run.replies[0], SWUNG);
    expect(typeof read === 'string' ? read : '', `--planted ${TWIN} bakes ${SWUNG}`).toBe('');
    const r = read as Run;
    expect(swungFailures(swung, r).length, `${TWIN} is caught: the judge that passes the real program finds something wrong with its bake`).toBeGreaterThan(0);
    const all = openings(swung, r);
    const wide = widest(all);
    expect(wide.worst > LINK, `${TWIN}'s chain falls apart: a joint's anchors end farther apart than a link is long, ${LINK} m (its widest: ${wide.joint}, ${mm(wide.worst)} mm at step ${wide.step})`).toBe(true);
    const first = firstToOpen(all)!;
    const opened = openFailures(swung, r);
    expect(opened[0]?.startsWith(`${first.joint}: step ${first.first}: `), `the first failure names the first joint to open, ${first.joint}, and the step, ${first.first}:\n  ${opened.join('\n  ')}`).toBe(true);
    // The wall's judge fails on it too: its bob meets the wall on a chain that has opened.
    const met = runOf(struck, run.replies[1], STRUCK);
    expect(typeof met === 'string' ? met : '', `--planted ${TWIN} bakes ${STRUCK}`).toBe('');
    expect(struckFailures(struck, met as Run).length, `${TWIN} is caught by the wall's judge too: ${STRUCK}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
