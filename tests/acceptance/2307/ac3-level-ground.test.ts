// #2307.536a975c: "On level ground #251's fixtures read as they did: from 10 m/s a brake of 4,000 N stops the car in
// 12.5 m within 3% and it never moves backwards faster than 0.05 m/s, a drive of 2,000 N reaches 4.00 m/s at 2 s within
// 2%, and at 3 m/s with steer 15° the middle of the rear axle circles at 9.330 m within 3%. A planted hold that takes
// out a wheel's sideways slip itself, where the controller's grip already does, stops the turning car and fails, naming
// the turn fixture"
//
// #251's fixtures are the behavior kit's `vehicle_brake`, `vehicle_drive` and `vehicle_turn` (#251's README: Fixture
// names), each as the kit holds it: its world, its track and its steps, from `behavior_fixtures`. The judge reads each
// two ways. The kit's own row for it, from `behavior_kit`, reads `pass` with a `measured` inside the criterion's
// tolerance of its answer. And its own world, baked here over its own track and steps, reads the criterion's sentence:
// from the step its `brake` is stamped the car stops 12.5 m on, the farthest it reaches along its heading, and from
// then on never moves backwards along its heading faster than 0.05 m/s; 2 s after the step its `drive` is stamped it
// moves at 4.00 m/s along its heading; and from the step its `steer` is stamped until its heading has turned 360°,
// the middle of the axle of its wheels that don't steer lies on a circle of radius 9.330 m, fitted by least squares.
// Every failure starts with its fixture's name. `hold_takes_out_side_slip` makes the hold itself take out each wheel's
// sideways slip, so the turning car stops.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, TIMEOUT, bodyOf, circleRadius, dot, entryOn, fixtureBake, fmt, forward, isObject, kitFixtures, kitReport, near, prebuildBuilds,
  rotate, run, sub, worldPoint, yaw, type JsonObject, type KitFixture, type Planted, type State,
} from './helpers.ts';

prebuildBuilds(['release']);

const ID = CRITERIA[3];
const TWO_S = 240;
/** The world's sleep speed (World and backend: `solver.sleep.speed`): slower than this, a body counts as at rest. */
const STILL = 0.05;
/** Each of #251's three fixtures: its answer as the criterion prints it, and its tolerance. */
const FIXTURES = [
  { name: 'vehicle_brake', answer: 12.5, within: 0.03 },
  { name: 'vehicle_drive', answer: 4, within: 0.02 },
  { name: 'vehicle_turn', answer: 9.33, within: 0.03 },
] as const;
type Name = (typeof FIXTURES)[number]['name'];

/** The brake fixture's own run: where the car stops from the brake's step, and how fast it ever moves backwards after. */
function brakeFailures(f: KitFixture, car: State[]): string[] {
  const at = entryOn(f, 'brake');
  if (!at) return [`${f.name}: its track stamps no brake`];
  const heading = rotate(car[at.step]!.rot, [0, 0, 1]);
  const gone = car.map((s) => dot(sub(s.pos, car[at.step]!.pos), heading));
  const stop = Math.max(...gone.slice(at.step));
  const out: string[] = [];
  if (!near(stop, 12.5, 0.03)) out.push(`${f.name}: from 10 m/s a brake of 4,000 N stops the car ${fmt(stop)} m on, not 12.5 m within 3%`);
  if (gone.indexOf(stop, at.step) === car.length - 1) out.push(`${f.name}: the car hasn't stopped by the fixture's last step, ${f.steps}`);
  const back = car.map((s, k) => ({ v: forward(s), k })).filter(({ v, k }) => k > at.step && v < -0.05);
  if (back.length) {
    const worst = back.reduce((a, b) => (b.v < a.v ? b : a));
    out.push(`${f.name}: the car moves backwards at ${fmt(-worst.v)} m/s at step ${worst.k} (${back.length} steps faster than 0.05 m/s), not never faster than 0.05 m/s`);
  }
  return out;
}
/** The drive fixture's own run: the car's speed along its heading 2 s after the drive's step. */
function driveFailures(f: KitFixture, car: State[]): string[] {
  const at = entryOn(f, 'drive');
  if (!at) return [`${f.name}: its track stamps no drive`];
  const s = car[at.step + TWO_S];
  if (!s) return [`${f.name}: its run of ${f.steps} steps ends before 2 s after its drive at step ${at.step}`];
  const v = forward(s);
  return near(v, 4, 0.02) ? [] : [`${f.name}: a drive of 2,000 N reaches ${fmt(v)} m/s at 2 s, not 4.00 m/s within 2%`];
}
/** The turn fixture's own run: the radius of the circle the middle of its unsteered axle traces over one turn from the steer's step. */
function turnFailures(f: KitFixture, car: State[]): string[] {
  const at = entryOn(f, 'steer');
  if (!at) return [`${f.name}: its track stamps no steer`];
  const body = f.vehicle === null ? undefined : f.world['bodies'];
  const field = isObject(body) && isObject(body[f.vehicle!]) ? (body[f.vehicle!] as JsonObject)['vehicle'] : undefined;
  const wheels = isObject(field) && isObject(field['wheels']) ? Object.values(field['wheels']) : [];
  const rear = wheels.filter((w): w is JsonObject => isObject(w) && w['steers'] !== true).map((w) => (Array.isArray(w['at']) ? (w['at'] as number[]) : [0, 0, 0]));
  if (!rear.length) return [`${f.name}: its car has no wheel that doesn't steer`];
  const middle = [0, 1, 2].map((i) => rear.reduce((sum, p) => sum + p[i]!, 0) / rear.length);
  let turned = 0;
  let full: number | null = null;
  for (let k = at.step + 1; k < car.length && full === null; k++) {
    let d = yaw(car[k]!) - yaw(car[k - 1]!);
    d -= 360 * Math.round(d / 360);
    turned += d;
    if (Math.abs(turned) >= 360) full = k;
  }
  if (full === null) return [`${f.name}: the car's heading turns ${fmt(Math.abs(turned))}° in the fixture's ${f.steps} steps, not once around, so the middle of its rear axle traces no circle`];
  const radius = circleRadius(car.slice(at.step, full + 1).map((s) => { const p = worldPoint(s, middle); return [p[0], p[2]] as [number, number]; }));
  return near(radius, 9.33, 0.03) ? [] : [`${f.name}: at 3 m/s with steer 15° the middle of the rear axle circles at ${fmt(radius)} m over one turn, not 9.330 m within 3%`];
}
const OWN: Record<Name, (f: KitFixture, car: State[]) => string[]> = { vehicle_brake: brakeFailures, vehicle_drive: driveFailures, vehicle_turn: turnFailures };

