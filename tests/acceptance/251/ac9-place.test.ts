// #251.a96ef62b: "A vehicle body rolled onto its roof at step 900 and placed upright at the last gate, its wheels at
// rest length above the floor, reads 0 m/s on the next step and contact on all four wheels within 0.5 s, and settles
// to the sag fixture's 0.0621 m within 2% after 3 s; a seek from the checkpoint before step 900 to step 1,200 gives the
// same step hashes as a straight run; a planted place that keeps each wheel's spin rate fails, naming the wheel, and
// one that keeps the angular velocity fails, naming the body"
//
// The course (README: The lap) with the lap's entries before step 840, then: at 840 drive, steer and brake 0, so it
// coasts with its wheels spinning; at 860 a recorded `launch` from an upside-down pose with its roof 1 cm over the
// floor, turning 360 deg/s about +Y, so it lies on its roof at step 900, still turning, its wheels in the air keeping
// their spin; at 900 `place` at the last gate, upright, the chassis 2 cm higher than where its wheels, at rest length,
// would just touch the floor. The bake runs 1,260 steps (3 s after the place). Read after the place's step (901): the
// kart's speed is 0 but for one step of gravity (at most g ÷ 120 + 1 mm/s), its turn rate 0 (at most 0.1 deg/s), its
// pose at the gate and upright, each wheel's spring at rest length with its hub above the floor, and each wheel's
// spin_rate 0 (its own state, `vehicles`; rest). Each wheel's contact_count reads 1 by step 960 (0.5 s), and each
// spring is 0.0621 m short within 2% at step 1,260. The seek restores the straight bake's checkpoint at step 840 and
// steps to 1,200 on the same track. `place_keeps_spin_rate` and `place_keeps_angular_velocity` keep what they say.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, G, HALF, LAP_TRACK, RADIUS, REST, REST_Y, SAG, SAG_TOLERANCE, TIMEOUT, WHEEL_NAMES, arr, ask, bakeRun, brake, caught, drive, entryOf,
  fmt, hashesOf, kartOf, lapWorld, length, naming, near, none, num, obj, place, prebuild, springLength, steer, upness, vehiclesOf,
  wheelContacts, wheelPoses, type JsonObject, type Planted, type V3,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[9];
const COAST = 840;
const ROLL = 860;
const PLACE = 900;
const AFTER = PLACE + 1;
const CONTACT_BY = PLACE + 60;
const SETTLED = PLACE + 360;
const RUN = SETTLED;
const SEEK_TO = 1200;
const GATE: V3 = [-20, REST_Y + 0.02, 20];
const GATE_ROT: V3 = [0, 90, 0];
const TRACK: JsonObject[] = [
  ...LAP_TRACK.filter((e) => num(e['step'], 'an entry\'s step') < COAST),
  drive(COAST, 0), steer(COAST, 0), brake(COAST, 0),
  entryOf(ROLL, 'launch', { from: { pos: [6, HALF[1] + 0.01, 6], rot: [0, 0, 180] }, linear: [0, 0, 0], angular: [0, 360, 0] }),
  place(PLACE, GATE, GATE_ROT),
];
const bakeCall = (): JsonObject => bakeRun(lapWorld(), RUN, TRACK, { checkpoints: true });

