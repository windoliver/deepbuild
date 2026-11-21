// Criterion 3: big among small, in the same world: a 1 m ball of restitution 0.5 dropped with its lowest point 10 m up
// first bounces to 2.5 m within 3%, and a 1 cm cube sliding to rest from 0.2 m/s writes `rest` and sleeps within the
// world's sleep time plus 2 steps of its speed falling under 0.05 m/s. A planted wrapper that lets the length scale the
// backend's speed cap reads the ball's bounce more than 90% low and fails, naming the body, and one that lets it scale
// the sleep speed sleeps later than that and fails, naming the step.
import { describe, expect, test } from 'vitest';
import {
  AC, BALL, CUBE, TIMEOUT, ask, bake, bigBall, bounceRead, prebuild, sleepRead, sleeper, type Planted,
} from './helpers.ts';

prebuild(['release']);

const [BIG, SLEEPER] = [bigBall(), sleeper()];
const [RADIUS, ANSWER] = [0.5, 2.5];
const CAP: Planted = 'wrapper_scales_speed_cap';
const SLEEP: Planted = 'wrapper_scales_sleep_speed';
const dropped = bake(BIG.world, BIG.steps, { read: [BALL] });
const slid = bake(SLEEPER.world, SLEEPER.steps, { read: [CUBE] });

describe(`${AC[3]} big among small: a world's speeds stay in m/s at length_unit 0.01`, () => {
  test(`${AC[3]} a 1 m ball dropped 10 m first bounces to 2.5 m within 3%, and a 1 cm cube sliding to rest from 0.2 m/s writes rest within the world's sleep time plus 2 steps of its speed falling under 0.05 m/s`, () => {
    const run = ask([dropped, slid]);
    expect(run.problem, `${run.what} answers`).toBe('');
    const bounced = bounceRead(run.replies[0]!, BIG.steps, RADIUS, ANSWER, 'the 1 m ball');
    const slept = sleepRead(run.replies[1]!, SLEEPER.steps, 'the 1 cm cube');
    if (bounced.height !== null) console.log(`the 1 m ball: first bounce ${bounced.height.toFixed(4)} m beside ${ANSWER} m (${((bounced.height / ANSWER - 1) * 100).toFixed(2)}%)`);
    if (slept.under !== null) console.log(`the 1 cm cube: under 0.05 m/s from step ${slept.under}, rest at step ${String(slept.rest)}, due by step ${String(slept.due)}`);
    const failures = [...bounced.failures, ...slept.failures];
    expect(failures, `big among small at step_rate 480, contact_hz 240 and length_unit 0.01:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  test(`${AC[3]} a planted wrapper that lets the length scale the backend's speed cap reads the ball's bounce more than 90% low and fails, naming the body`, () => {
    const run = ask([dropped], { planted: CAP });
    expect(run.problem, `${run.what} answers`).toBe('');
    const bounced = bounceRead(run.replies[0]!, BIG.steps, RADIUS, ANSWER, `the 1 m ball under ${CAP}`);
    console.log(`planted ${CAP}: first bounce ${bounced.height === null ? 'unread' : `${bounced.height.toFixed(4)} m, ${((1 - bounced.height / ANSWER) * 100).toFixed(1)}% low`}`);
    expect(bounced.height === null ? bounced.failures.join('; ') : bounced.height < 0.1 * ANSWER, 'the planted wrapper\'s bounce reads more than 90% low of 2.5 m').toBe(true);
    expect(bounced.failures.some((f) => f.startsWith(`${BALL}:`)), `the judge that passes the real program fails on the planted wrapper, naming the body:\n  ${bounced.failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);

  test(`${AC[3]} a planted wrapper that lets the length scale the sleep speed sleeps later than the world's sleep time plus 2 steps and fails, naming the step`, () => {
    const run = ask([slid], { planted: SLEEP });
    expect(run.problem, `${run.what} answers`).toBe('');
    const slept = sleepRead(run.replies[0]!, SLEEPER.steps, `the 1 cm cube under ${SLEEP}`);
    if (slept.under !== null) console.log(`planted ${SLEEP}: under 0.05 m/s from step ${slept.under}, rest at step ${String(slept.rest)}, due by step ${String(slept.due)}`);
    expect(slept.rest === null || slept.due === null ? slept.failures.join('; ') : slept.rest > slept.due, 'the planted wrapper writes rest, later than the world\'s sleep time plus 2 steps of the speed falling under 0.05 m/s').toBe(true);
    expect(slept.failures.some((f) => f.startsWith(`${CUBE}:`) && f.includes(`step ${String(slept.rest)}`)), `the judge that passes the real program fails on the planted wrapper, naming the step:\n  ${slept.failures.join('\n  ')}`).toBe(true);
  }, TIMEOUT);
});