/** #251's three fixtures on level ground, by the kit's rows and by their own runs: the judge's failures, and the turning car's last speed. */
function level(planted?: Planted): { problem: string; failures: string[]; turnEnds: number | null } {
  const o = planted ? { planted } : {};
  const kit = run([{ call: 'behavior_fixtures' }, { call: 'behavior_kit' }], o);
  if (kit.problem) return { problem: kit.problem, failures: [], turnEnds: null };
  const failures: string[] = [];
  const held = FIXTURES.flatMap(({ name }) => {
    const found = kitFixtures(kit.replies[0], name);
    if (found.length !== 1) failures.push(`${name}: the kit's data holds it ${found.length} times, not once`);
    else if (found[0]!.vehicle === null) failures.push(`${name}: its world doesn't hold one vehicle body`);
    return found.length === 1 && found[0]!.vehicle !== null ? [found[0]!] : [];
  });
  const report = kitReport(kit.replies[1]!, 'behavior_kit');
  for (const { name, answer, within } of FIXTURES) {
    const rows = report.results.filter((x) => x.fixture === name);
    if (rows.length !== 1) { failures.push(`${name}: the kit's report holds it ${rows.length} times, not once`); continue; }
    const row = rows[0]!;
    if (row.result !== 'pass') failures.push(`${name}: the kit reads ${row.result} on ${row.backend}: ${row.what}`);
    else if (row.measured === null || !near(row.measured, answer, within)) failures.push(`${name}: the kit passes it measuring ${row.measured === null ? 'nothing' : fmt(row.measured)}, outside ${within * 100}% of ${answer}`);
  }
  const runs = run(held.map((f) => fixtureBake(f, [f.vehicle!])), o);
  if (runs.problem) return { problem: runs.problem, failures, turnEnds: null };
  let turnEnds: number | null = null;
  held.forEach((f, i) => {
    const car = bodyOf(runs.replies[i], f.vehicle!, f.steps, `${f.name}'s own world baked over its own track`);
    failures.push(...OWN[f.name as Name](f, car));
    if (f.name === 'vehicle_turn') turnEnds = Math.hypot(...car[f.steps]!.linear);
  });
  return { problem: '', failures, turnEnds };
}

describe(`${ID} on level ground #251's brake, drive and turn fixtures read as they did`, () => {
  it(`${ID} from 10 m/s a brake of 4,000 N stops the car in 12.5 m within 3% and it never moves backwards faster than 0.05 m/s, a drive of 2,000 N reaches 4.00 m/s at 2 s within 2%, and at 3 m/s with steer 15° the middle of the rear axle circles at 9.330 m within 3%`, () => {
    const l = level();
    expect(l.problem, 'deep-physics answers the kit\'s calls and bakes #251\'s three fixtures').toBe('');
    expect(l.failures, `#251's three fixtures on level ground:\n  ${l.failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: hold_takes_out_side_slip) a hold that takes out a wheel's sideways slip itself, where the controller's grip already does, stops the turning car and fails, naming the turn fixture`, () => {
    const l = level('hold_takes_out_side_slip');
    expect(l.problem, 'deep-physics --planted hold_takes_out_side_slip runs, answers the kit\'s calls and bakes #251\'s three fixtures').toBe('');
    expect(l.failures.length, 'the planted hold is caught: the judge that passes #251\'s fixtures finds one off').toBeGreaterThan(0);
    expect(l.failures.some((f) => f.startsWith('vehicle_turn: ')), `a failure names the turn fixture: ${l.failures.join(' | ')}`).toBe(true);
    expect(l.turnEnds, 'the turn fixture\'s own run was read').not.toBeNull();
    expect(l.turnEnds!, `the planted hold stops the turning car: it ends its run at ${fmt(l.turnEnds!)} m/s, slower than the world's sleep speed, 0.05 m/s`).toBeLessThan(STILL);
  }, TIMEOUT);
});