/** Everything the place should have done, each failure naming the body or the wheel. */
function placeFailures(planted?: Planted): string[] {
  const [r] = ask([bakeCall()], planted, 'the kart placed at the last gate');
  const s = kartOf(r!, RUN + 1, 'the kart placed at the last gate');
  const v = vehiclesOf(r!, 'kart', RUN + 1, 'the kart placed at the last gate');
  const poses = wheelPoses(r!, RUN + 1, 'the kart placed at the last gate');
  const contacts = wheelContacts(r!, RUN + 1, 'the kart placed at the last gate');
  expect(upness(s[PLACE]!), `the kart lies on its roof at step ${PLACE}`).toBeLessThan(-0.9);
  expect(length(s[PLACE]!.angular), `the kart still turns on its roof at step ${PLACE} (deg/s)`).toBeGreaterThan(30);
  expect(v[PLACE]!.wheels.some((w) => Math.abs(w.spinRate) > 0.5), `the kart's wheels still spin in the air at step ${PLACE}: ${JSON.stringify(v[PLACE]!.wheels)}`).toBe(true);
  const a = s[AFTER]!;
  const f: string[] = [];
  const speed = length(a.linear);
  if (speed > G / 120 + 0.001) f.push(`kart moves at ${fmt(speed)} m/s after the place's step, not 0 (at most one step of gravity, ${fmt(G / 120)} m/s)`);
  const turn = length(a.angular);
  if (turn > 0.1) f.push(`kart turns at ${fmt(turn)} deg/s (angular velocity) after the place's step, not 0`);
  const off = Math.hypot(a.pos[0] - GATE[0], a.pos[2] - GATE[2]);
  if (off > 0.01 || Math.abs(a.pos[1] - GATE[1]) > 0.01) f.push(`kart is at ${a.pos.map((x) => fmt(x)).join(', ')} after the place's step, not at the gate ${GATE.join(', ')}`);
  if (upness(a) < 0.999) f.push(`kart isn't upright after the place's step: its up is ${fmt(upness(a))} of +Y`);
  for (const n of WHEEL_NAMES) {
    const len = springLength(a, n, poses[n][AFTER]!);
    if (Math.abs(len - REST) > 0.001) f.push(`wheel ${n}'s spring is ${fmt(len)} m after the place's step, not its rest length ${REST} m`);
    if (poses[n][AFTER]!.pos[1] - RADIUS <= 0) f.push(`wheel ${n} isn't above the floor after the place's step: its hub is at y ${fmt(poses[n][AFTER]!.pos[1])}`);
    const w = v[AFTER]!.wheels.find((x) => x.name === n);
    if (!w) f.push(`wheel ${n} isn't in the kart's own state`);
    else if (Math.abs(w.spinRate) > 1e-6) f.push(`wheel ${n}'s spin_rate is ${fmt(w.spinRate)}° after the place's step, not 0 (at rest)`);
    const touched = contacts[n].slice(AFTER, CONTACT_BY + 1).findIndex((c) => c === 1);
    if (touched < 0) f.push(`wheel ${n}'s contact_count doesn't read 1 by step ${CONTACT_BY}, 0.5 s after the place`);
    const sag = REST - springLength(s[SETTLED]!, n, poses[n][SETTLED]!);
    if (!near(sag, SAG, SAG_TOLERANCE)) f.push(`wheel ${n}'s spring is ${fmt(sag)} m short at step ${SETTLED}, 3 s after the place, not ${SAG} m within 2%`);
  }
  return f;
}

describe(`${ID} a place puts a vehicle on its roof back upright at a gate at rest, and seeking across it equals playing`, () => {
  it(`${ID} rolled onto its roof at step 900 and placed upright at the last gate, it reads 0 m/s on the next step, contact on all four wheels within 0.5 s, and settles to 0.0621 m within 2% after 3 s`, () => {
    none(placeFailures(), 'the place at the last gate');
  }, TIMEOUT);

  it(`${ID} a seek from the checkpoint before step 900 to step 1,200 gives the same step hashes as a straight run`, () => {
    const [straight] = ask([bakeCall()], undefined, 'the kart placed at the last gate');
    const hashes = hashesOf(straight, 'the straight run');
    const cp = arr(obj(straight, 'the straight run')['checkpoints'], 'the straight run: checkpoints').map((c) => obj(c, 'a checkpoint'))
      .filter((c) => num(c['step'], 'a checkpoint\'s step') < PLACE).at(-1);
    expect(cp?.['step'], 'the checkpoint before step 900 is at step 840 (every 60)').toBe(COAST);
    const [sought] = ask([{ call: 'restore', world: lapWorld(), track: TRACK, checkpoint: cp!, steps: SEEK_TO - COAST, read: [] }], undefined, 'the seek from step 840');
    expect(hashesOf(sought, 'the seek from step 840'), `step hashes ${COAST} to ${SEEK_TO}, seeked and straight`).toEqual(hashes.slice(COAST, SEEK_TO + 1));
  }, TIMEOUT);

  it(`${ID} (twin: place_keeps_spin_rate) a place that keeps each wheel's spin rate fails, naming the wheel`, () => {
    const failures = placeFailures('place_keeps_spin_rate');
    caught(failures, 'place_keeps_spin_rate');
    naming(failures, /^wheel (fl|fr|rl|rr)'s spin_rate is /, 'place_keeps_spin_rate\'s failure names the wheel');
  }, TIMEOUT);

  it(`${ID} (twin: place_keeps_angular_velocity) a place that keeps the angular velocity fails, naming the body`, () => {
    const failures = placeFailures('place_keeps_angular_velocity');
    caught(failures, 'place_keeps_angular_velocity');
    naming(failures, /^kart turns at .* \(angular velocity\)/, 'place_keeps_angular_velocity\'s failure names the body');
  }, TIMEOUT);
});
