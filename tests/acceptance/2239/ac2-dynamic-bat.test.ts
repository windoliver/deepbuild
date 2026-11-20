// Criterion 2: the same bat as a dynamic body of 10 kg moving at 30 m/s with `ccd: true`, and the ball of 0.1 kg with
// `ccd` off, both of restitution 1 under the `max` rule: the ball is never behind the bat's leading face at the end of
// any step, it leaves at 2 × 10 ÷ 10.1 × 30 = 59.41 m/s within 1%, and the lint raises nothing. A planted wrapper that
// drops the body's `ccd` leaves the ball at rest behind the bat and fails, naming the ball and the step.
import { describe, expect, test } from 'vitest';
import {
  AC, BALL, BAT, BAT_HALF, BAT_SPEED, BAT_START, LEAVE_SPEED, RATE, TIMEOUT, bake, behindFailures, behindStep, dynamicBatWorld,
  leaveFailures, lintOf, physics, planted, prebuild, raisedFailures, statesOf, tolds, xs,
} from './helpers.ts';

prebuild(['release']);
/** A tenth of a second: the bat's leading face reaches the ball's centre in its fourth step. */
const STEPS = 12;
/** The step that carries the bat's leading face past the ball's centre when nothing stops it: 0.90 m at 0.25 m a step. */
const PASSES = Math.ceil((0 - (BAT_START + BAT_HALF)) / (BAT_SPEED / RATE));
const list = (failures: readonly string[]): string => `\n  ${failures.join('\n  ')}`;

describe(`${AC[2]} a dynamic bat with ccd holds a ball with ccd off, and the lint raises nothing`, () => {
  test(`${AC[2]} the ball is never behind the bat's leading face at the end of any step, it leaves at 59.41 m/s within 1%, and the lint raises nothing`, () => {
    expect(LEAVE_SPEED.toFixed(2), 'the worked answer, 2 × 10 ÷ 10.1 × 30 m/s').toBe('59.41');
    const [baked] = physics([bake(dynamicBatWorld(), STEPS)]);
    const what = 'the dynamic bat with ccd';
    console.log(`${what}: ${BAT} x ${xs(baked!, BAT, what)}; ${BALL} x ${xs(baked!, BALL, what)}; the ball leaves at ${statesOf(baked!, BALL, what).at(-1)!.linear[0].toFixed(3)} m/s, worked answer ${LEAVE_SPEED.toFixed(3)} m/s`);
    console.log(`${what}: physics.fast_body raises ${tolds(lintOf(baked!, what).raised)}`);
    const failures = [...behindFailures(baked!, what), ...leaveFailures(baked!, what), ...raisedFailures(baked!, what)];
    expect(failures, `${what}:${list(failures)}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[2]} a planted wrapper that drops the body's ccd leaves the ball at rest behind the bat and fails, naming the ball and step ${PASSES}`, () => {
    expect(PASSES, 'the bat\'s leading face is past the ball\'s centre after its fourth step').toBe(4);
    const twin = planted('wrapper_drops_body_ccd', [bake(dynamicBatWorld(), STEPS)]);
    expect(twin.refused, 'the planted wrapper runs').toBe('');
    const baked = twin.replies[0]!;
    const what = 'the planted wrapper';
    console.log(`planted wrapper_drops_body_ccd: ${BAT} x ${xs(baked, BAT, what)}; ${BALL} x ${xs(baked, BALL, what)}`);
    // It leaves the ball at rest behind the bat: where it was built, not moving, the bat's leading face beyond it.
    const [bat, ball] = [statesOf(baked, BAT, what).at(-1)!, statesOf(baked, BALL, what).at(-1)!];
    expect(Math.hypot(...ball.pos) <= 1e-6 && Math.hypot(...ball.linear) <= 1e-6, `the planted wrapper leaves the ball at rest: it ends at x = ${ball.pos[0]} m moving ${ball.linear[0]} m/s`).toBe(true);
    expect(bat.pos[0] + BAT_HALF, 'the planted wrapper leaves the ball behind the bat\'s leading face').toBeGreaterThan(ball.pos[0]);
    const failures = behindFailures(baked, what);
    console.log(`planted wrapper_drops_body_ccd fails:${list(failures)}`);
    expect(failures.length, 'the judge of the real wrapper fails on the planted one').toBeGreaterThan(0);
    expect(behindStep(baked, what), 'the step the ball is first behind the bat\'s leading face').toBe(PASSES);
    expect(failures.some((f) => f.startsWith(`${BALL}:`) && f.includes(`step ${PASSES}`)), `a failure names the ball and step ${PASSES}:${list(failures)}`).toBe(true);
  }, TIMEOUT);
});
