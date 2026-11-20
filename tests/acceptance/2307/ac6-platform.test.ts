// #2307.fd4b6bbc: "With #2306, the car braked at 4,000 N on a kinematic platform that reaches 2 m/s along the car's
// heading in 1 s and holds it for 2 s ends within 0.02 m of its place on it, where brakes without the hold leave it
// 0.34 m short. A car asleep on a platform that starts to move at step 600 wakes on that step and ends within 0.02 m of
// its place. A planted wrapper that leaves it asleep leaves it behind and fails, naming the body and the step"
//
// The platform (README: The worlds, the platform) is #2306's: a kinematic body of a scene's world `ride` following the
// channel `deck`, with nothing under it; the car is set down on its middle with every spring at rest length, heading
// +Z, a brake of 4,000 N stamped at step 0. The channel stands still through a start step, then takes the platform
// from rest to 2 m/s along +Z over 1 s and holds 2 m/s for 2 s, 5 m in all. The car's place on the platform is its
// position less the platform's, on the ground plane (x, z); how far it ends from its place is that offset 3 s after the
// start step against the offset at the start step. Awake: sleep off, the platform starts after step 240, once the car
// has settled. Asleep: the car's `sleep` left on, the platform starts after step 600, by when the car has written
// `rest`; the platform first moves in the step from the state after 600 steps to the state after 601 (#522's
// convention, as an entry stamped at step 600 applies), so the car's `wake` row is on step 601.
// `leaves_asleep_on_moving_ground` leaves the car asleep when the platform under its wheels moves.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, PER_STEP, RAMP_STEPS, RAMP_TRAVEL, TIMEOUT, asleepAfter, bodyOf, brake, flat, fmt, parkScene, prebuildBuilds, rowsOf, run,
  sleepRows, sleepText, sub, type JsonObject, type Planted, type State,
} from './helpers.ts';

prebuildBuilds(['release']);

const ID = CRITERIA[6];
const WITHIN = 0.02;
const AWAKE_START = 240;
const ASLEEP_START = 600;

/** A bake of the scene's world `ride`, sampled once a step, to 3 s after the platform starts. */
const rideBake = (start: number, sleep: boolean): JsonObject =>
  ({ call: 'bake', scene: parkScene(start, { sleep }), world: 'ride', track: [brake(0, 4000)], steps: start + RAMP_STEPS, frame_rate: PER_STEP, read: ['kart', 'platform'] });
/** How far the car is from its place on the platform after step `k`: its offset from the platform then, against at step `start`. */
const offPlace = (car: State[], deck: State[], k: number, start: number): number => flat(sub(car[k]!.pos, deck[k]!.pos), sub(car[start]!.pos, deck[start]!.pos));
/** The platform's own move, so that a car on its place has been carried: 5 m along the car's heading. */
const travel = (deck: State[], start: number): number => deck[start + RAMP_STEPS]!.pos[2] - deck[start]!.pos[2];

interface Asleep { failures: string[]; off: number; stayed: number; woke: boolean }
/** The car asleep on the platform that starts to move after step 600. */
function asleepFailures(reply: JsonObject | undefined): Asleep {
  const what = 'the car asleep on the platform that starts to move at step 600';
  const end = ASLEEP_START + RAMP_STEPS;
  const car = bodyOf(reply, 'kart', end, what);
  const deck = bodyOf(reply, 'platform', end, what);
  const rows = rowsOf(reply, what);
  expect(asleepAfter(rows, ASLEEP_START), `${what} is asleep when the platform starts (its rest and wake rows: ${sleepText(rows)})`).toBe(true);
  expect(deck[ASLEEP_START]!.pos[2], 'the platform hasn\'t moved by step 600').toBe(deck[0]!.pos[2]);
  expect(deck[ASLEEP_START + 1]!.pos[2], 'the platform first moves in the step after 600 steps').toBeGreaterThan(deck[ASLEEP_START]!.pos[2]);
  expect(travel(deck, ASLEEP_START), 'the platform then moves 5 m along the car\'s heading').toBeCloseTo(RAMP_TRAVEL, 3);
  const woken = sleepRows(rows).find((r) => r.kind === 'wake' && r.step > ASLEEP_START);
  const failures: string[] = [];
  if (woken?.step !== ASLEEP_START + 1) failures.push(`kart: doesn't wake on step ${ASLEEP_START + 1}, the step the platform under it starts to move: its wake row is on step ${woken ? woken.step : 'none'}`);
  const off = offPlace(car, deck, end, ASLEEP_START);
  if (!(off <= WITHIN)) failures.push(`kart: asleep until the platform moved, ends ${fmt(off)} m from its place on it at step ${end}, not within 0.02 m`);
  return { failures, off, stayed: flat(car[end]!.pos, car[ASLEEP_START]!.pos), woke: woken !== undefined };
}

describe(`${ID} a car parked on a kinematic platform goes with it, braked and awake, or asleep until the platform moves`, () => {
  it(`${ID} braked at 4,000 N on a platform that reaches 2 m/s along its heading in 1 s and holds it 2 s, the car ends within 0.02 m of its place; asleep on a platform that starts to move at step 600, it wakes on that step and ends within 0.02 m of its place`, () => {
    const r = run([rideBake(AWAKE_START, false), rideBake(ASLEEP_START, true)]);
    expect(r.problem, 'deep-physics bakes the car on the platform, awake and asleep').toBe('');
    const what = 'the car braked on the platform, awake';
    const end = AWAKE_START + RAMP_STEPS;
    const car = bodyOf(r.replies[0], 'kart', end, what);
    const deck = bodyOf(r.replies[0], 'platform', end, what);
    expect(travel(deck, AWAKE_START), 'the platform moves 5 m along the car\'s heading').toBeCloseTo(RAMP_TRAVEL, 3);
    const off = offPlace(car, deck, end, AWAKE_START);
    const failures = off <= WITHIN ? [] : [`kart: braked at 4,000 N, ends ${fmt(off)} m from its place on the platform at step ${end}, not within 0.02 m`];
    const asleep = asleepFailures(r.replies[1]);
    console.log(`on the platform: awake, the braked car ends ${fmt(off)} m from its place; asleep until step 600, it ends ${fmt(asleep.off)} m from its place`);
    failures.push(...asleep.failures);
    expect(failures, `the car on the platform:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: leaves_asleep_on_moving_ground) a wrapper that leaves it asleep leaves it behind and fails, naming the body and the step`, () => {
    const planted: Planted = 'leaves_asleep_on_moving_ground';
    const r = run([rideBake(ASLEEP_START, true)], { planted });
    expect(r.problem, `deep-physics --planted ${planted} runs and bakes the car asleep on the platform`).toBe('');
    const asleep = asleepFailures(r.replies[0]);
    expect(asleep.failures.length, 'the planted wrapper is caught: the judge that passes the woken car finds it left').toBeGreaterThan(0);
    expect(asleep.failures.some((f) => f.startsWith(`kart: doesn't wake on step ${ASLEEP_START + 1}`)), `a failure names the body and the step: ${asleep.failures.join(' | ')}`).toBe(true);
    expect(asleep.woke, 'the planted wrapper leaves it asleep: no wake row names it after step 600').toBe(false);
    expect(asleep.stayed, `the planted wrapper leaves it behind: it ends ${fmt(asleep.stayed)} m from where it slept in the world, within 0.02 m, while the platform moved 5 m`).toBeLessThanOrEqual(WITHIN);
  }, TIMEOUT);
});
