// AC1 #213.170f7e56: "A logic item at 60 Hz beside a 120 Hz world with a static wall whose face is at x = 10 m asks, at
// step 30, a ray from the origin along +x; at step 31 it reads one hit at a distance of 10.000 m within 1 mm, naming the
// wall's ID, equal to a physics.query ray probe on the bake at the same state; with the wall kinematic and moving at
// 1 m/s, a planted service that answers from the world after its next step reads a distance 1/120 m short and fails,
// naming the query and the step"
//
// Through `deep-show run`, the binary that links the logic and physics modules: the range scene (fixtures.ts) with the
// shooter (programs.ts), its `logic` call's step records read for what the program copied out of its result region.
// "The same state" is the world as its last step before step 30's time left it: the state after 60 world steps
// (README: Readings). physics.query is #1919's `query` on `deep-physics`'s bake of the same world; the moving wall's
// reference is `deep-physics`'s bake of the scene's world, its face at that state.

import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DOC, TIMEOUT, arr, binOf, failsNaming, handleOf, none, num, obj, one, physics, prebuildPhysics, presented, runShow, scenario,
  show, showCall, showSteps, statesOf, logicCall, useBuilds, useTemp, type JsonObject,
} from './helpers.ts';
import { RANGE, WALL_HALF, castParams, probeHandles, rangeScene, rangeWorld, withoutLogic } from './fixtures.ts';
import { SHOOTER_WRITES, shooter } from './programs.ts';

const ID = CRITERIA[1];
useBuilds(['show']);
prebuildPhysics();
const temp = useTemp();

const STEPS = 40;
const ASK = 30;
const READ = 31;
/** The world state logic step 30 reads: the state after 60 steps of the 120 Hz world (README: Readings). */
const STATE = 60;
const WORLD_STEPS = 240;
const MM = 0.001;
const RAY = 'the ray from (0, 0, 0) along +x, max 100 m, that shooter asks at step 30';

/** The shooter's reading at a step: what it copied of its result region (README: Programs). */
interface Reading { answered: number; hits: number; id: number; dist: number; x: number }
function readingAt(step: JsonObject, what: string): Reading {
  return { answered: one(step, 'shooter.answered', what), hits: one(step, 'shooter.hits', what), id: one(step, 'shooter.id', what), dist: one(step, 'shooter.dist', what), x: one(step, 'shooter.x', what) };
}
/** The range with the shooter, presented and stepped STEPS steps: each step's reading. */
function play(bin: string, evidence: string, kinematic: boolean, planted: boolean, what: string): Reading[] {
  const h = probeHandles(bin, evidence, (logic) => rangeScene(evidence, logic, kinematic), what);
  const doc = DOC(kinematic ? 12 : 11);
  const scene = rangeScene(evidence, { shooter: { program: shooter(handleOf(h, RANGE, null, what), ASK), params: castParams(1, { writes: SHOOTER_WRITES as unknown as JsonObject }) } }, kinematic);
  const [shown, ran] = runShow(bin, scenario(evidence, [doc], [showCall(doc, scene), logicCall(doc, STEPS)], planted ? { planted: 'cast_answers_after_next_step' } : {}), what);
  presented(shown, what);
  const steps = showSteps(ran, STEPS, what);
  const wall = handleOf(h, RANGE, 'wall', what);
  const post = handleOf(h, RANGE, 'post', what);
  expect(wall, `${what}: the wall and the post are interned to different handles`).not.toBe(post);
  const r = steps.map((s) => readingAt(s, what));
  expect(r[READ]!.id, `${what}: the hit at step 31 names the wall's handle ${wall} (the post's is ${post})`).toBe(wall);
  return r;
}
/** The judge: the distance read at step 31 against the reference at the state step 30 read; each failure names the query and the step. */
function judge(d: number, reference: number, what: string): string[] {
  return Math.abs(d - reference) <= MM ? [] : [`${what}: ${RAY} reads ${d} m at step ${READ}; at the state step ${ASK} read (world step ${STATE}) the wall's face is ${reference} m away, ${(d - reference).toFixed(6)} m off`];
}

