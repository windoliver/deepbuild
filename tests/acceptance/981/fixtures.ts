// Each run's expected values from first principles (README: Scenes), and the runs as interface fixtures with their
// answers (README: Fixtures). A run's timeline is worked with the reservation rule: a vehicle asks for the next zone of
// its route (a junction with the zone after it) once its start lies within the horizon of its front; an ask that
// fails makes the zone's start its stop point, which, being past its braking distance, it reaches at rest on its
// rest-to-rest profile. Each check here throws when a scene doesn't give the timeline it was built for, so a fixture
// bug fails before any library runs.

import type { JsonObject, JsonValue, Program } from '../190/helpers.ts';
import type { Writes } from './programs.ts';
import {
  FORKS_LOW, LIFT, LOOP, LOOP_DETOUR, LOOP_V0_AT, MERGE, RACK_LEVEL, STRAIGHT, along, attemptStep, bay, horizon, junctionReach, lengthOf, loopRoute, pathZones, polyline,
  profile, routeZones, stepEnding, type Pt, type Scene,
} from './scenes.ts';

const fail = (what: string): never => { throw Error(`fixture bug: ${what}`); };
const check = (ok: boolean, what: string): void => { if (!ok) fail(what); };
const dtOf = (s: Scene): number => 1 / s.rate;
/** The world time at the end of step k (README: Steps): go at step k advances the world from k·dt to (k + 1)·dt. */
export const endOf = (s: Scene, k: number): number => (k + 1) * dtOf(s);
const point = (p: Pt): number[] => [p[0], p[1]];

// ---------------------------------------------------------------------------------------------------
// Criterion 1: the straight edge.

