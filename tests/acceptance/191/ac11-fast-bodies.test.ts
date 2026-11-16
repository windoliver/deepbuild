// Criterion 11: a sphere of radius 0.05 m with `ccd: true`, fired at 200 m/s along +x from 10 m before a static wall
// 0.02 m thick and 2 m tall, at 120 Hz and 4 substeps (1.667 m a step), never passes the wall's far face and writes its
// first contact at (10 − 0.05) ÷ 200 = 0.04975 s, step 6, within one step; a planted wrapper that turns swept collision off
// for the whole world, ignoring `solver.ccd: true`, ends past the wall and fails, naming the body and the step it crossed;
// and in a playtest run of the same fixture with `ccd` off, `physics.fast_body` names the body, step 1, its 1.667 m move
// and its 0.05 m half extent, while it raises none with `ccd` on or for a ball rolling at 2 m/s (0.017 m a step).
import { describe, expect, test } from 'vitest';
import {
  AC, BALL_RADIUS, BALL_SPEED, RATE, TIMEOUT, WALL_FAR, bake, caught, failFailures, firstBetween, fixturesOf, isObject,
  kitCall, kitReport, none, num, obj, one, physics, prebuild, resultOf, rollingBallWorld, rowsOf, show, statesOf,
  fastBallWorld, type JsonObject,
} from './helpers.ts';

prebuild(['shipped']);
const STEPS = RATE; // one second: the ball reaches the wall in its sixth step
const CONTACT_STEP = 6;

/** Everything wrong with the fast ball's bake: its centre past the far face at any step, or its first contact off step 6 ± 1. */
function wallFailures(reply: JsonObject, what: string): string[] {
  const out: string[] = [];
  const states = statesOf(reply, 'ball', what);
  const past = states.findIndex((s) => s.pos[0] > WALL_FAR);
  if (past >= 0) out.push(`${what}: the ball's centre is past the wall's far face (x = ${WALL_FAR}) at step ${past}: x = ${states[past]!.pos[0]}`);
  const first = firstBetween(rowsOf(reply, what), 'contact_begin', 'ball', 'wall');
  if (!first) out.push(`${what}: no contact_begin between ball and wall`);
  else if (Math.abs(first.step - CONTACT_STEP) > 1) out.push(`${what}: first contact at step ${first.step}, not step ${CONTACT_STEP} (0.04975 s) within one step`);
  return out;
}

/** The `physics.fast_body` issues a bake raised (a playtest run bakes, so it reads the lint there). */
function fastBodyIssues(reply: JsonObject, what: string): JsonObject[] {
  expect(reply['ok'], `${what} is baked: ${show(reply)}`).toBe(true);
  const issues = Array.isArray(reply['issues']) ? reply['issues'] : null;
  expect(issues, `${what}: the bake lists the issues its lints raised (issues)`).not.toBeNull();
  return issues!.filter((i): i is JsonObject => isObject(i) && i['code'] === 'physics.fast_body');
}

