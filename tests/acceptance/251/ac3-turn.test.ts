// #251.d72490eb: "Turn: rolling from 3 m/s with steer 15° and steer_max 35°, the inside front wheel's pose turns 16.33°
// and the outside one's 13.86°, each within 0.01°, and the middle of the rear axle traces a circle of radius 2.5 ÷ tan
// 15° = 9.330 m within 3%, fitted over one turn; steer 50° turns the inside front wheel 35.00° and the outside one
// 25.80°, each within 0.01°, while a planted clamp on the steer angle itself turns the inside wheel 42.06° and fails,
// naming the wheel and its angle; and a planted steer that turns both front wheels 15° fails, naming the wheel and its
// angle"
//
// The car (README: The car) is set down settled on level ground rolling at 3 m/s along its heading, sleep off, with a
// steer stamped at step 0 and nothing else. A positive steer turns left (about +Y), so the inside wheel is the left
// front `fl`, the outside `fr`. Each front wheel's turn is read from the program's own outputs, the same step's poses:
// the signed angle from its side's rear wheel's axle to its own (helpers: turnOf), at every step from the first the
// steer applies through 2 s. The middle of the rear axle is the chassis's local point between the rear mounts; a
// least-squares circle is fitted to it, on the ground plane, from step 0 until its heading has turned 360°.
import { describe, expect, it } from 'vitest';
import {
  AT, CRITERIA, SETTLED_Y, TIMEOUT, ask, bakeRun, carWorld, caught, circleRadius, fmt, kart, kartOf, naming, near, none, prebuild,
  steer, stepAt, turnOf, wheelPoses, worldPoint, yaw, type JsonObject, type Planted,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[3];
const ANGLES = stepAt(2);
const RUN = stepAt(30);
const RADIUS = 9.33;
const rolling = (): JsonObject => carWorld(kart([0, SETTLED_Y, 0], { sleep: false, velocity: { linear: [0, 0, 3] } }));
const REAR_MIDDLE = [0, AT.rl[1], AT.rl[2]];

interface Turned { fl: number[]; fr: number[]; radius: number | null; turnedAt: number | null }
function turned(angle: number, planted: Planted | undefined, circle: boolean): Turned {
  const steps = circle ? RUN : ANGLES;
  const [r] = ask([bakeRun(rolling(), steps, [steer(0, angle)])], planted, `the car rolling at 3 m/s, steer ${angle}°`);
  const what = `steer ${angle}°`;
  const poses = wheelPoses(r!, steps + 1, what);
  const fl = poses.fl.map((p, k) => turnOf(p, poses.rl[k]!));
  const fr = poses.fr.map((p, k) => turnOf(p, poses.rr[k]!));
  if (!circle) return { fl, fr, radius: null, turnedAt: null };
  const s = kartOf(r!, steps + 1, what);
  let total = 0;
  let turnedAt: number | null = null;
  for (let k = 1; k <= steps && turnedAt === null; k++) {
    let d = yaw(s[k]!) - yaw(s[k - 1]!);
    d -= 360 * Math.round(d / 360);
    total += d;
    if (Math.abs(total) >= 360) turnedAt = k;
  }
  const points = s.slice(0, (turnedAt ?? steps) + 1).map((x) => { const p = worldPoint(x, REAR_MIDDLE); return [p[0], p[2]] as [number, number]; });
  return { fl, fr, radius: circleRadius(points), turnedAt };
}

/** Each front wheel within 0.01° of its angle at every step from the first the steer applies through 2 s, naming the wheel and its angle. */
function angleFailures(t: Turned, inside: number, outside: number): string[] {
  const f: string[] = [];
  for (const [name, series, want] of [['fl', t.fl, inside], ['fr', t.fr, outside]] as const) {
    const bad = series.map((a, k) => [k, a] as const).filter(([k, a]) => k >= 1 && k <= ANGLES && !(Math.abs(a - want) <= 0.01));
    if (bad.length) f.push(`wheel ${name} turns ${bad[0]![1].toFixed(2)}° at step ${bad[0]![0]}, not ${want.toFixed(2)}° within 0.01° (${bad.length} of steps 1 to ${ANGLES} off)`);
  }
  return f;
}

describe(`${ID} the front wheels steer by Ackermann's rule, the inside one clamped to steer_max, and the rear axle's middle circles at L ÷ tan δ`, () => {
  it(`${ID} rolling from 3 m/s with steer 15°, the inside front wheel turns 16.33° and the outside 13.86°, each within 0.01°, and the middle of the rear axle circles at 9.330 m within 3% over one turn`, () => {
    const t = turned(15, undefined, true);
    none(angleFailures(t, 16.33, 13.86), 'the front wheels at steer 15°');
    expect(t.turnedAt, `the car's heading turns 360° within ${RUN / 120} s`).not.toBeNull();
    expect(near(t.radius!, RADIUS, 0.03), `the middle of the rear axle traces a circle of radius ${fmt(t.radius!)} m over one turn (to step ${t.turnedAt}), not 9.330 m within 3%`).toBe(true);
  }, TIMEOUT);

  it(`${ID} steer 50° turns the inside front wheel 35.00° and the outside one 25.80°, each within 0.01°`, () => {
    none(angleFailures(turned(50, undefined, false), 35, 25.8), 'the front wheels at steer 50°');
  }, TIMEOUT);

  it(`${ID} (twin: steer_clamps_angle) a clamp on the steer angle itself turns the inside wheel 42.06° and fails, naming the wheel and its angle`, () => {
    const t = turned(50, 'steer_clamps_angle', false);
    const failures = angleFailures(t, 35, 25.8);
    caught(failures, 'steer_clamps_angle');
    naming(failures, /^wheel fl turns 42\.0\d°/, 'steer_clamps_angle\'s failure names the inside wheel and its 42.06°');
  }, TIMEOUT);

  it(`${ID} (twin: steer_parallel) a steer that turns both front wheels 15° fails, naming the wheel and its angle`, () => {
    const t = turned(15, 'steer_parallel', false);
    const failures = angleFailures(t, 16.33, 13.86);
    caught(failures, 'steer_parallel');
    naming(failures, /^wheel f[lr] turns 15\.00°/, 'steer_parallel\'s failure names a front wheel and its 15.00°');
  }, TIMEOUT);
});