export const STRAIGHT_STEPS = 140;
/** 20 m at a 2 m/s limit, 1 m/s² each way: up 2 s over 2 m, 16 m at 2 m/s in 8 s, down 2 s over 2 m: 12 s. */
export function straightRun() {
  const v = STRAIGHT.vehicle, limit = STRAIGHT.paths[0]!.speed;
  const p = profile(20, Math.min(v.speed, limit), v.accel, v.decel);
  check(Math.abs(p.time - 12) < 1e-12 && p.at(2) === 2 && p.at(10) === 18 && p.at(12) === 20, 'the profile is 2 s up over 2 m, 8 s at 2 m/s over 16 m, 2 s down over 2 m');
  const pos = Array.from({ length: STRAIGHT_STEPS }, (_, k) => [p.at(endOf(STRAIGHT, k)), 0]);
  const arrival = stepEnding(p.time, dtOf(STRAIGHT));
  return { pos, arrival };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 2: the merge.

export const MERGE_STEPS = 220;
export const MERGE_ROUTES = [['+a', '+c1', '+c2'], ['+b', '+c1']];
/**
 * Both vehicles start at rest 20 m from J and run the same profile, so their horizons reach J's zone at one step; vehicle
 * 0 asks first (lower ID) and takes J with c1.0; vehicle 1's ask fails and it comes to rest with its front at J's zone,
 * its centre at J's zone start less half its length. It goes at the step vehicle 0's rear passes the end of c1.0, the
 * zone after J, in which step vehicle 0 releases it before vehicle 1 asks.
 */
export function mergeRun() {
  const v = MERGE.vehicle, dt = dtOf(MERGE), h = horizon(v, dt), half = v.length / 2;
  const zones = MERGE_ROUTES.map((r) => routeZones(MERGE, r));
  const lines = MERGE_ROUTES.map((r) => polyline(MERGE, r));
  const j = zones[0]!.find((z) => z.junction)!;
  check(j.name === 'junction:a,b,c1' && j.from === 20 - junctionReach(v), 'J is the merge\'s one junction');
  const after = zones[0]![zones[0]!.indexOf(j) + 1]!;
  check(after.name === 'c1.0' && zones[1]![zones[1]!.findIndex((z) => z.junction) + 1]!.name === 'c1.0', 'c1.0 is the zone after J on both routes');
  const free0 = profile(lengthOf(lines[0]!), v.speed, v.accel, v.decel);
  check(Math.abs(free0.distance - 36.25) < 1e-12 && Math.abs(lengthOf(lines[1]!) - 26.25) < 1e-12, 'the routes are 36.25 m and 26.25 m');
  const ask = attemptStep(free0, half, j.from, h, dt);
  const stop = j.from - half;
  const toStop = profile(stop, v.speed, v.accel, v.decel);
  check(stop - toStop.at(ask * dt) >= (v.speed * v.speed) / (2 * v.decel), 'vehicle 1 learns of J past its braking distance');
  const rests = stepEnding(toStop.time, dt);
  const leaves = free0.reach(after.to + half);
  const goes = stepEnding(leaves, dt);
  check(Math.abs(leaves / dt - Math.round(leaves / dt)) > 0.1, 'vehicle 0 leaves c1.0 inside a step');
  check(goes - rests > 10, 'vehicle 1 waits a while');
  const rest1 = profile(lengthOf(lines[1]!) - stop, v.speed, v.accel, v.decel);
  const t0 = goes * dt;
  const at = (k: number): [number[], number[]] => {
    const T = endOf(MERGE, k);
    const s1 = T <= t0 ? toStop.at(T) : stop + rest1.at(T - t0);
    return [point(along(lines[0]!, free0.at(T)).p), point(along(lines[1]!, s1).p)];
  };
  const stopAt = along(lines[1]!, stop).p;
  check(Math.abs(stopAt[0]) < 1e-12 && Math.abs(stopAt[1] + 2.25) < 1e-12, 'vehicle 1 waits with its centre at (0, −2.25)');
  return { ask, rests, goes, stopAt, junction: j.name, at };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 3: the loop of four junctions.

export const LOOP_STEPS = 400;
/** Each vehicle's goal: vehicle i to park.(i + 2). */
export const loopGoal = (i: number): number => bay(LOOP, `park.${(i + 2) % 4}`);
/**
 * Vehicles 1 to 3 start at step 0 and vehicle 0 at step 10. Each asks for N_i (with s_i) at the same distance, so 1 to 3
 * at one step and 0 ten steps later, before 3 asks for N0; each holds its side s_i, one zone long. Thirty steps later
 * 1, 2 and 3 ask for N_{i+1} with s_{i+1} and fail, each on the next one's side, and come to rest at N_{i+1}'s zone.
 * Ten steps after that vehicle 0 asks for N1 with s1, held by 1: the loop 0 → 1 → 2 → 3 → 0 forms at that ask, and
 * vehicle 0, its lowest ID, takes at once its next quickest route avoiding s1.0: out at N1 by l1 and round the ring
 * to park.2, every zone of which is free when it asks; so it never brakes, and runs its rest-to-rest profile over the
 * detour from step 10. Then 3 takes s0 once 0 has left it, 2 takes s3, 1 takes s2, and each reaches its goal.
 */
export function loopRun() {
  const v = LOOP.vehicle, dt = dtOf(LOOP), h = horizon(v, dt), half = v.length / 2;
  const route = loopRoute(1), zones = routeZones(LOOP, route);
  const juncs = zones.filter((z) => z.junction);
  const free = profile(lengthOf(polyline(LOOP, route)), v.speed, v.accel, v.decel);
  check(Math.abs(free.distance - 36) < 1e-9, 'each vehicle\'s quickest route is 36 m');
  const enter = attemptStep(free, half, juncs[1]!.from, h, dt);
  const ask = attemptStep(free, half, juncs[2]!.from, h, dt);
  const enter0 = enter + LOOP_V0_AT, ask0 = ask + LOOP_V0_AT;
  check(enter0 < ask && ask0 > ask, 'vehicle 0 holds s0 before vehicle 3 asks for it, and asks for N1 after the others failed');
  check(stepEnding(free.reach(juncs[1]!.to + half), dt) < ask0, 'vehicle 1 has left N1 when vehicle 0 asks for it');
  const detour = polyline(LOOP, LOOP_DETOUR);
  const d0 = profile(lengthOf(detour), v.speed, v.accel, v.decel);
  check(Math.abs(d0.distance - (30 + 6 + 6 * Math.SQRT2)) < 1e-9, 'the detour is 30 m of links, sides and spurs and the 6 + 6√2 m ring side');
  const stop = juncs[2]!.from - half;
  const toStop = profile(stop, v.speed, v.accel, v.decel);
  check(stop - toStop.at(ask * dt) >= (v.speed * v.speed) / (2 * v.decel), 'vehicles 1 to 3 learn of their junction past their braking distance');
  const rests = stepEnding(toStop.time, dt);
  const t0 = LOOP_V0_AT * dt;
  /** Vehicle 0's centre at the end of step k: at park.0 until it is sent, then on its profile over the detour. */
  const v0 = (k: number): number[] => point(along(detour, d0.at(endOf(LOOP, k) - t0)).p);
  /** Vehicles 1 to 3 at rest at N_{i+1}'s zone, their centres half a length short of it along their routes. */
  const waiting = [1, 2, 3].map((i) => point(along(polyline(LOOP, loopRoute(i)), stop).p));
  // Vehicle 3 waits for s0.0 until vehicle 0's rear leaves it, in a step after the others came to rest.
  const s0 = routeZones(LOOP, LOOP_DETOUR).find((z) => z.name === 's0.0')!;
  const v3goes = stepEnding(d0.reach(s0.to + half) + t0, dt);
  check(v3goes > rests + 2, 'the three others are at rest before vehicle 3 goes');
  const lines = [0, 1, 2, 3].map((i) => polyline(LOOP, loopRoute(i)));
  /** Every vehicle's centre at the end of step k, for k before vehicle 3 goes (each at rest at park.i until it is sent). */
  const all = (k: number): number[][] => [v0(k), ...[1, 2, 3].map((i) => point(along(lines[i]!, toStop.at(endOf(LOOP, k))).p))];
  return { ask, ask0, rests, v0, waiting, v3goes, all, arrives0: stepEnding(d0.time + t0, dt) };
}

/** Criterion 3's wrong run: on the straight edge, vehicle 0 parked at rack.b for good and vehicle 1 sent there from park.a. */
export const STUCK_STEPS = 710;
/**
 * Vehicle 1 (top speed 3, limit 2) asks for e.7 [17.5, 20], held by vehicle 0 parked at rack.b, past its braking
 * distance, and comes to rest with its centre at 16.5 m at 10.25 s, inside step 102: it waits from step 102 on, for good.
 * lanes.stuck counts a wait in whole steps (README: Kind rules): 600 steps at 10 Hz are 60 s, not past the limit; at step
 * 102 + 600 = 702 its wait, 601 steps, is past 60 s.
 */
export function stuckRun() {
  const v = STRAIGHT.vehicle, dt = dtOf(STRAIGHT), half = v.length / 2;
  const z = pathZones(STRAIGHT, 'e');
  check(z.zones.length === 8 && z.zones[7]![0] === 17.5, 'e is cut into 8 zones of 2.5 m, the last from 17.5 m');
  const stop = z.zones[7]![0] - half;
  const p = profile(stop, Math.min(v.speed, STRAIGHT.paths[0]!.speed), v.accel, v.decel);
  const waits = stepEnding(p.time, dt);
  check(Math.abs(p.time - 10.25) < 1e-12 && waits === 102, 'vehicle 1 is at rest at 16.5 m from 10.25 s, step 102');
  return { stop: [stop, 0], waits, fails: waits + 600 };
}

// ---------------------------------------------------------------------------------------------------
// Criterion 4: the lift.

export const LIFT_STEPS = 260;
/** The forks' point: the vehicle's front centre at the fork height, as a load's position (README: Arrays): [x, height, y]. */
export const forksPoint = (pos: number[], heading: number, fork: number, half: number): number[] => [pos[0]! + half * Math.cos(heading), fork, pos[1]! + half * Math.sin(heading)];
/** 0.1 m to 5.4 m at 1 m/s: 5.3 s. The load set down at rack.r keeps the forks' point there: 1 m past (10.1, 0), at 5.4 m. */
export function liftRun() {
  const v = LIFT.vehicle, rise = (RACK_LEVEL - FORKS_LOW) / v.lift!.speed;
  check(Math.abs(rise - 5.3) < 1e-12, '5.3 m at 1 m/s is 5.3 s');
  const rack = LIFT.bays['rack.r']!;
  const pose = [rack[0] + v.length / 2, RACK_LEVEL, rack[1]];
  const leg = profile(rack[0], v.speed, v.accel, v.decel);
  check(Math.abs(((leg.time + 0.1) / 0.1) % 1 - 0.5) < 0.1, 'the vehicle comes to rest at the rack inside a step');
  /** Its centre while it drives to the rack, sent at step 1. */
  const drive = (k: number): number[] => [leg.at(endOf(LIFT, k) - 0.1), 0];
  return { rise, pose, drive, arrives: stepEnding(leg.time + 0.1, 0.1) };
}

// ---------------------------------------------------------------------------------------------------
// Pieces and fixtures (README: Fixtures).

/** A scene's floor paths as path@1 items (README: Piece): straight lines, metres on the floor. */
export const pathItems = (s: Scene): JsonObject => Object.fromEntries(s.paths.map((p) => [p.id, {
  kind: 'path@1', params: { verbs: ['M', ...p.pts.slice(1).map(() => 'L')], pts: p.pts.flat() },
}]));
/** A scene's `lanes` param (README: Piece). */
const lanesParam = (s: Scene): JsonObject => ({
  graph: {
    paths: s.paths.map((p) => p.id), two_way: s.paths.filter((p) => p.twoWay).map((p) => p.id),
    speed: Object.fromEntries(s.paths.map((p) => [p.id, p.speed])), bays: Object.fromEntries(Object.entries(s.bays).map(([n, p]) => [n, [p[0], p[1]]])),
  },
  vehicle: s.vehicle as unknown as JsonObject,
});
export interface ItemSpec { program: Program; writes: Writes; scene: Scene; checkpoint?: number }
/** A logic item's params with no links: program, rate, writes, its lane graph and the largest fuel a step may take. */
export const itemParams = (i: ItemSpec): JsonObject => ({
  program: i.program.sha, step_rate: i.scene.rate, writes: i.writes as unknown as JsonObject, lanes: lanesParam(i.scene),
  budget: { fuel: 10_000_000 }, ...(i.checkpoint ? { checkpoint: { every: i.checkpoint } } : {}),
});
/** An interface fixture (#416's, with the other items of its piece: README: Fixtures). */
export interface Fixture { name: string; items: JsonObject; item: { kind: 'logic@1'; params: JsonObject }; track: JsonValue[]; steps: number; expect: { arrays: Record<string, Record<string, JsonValue[]>>; tolerance: JsonValue }; answer: string }
function fixture(name: string, i: ItemSpec, steps: number, arrays: Record<string, Record<string, JsonValue[]>>, answer: string): Fixture {
  return { name, items: pathItems(i.scene), item: { kind: 'logic@1', params: itemParams(i) }, track: [], steps, expect: { arrays, tolerance: { abs: 1e-6 } }, answer };
}
const every = (steps: number[], f: (k: number) => Record<string, JsonValue[]>): Record<string, Record<string, JsonValue[]>> => Object.fromEntries(steps.map((k) => [String(k), f(k)]));
const range = (a: number, b: number): number[] => Array.from({ length: b - a + 1 }, (_, i) => a + i);

const ANSWERS = {
  straight: 'One vehicle, top speed 3 m/s, on the 20 m two-way edge e with a 2 m/s limit, 1 m/s² up and down, at 10 Hz, sent from park.a to rack.b at step 0. The limit holds it to 2 m/s: up 2 s over 2 m (s = t²/2), 16 m at 2 m/s in 8 s (s = 2 + 2(t − 2)), down 2 s over 2 m (s = 20 − (12 − t)²/2): rest to rest in 12 s. Step k ends at t = (k + 1) × 0.1 s, so pos at step k is (s(t), 0), and it is at rest at rack.b from step 119.',
  merge: 'Lanes a (from park.w, 20 m west) and b (from park.s, 20 m south) meet c1 at the junction J (0, 0), whose zone reaches (2 + 0.5) ÷ 2 = 1.25 m along each; c1 is cut into c1.0 [1.25, 3.75] and c1.1 [3.75, 6.25]. Both vehicles start at rest, 2 m/s, 1 m/s² each way, horizon 2 × 0.1 + 2² ÷ 2 = 2.2 m, so both ask for J with c1.0 at step 88 (front at 15.6 + 1 m along); vehicle 0 asks first and takes them, vehicle 1 fails and comes to rest at 10.875 s (step 108) with its front at J\'s zone, centre (0, −2.25). Vehicle 0 runs on unchecked to dock.e (36.25 m, 20.125 s); its rear passes c1.0\'s end (centre 24.75 m along) at 13.375 s, in step 133, which releases c1.0, and vehicle 1 asks again in the same step and goes, on to rack.m (8.5 m more, from rest at 13.3 s).',
  loop: 'Four one-way sides of 6 m (one zone each, 6 − 2 × 1.25 = 3.5 m) between corner junctions N0..N3; links l_i, spurs p_i and the outer ring as drawn. Vehicle i goes from park.i to park.(i + 2) by s_i and s_{i+1}; 1 to 3 are sent at step 0, 0 at step 10. With a 2.2 m horizon each asks for N_i at 4.8 s after it is sent (centre 7.6 m along) and holds s_i; 1 to 3 ask for N_{i+1} at step 78, fail on the next one\'s side and come to rest at step 98, centre 15.75 m along; vehicle 0 asks for N1 at step 88 and fails on s1.0, held by 1, which closes the loop 0 → 1 → 2 → 3 → 0 at that step. Vehicle 0, the lowest ID, reroutes at once avoiding s1.0: out by l1, round o1, in by p2 (44.485 m from park.0), every zone free when asked, so it runs that rest-to-rest profile from 1.0 s unbroken and reaches park.2 at step 252. 3 goes at step 108, when 0\'s rear leaves s0.0, then 2 and 1; each reaches park.(i + 2).',
  lift: 'One vehicle with a 1 m/s mast at park.p. Step 0 lifts the forks from 0 to 0.1 m (one step); step 1 takes the load and sends it 10.1 m to rack.r (from 0.1 s, at rest at 7.15 s, step 71); the load rides the forks\' point, 1 m ahead of the centre at the fork height. Then it lifts 0.1 → 5.4 m at 1 m/s, 5.3 s; sets the load down at the forks\' point, (11.1, 5.4, 0) as [x, height, y]; lowers to 0.1 m and goes on to dock.d, the load staying at that pose.',
};

/** The straight run as a fixture: pos at every step. */
export const straightFixture = (i: ItemSpec): Fixture => {
  const r = straightRun();
  return fixture('straight', i, STRAIGHT_STEPS, every(range(0, STRAIGHT_STEPS - 1), (k) => ({ pos: [r.pos[k]!] })), ANSWERS.straight);
};
/** The merge as a fixture: both positions at every step but those of vehicle 1's braking (88 to 108). */
export const mergeFixture = (i: ItemSpec): Fixture => {
  const r = mergeRun();
  return fixture('merge', i, MERGE_STEPS, every([...range(0, r.ask - 1), ...range(r.rests + 1, MERGE_STEPS - 1)], (k) => ({ pos: r.at(k) })), ANSWERS.merge);
};
/** The loop as a fixture: every position before vehicle 3 goes, and every vehicle at its goal at the last step. */
export const loopFixture = (i: ItemSpec): Fixture => {
  const r = loopRun();
  const goals = [0, 1, 2, 3].map((v) => point(LOOP.bays[`park.${(v + 2) % 4}`]!));
  return fixture('loop', i, LOOP_STEPS, { ...every(range(0, r.v3goes - 1), (k) => ({ pos: r.all(k) })), [String(LOOP_STEPS - 1)]: { pos: goals } }, ANSWERS.loop);
};
/** The lift as a fixture: the forks at step 0, and the centre, forks and load at every step of the drive to the rack. */
export const liftFixture = (i: ItemSpec): Fixture => {
  const r = liftRun();
  return fixture('lift', i, LIFT_STEPS, every(range(1, r.arrives - 1), (k) => {
    const p = r.drive(k);
    return { pos: [p], fork: [FORKS_LOW], load: [forksPoint(p, 0, FORKS_LOW, LIFT.vehicle.length / 2)] };
  }), ANSWERS.lift);
};