describe(`${ID} a logic item asks a ray between steps and reads the hit one step later, as physics.query answers it on the bake`, () => {
  it(`${ID} the shooter asks at step 30 and at step 31 reads one hit on the static wall at 10.000 m within 1 mm, naming its ID, equal to physics.query's ray probe at world step 60`, () => {
    const bin = binOf('show');
    const evidence = temp();
    const r = play(bin, evidence, false, false, 'the static range');
    const fails: string[] = [];
    for (let k = 0; k <= ASK; k++) if (r[k]!.answered !== 0) fails.push(`step ${k} reads ${r[k]!.answered} answers before any was asked or while step 30 runs`);
    const at = r[READ]!;
    if (at.answered !== 1) fails.push(`step 31 reads ${at.answered} answers, not the one ray step 30 asked`);
    if (at.hits !== 1) fails.push(`step 31's answer holds ${at.hits} hits, not one`);
    if (Math.abs(at.dist - 10) > MM) fails.push(`step 31's hit is ${at.dist} m away, not 10.000 m within 1 mm`);
    if (Math.abs(at.x - 10) > MM) fails.push(`step 31's hit point is at x = ${at.x} m, not on the wall's face at 10 m`);
    if (r[READ + 1]!.answered !== 0) fails.push(`step 32 reads ${r[READ + 1]!.answered} answers, though step 31 asked none`);
    none(fails, 'the shooter\'s readings');

    const store = temp();
    const w = rangeWorld(false);
    const [baked, q] = physics([
      { call: 'bake', world: w, steps: WORLD_STEPS, store },
      { call: 'query', world: w, steps: WORLD_STEPS, store, probe: { ray: { from: [0, 0, 0], dir: [1, 0, 0], max: 100 } }, state: { step: STATE }, expect: { ids: ['wall'] } },
    ]);
    expect(baked?.['ok'], `the range's world is baked into the store: ${show(baked)}`).toBe(true);
    expect(q?.['verdict'], `physics.query's ray probe at world step ${STATE} on the bake: ${show(q)}`).toBe('PASS');
    const result = obj(q!['result'], 'physics.query: result');
    expect(arr(result['ids'], 'physics.query: result.ids'), 'physics.query\'s ray names the wall alone').toEqual(['wall']);
    expect(result['step'], 'physics.query read the state after 60 world steps').toBe(STATE);
    const value = num(result['value'], 'physics.query: result.value');
    expect(Math.abs(at.dist - value), `the shooter's distance at step 31 (${at.dist} m) equals physics.query's (${value} m) within 1e-6 m`).toBeLessThanOrEqual(1e-6);
  }, TIMEOUT);

  it(`${ID} (planted cast_answers_after_next_step) with the wall kinematic at 1 m/s, the planted service reads 1/120 m short and the judge fails, naming the query and step 31`, () => {
    const bin = binOf('show');
    const evidence = temp();
    const scene = rangeScene(evidence, {}, true);
    const [baked] = physics([{ call: 'bake', scene: withoutLogic(scene), world: RANGE, steps: WORLD_STEPS }]);
    const wall = statesOf(baked!, 'wall', WORLD_STEPS + 1, 'the moving range\'s world, baked by deep-physics');
    const face = wall[STATE]!.pos[0] - WALL_HALF;
    expect(Math.abs(wall[STATE + 1]!.pos[0] - wall[STATE]!.pos[0] + 1 / 120), `the wall moves 1/120 m toward the origin each world step (state ${STATE}: ${wall[STATE]!.pos[0]} m, ${STATE + 1}: ${wall[STATE + 1]!.pos[0]} m)`).toBeLessThanOrEqual(1e-5);

    const real = play(bin, evidence, true, false, 'the moving range')[READ]!;
    expect([real.answered, real.hits], 'the real service answers step 30\'s ray with one hit at step 31').toEqual([1, 1]);
    none(judge(real.dist, face, 'the real service'), 'the real service against the moving wall');

    const planted = play(bin, evidence, true, true, 'the moving range, planted')[READ]!;
    expect([planted.answered, planted.hits], 'the planted service answers step 30\'s ray with one hit at step 31').toEqual([1, 1]);
    expect(Math.abs(real.dist - planted.dist - 1 / 120), `the planted service reads ${planted.dist} m, 1/120 m short of the real service's ${real.dist} m (within 1e-4 m)`).toBeLessThanOrEqual(1e-4);
    failsNaming(judge(planted.dist, face, 'the planted service'), [/ray from \(0, 0, 0\) along \+x/, /step 31/], 'the planted service that answers from the world after its next step');
  }, TIMEOUT);
});
