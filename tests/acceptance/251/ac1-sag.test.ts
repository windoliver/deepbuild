// #251.1571a36a: "Sag: a vehicle body of 1,000 kg on four wheels at the corners of a 2.5 m wheelbase and a 1.6 m track,
// centred under its centre of mass, with springs of 2 Hz, damping ratio 0.3, rest 0.3 m and travel 0.2 m, set down on
// level ground at 120 Hz, has each spring 0.0621 m (g ÷ (2π × 2)²) shorter than its rest length within 2% after 3 s;
// and a planted controller that sizes each spring on the whole chassis mass settles 0.0155 m and fails, naming the
// wheel"
//
// The car (README: The car) is set down at rest on level ground with every spring at its rest length, sleep off, and
// baked 3 s at 120 Hz. Each spring's length is read from the program's own outputs: the wheel's pose (its hub at its
// suspension's length) against its mount, which the chassis's pose places in the world. `spring_on_whole_mass` sizes
// each spring on the whole 1,000 kg, so it is four times as stiff and settles a quarter as far.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, REST, REST_Y, SAG, SAG_TOLERANCE, TIMEOUT, WHEEL_NAMES, ask, bakeRun, carWorld, caught, fmt, kart, kartOf, naming, near,
  none, prebuild, springLength, stepAt, wheelPoses, type JsonObject, type Planted,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[1];
const AT = stepAt(3);
const TWIN_SAG = 0.0155;
const setDown = (): JsonObject => carWorld(kart([0, REST_Y, 0], { sleep: false }));

/** Each wheel's sag (rest − its spring's length) after 3 s. */
function sags(planted?: Planted): Record<string, number> {
  const [reply] = ask([bakeRun(setDown(), AT)], planted, 'the car set down');
  const states = kartOf(reply!, AT + 1, 'the car set down');
  const poses = wheelPoses(reply!, AT + 1, 'the car set down');
  return Object.fromEntries(WHEEL_NAMES.map((n) => [n, REST - springLength(states[AT]!, n, poses[n][AT]!)]));
}
const sagFailures = (s: Record<string, number>): string[] => Object.entries(s)
  .filter(([, v]) => !near(v, SAG, SAG_TOLERANCE))
  .map(([n, v]) => `wheel ${n}: its spring is ${fmt(v)} m shorter than its rest length after 3 s, not ${SAG} m within 2%`);

describe(`${ID} a 1,000 kg car on 2 Hz springs set down on level ground sags g ÷ (2π × 2)² on each spring`, () => {
  it(`${ID} after 3 s each spring is 0.0621 m shorter than its rest length, within 2%`, () => {
    none(sagFailures(sags()), 'each spring\'s sag after 3 s');
  }, TIMEOUT);

  it(`${ID} (twin: spring_on_whole_mass) a controller that sizes each spring on the whole chassis mass settles 0.0155 m and fails, naming the wheel`, () => {
    const s = sags('spring_on_whole_mass');
    const failures = sagFailures(s);
    caught(failures, 'spring_on_whole_mass');
    naming(failures, /^wheel (fl|fr|rl|rr): /, 'spring_on_whole_mass\'s failure names the wheel');
    for (const [n, v] of Object.entries(s)) expect(near(v, TWIN_SAG, 0.05), `the planted controller settles wheel ${n} ${fmt(v)} m, the issue's 0.0155 m within 5%`).toBe(true);
  }, TIMEOUT);
});
