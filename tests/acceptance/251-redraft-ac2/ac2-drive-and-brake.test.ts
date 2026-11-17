// #251.acf8ab9a, blind redraft: drive and brake. Settled on level ground with its rear wheels driving, a drive of
// 2,000 N from rest reaches 4.00 m/s at 2 s within 2%; from rest and asleep, one of −2,000 N wakes it and reaches 4.00
// m/s backwards at 2 s within 2%; from 10 m/s a brake of 4,000 N, with that drive of 2,000 N still held, stops it
// 12.5 m on (m × v² ÷ 2F) within 3%, and it never rolls backwards after; a planted brake that gives each braking wheel
// the whole force stops it in 3.125 m and fails, naming the body.
//
// The fixtures and readings are the README's. Each test is one bake in its own deep-physics process.
import { describe, expect, it } from 'vitest';
import {
  BODY, BRAKE_STEPS, DRIVE, DRIVE_SPEED, ID, PLANTED_STOP, PLANTED_TOLERANCE, READ, TIMEOUT, brakeFailures, brakeTrack,
  caught, driveFailures, driveTrack, naming, none, prebuild, resting, rolling, run, sleepFailures, stopOf,
} from './helpers.ts';

prebuild();

describe(`${ID} drive and brake`, () => {
  it(`${ID} (drive) settled and awake, a drive of 2,000 N from rest reaches 4.00 m/s along its heading at 2 s, within 2%`, () => {
    const { states } = run(resting(false), READ, driveTrack(DRIVE), 'the drive from rest');
    none(driveFailures(states, DRIVE_SPEED), 'a drive of 2,000 N from rest');
  }, TIMEOUT);

  it(`${ID} (from sleep) settled and asleep, a drive of −2,000 N wakes it and reaches 4.00 m/s backwards at 2 s, within 2%`, () => {
    const { states, rows } = run(resting(true), READ, driveTrack(-DRIVE), 'the drive from sleep');
    none([...sleepFailures(rows), ...driveFailures(states, -DRIVE_SPEED)], 'a drive of −2,000 N from rest and asleep');
  }, TIMEOUT);

  it(`${ID} (brake) from 10 m/s a brake of 4,000 N, the drive of 2,000 N still held, stops it 12.5 m on within 3%, and it never rolls backwards after`, () => {
    const { states } = run(rolling(), BRAKE_STEPS, brakeTrack(), 'the brake');
    none(brakeFailures(states), 'a brake of 4,000 N from 10 m/s with a drive of 2,000 N held');
  }, TIMEOUT);

  it(`${ID} (twin: brake_whole_force_each_wheel) a planted brake that gives each braking wheel the whole force stops it in 3.125 m and fails, naming the body`, () => {
    const { states } = run(rolling(), BRAKE_STEPS, brakeTrack(), 'the brake', 'brake_whole_force_each_wheel');
    const failures = brakeFailures(states);
    caught(failures, 'brake_whole_force_each_wheel, judged on the brake from 10 m/s');
    naming(failures, new RegExp(`^${BODY} stops `), 'brake_whole_force_each_wheel fails on its stop, naming the body');
    const stop = stopOf(states).distance;
    expect(Math.abs(stop - PLANTED_STOP) <= PLANTED_STOP * PLANTED_TOLERANCE,
      `brake_whole_force_each_wheel stops it ${stop} m on, ${PLANTED_STOP} m within ${PLANTED_TOLERANCE * 100}% (each of four wheels braking 4,000 N)`).toBe(true);
  }, TIMEOUT);
});