describe(`${AC[11]} a fast sphere with ccd never passes a thin wall, and physics.fast_body flags it with ccd off`, () => {
  test(`${AC[11]} with ccd on, the ball never passes the far face and first touches the wall at step 6 within one step; the kit's ccd_wall passes`, () => {
    const [baked, report] = physics([bake(fastBallWorld(true), STEPS), kitCall()]);
    none(wallFailures(baked!, 'the ccd ball'), 'the ccd ball on rapier3d');
    expect(resultOf(kitReport(report!, 'behavior_kit'), 'ccd_wall', 'rapier3d').result, 'the kit\'s ccd_wall passes on rapier3d').toBe('pass');
  }, TIMEOUT);

  test(`${AC[11]} a planted wrapper turning swept collision off for the world ends past the wall, and ccd_wall fails naming the body and the step it crossed`, () => {
    const [fixtures, baked, report] = physics([{ call: 'behavior_fixtures' }, bake(fastBallWorld(true), STEPS), kitCall()], { planted: 'swept_collision_off' });
    const mine = wallFailures(baked!, 'the ccd ball, swept collision off');
    caught(mine, 'the planted wrapper that ignores solver.ccd');
    const end = statesOf(baked!, 'ball', 'the ccd ball, swept collision off').at(-1)!;
    expect(end.pos[0], 'the ball ends past the wall\'s far face').toBeGreaterThan(WALL_FAR);
    // The kit's own world: the step its dynamic body's centre first passes the static wall's far face, under the same wrapper.
    const fixture = fixturesOf(fixtures!, 'behavior_fixtures').find((f) => f.name === 'ccd_wall');
    expect(fixture, 'the interface holds ccd_wall').toBeDefined();
    const bodies = obj(fixture!.world['bodies'], 'ccd_wall: bodies');
    const ballId = Object.keys(bodies).find((id) => obj(bodies[id], id)['kind'] === 'dynamic')!;
    const wallId = Object.keys(bodies).find((id) => obj(bodies[id], id)['kind'] === 'static')!;
    const wall = obj(bodies[wallId], wallId);
    const shapes = obj(fixture!.world['shapes'], 'ccd_wall: shapes');
    const wallShape = obj(shapes[String(obj((wall['shapes'] as JsonObject[])[0], 'wall use')['shape'])], 'the wall\'s shape');
    const far = num((obj(wall['pose'], 'wall pose')['pos'] as number[])[0], 'wall x') + num((wallShape['half'] as number[])[0], 'wall half x');
    const theirs = one(bake(fixture!.world, STEPS, { read: [ballId] }), { planted: 'swept_collision_off' });
    const crossed = statesOf(theirs, ballId, 'ccd_wall\'s world, swept collision off').findIndex((s) => s.pos[0] > far);
    expect(crossed, 'in ccd_wall\'s own world the ball passes the far face under the wrapper').toBeGreaterThan(0);
    const r = resultOf(kitReport(report!, 'behavior_kit, swept collision off'), 'ccd_wall', 'planted wrapper');
    const failures = failFailures(r, r.backend);
    if (r.raw['body'] !== ballId || !r.what.includes(ballId)) failures.push(`ccd_wall's fail names body ${show(r.raw['body'])}, not ${ballId}: ${JSON.stringify(r.what)}`);
    if (r.raw['step'] !== crossed) failures.push(`ccd_wall's fail names step ${show(r.raw['step'])}, not ${crossed}, the step its ball crossed the far face`);
    none(failures, 'ccd_wall under the planted wrapper');
  }, TIMEOUT);

  test(`${AC[11]} physics.fast_body names the ball, step 1, its 1.667 m move and its 0.05 m half extent with ccd off, and nothing with ccd on or for a ball rolling at 2 m/s`, () => {
    const [off, on, rolling] = physics([bake(fastBallWorld(false), STEPS), bake(fastBallWorld(true), STEPS), bake(rollingBallWorld(), STEPS)]);
    const flagged = fastBodyIssues(off!, 'the ball with ccd off');
    const failures: string[] = [];
    if (flagged.length !== 1) failures.push(`${flagged.length} physics.fast_body issues with ccd off, one expected: ${show(flagged)}`);
    const i = flagged[0];
    if (i) {
      const move = BALL_SPEED / RATE;
      if (!Array.isArray(i['ids']) || !i['ids'].includes('ball')) failures.push(`the issue names ${show(i['ids'])}, not ball`);
      if (i['step'] !== 1) failures.push(`the issue names step ${show(i['step'])}, not 1`);
      if (typeof i['move'] !== 'number' || Math.abs(i['move'] - move) > 0.01 * move) failures.push(`the issue names a move of ${show(i['move'])} m, not ${move.toFixed(3)} m`);
      if (typeof i['half_extent'] !== 'number' || Math.abs(i['half_extent'] - BALL_RADIUS) > 1e-6) failures.push(`the issue names a half extent of ${show(i['half_extent'])} m, not ${BALL_RADIUS} m`);
    }
    none(failures, 'physics.fast_body with ccd off');
    expect(fastBodyIssues(on!, 'the ball with ccd on'), 'no physics.fast_body with ccd on').toEqual([]);
    expect(fastBodyIssues(rolling!, 'the rolling ball'), 'no physics.fast_body for a ball rolling at 2 m/s').toEqual([]);
  }, TIMEOUT);
});
