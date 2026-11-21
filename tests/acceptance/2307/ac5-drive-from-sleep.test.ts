// #2307.400e4569: "A `drive` wakes it on that step. Asleep on level ground and driven at 2,000 N, the car reaches
// 4.00 m/s at 2 s within 2%, its centre never rises more than 5 mm, and no wheel writes `contact_end`. Asleep on the 10°
// slope and driven at 6,000 N, it climbs at (6,000 − 1,000 × 9.81 × sin 10°) × 2 ÷ 1,000 = 8.59 m/s at 2 s within 2%.
// The planted wrapper of the last criterion reads 3.62 m/s on level ground, hops 0.079 m and fails, naming the body"
//
// Two cars (README: The worlds), each set down with every spring at rest length and its `sleep` left on, left 4 s, by
// when each has written `rest` and sleeps, and driven from step 480 for 2 s. On level ground a drive of 2,000 N is
// stamped at step 480. Facing up the 10° slope a brake of 4,000 N is stamped at step 0, which parks it, and at step 480
// a brake of 0 and a drive of 6,000 N, since no wheel drives while `brake` is above 0. An entry stamped at step 480
// applies in the step from the state after 480 steps to the state after 481 (#522's convention), so the drive's `wake`
// row is on step 481, as #251's suite reads a drive from sleep. Speeds are along the car's heading after step 720; its
// rise is its centre's height after each step from 480 to 720 over its height after step 480; a wheel's `contact_end`
// is a row of that kind naming one of its wheels after step 480. `controller_runs_asleep` is criterion 4's planted
// wrapper: the springs' pushes it stored while the car slept throw the woken car off the ground.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, G, LEVEL, MASS, TIMEOUT, asleepAfter, bakeOf, bodyOf, brake, drive, fmt, near, prebuildBuilds, rowText, rowsOf, run, sleepRows,
  sleepText, slopeWorld, speedDown, stepAt, wheelRows, type Planted, type Row, type Slope, type State,
} from './helpers.ts';

prebuildBuilds(['release']);

const ID = CRITERIA[5];
const DRIVEN = stepAt(4);
const END = DRIVEN + stepAt(2);
const UP_10: Slope = { deg: 10, way: 'up' };
const CLIMB = ((6000 - MASS * G * Math.sin((10 * Math.PI) / 180)) * 2) / MASS;
/** What the issue says the planted wrapper reads on level ground, and how near them this suite holds it (README: Readings). */
const TWIN_SPEED = 3.62;
const TWIN_HOP = 0.079;

/** A drive stamped at step 480 on a car asleep: no `rest` behind it, or no `wake` on the step it applies. */
function wakeFailures(rows: Row[], where: string): string[] {
  const out: string[] = [];
  if (!asleepAfter(rows, DRIVEN)) out.push(`kart: isn't asleep ${where} when the drive is stamped at step ${DRIVEN} (its rest and wake rows: ${sleepText(rows)})`);
  const woken = sleepRows(rows).find((r) => r.kind === 'wake' && r.step > DRIVEN);
  if (woken?.step !== DRIVEN + 1) out.push(`kart: the drive stamped at step ${DRIVEN} ${where} doesn't wake it on that step: its wake row is on step ${woken ? woken.step : 'none'}, not ${DRIVEN + 1}`);
  return out;
}

interface Driven { problem: string; failures: string[]; speed: number; rise: number; climb: number }
/** The two drives from sleep: the judge's failures, the level car's speed and rise, and the slope car's climb. */
function driven(planted?: Planted): Driven {
  const r = run([
    bakeOf(slopeWorld(LEVEL, { sleep: true }), END, [drive(DRIVEN, 2000)], ['kart']),
    bakeOf(slopeWorld(UP_10, { sleep: true }), END, [brake(0, 4000), brake(DRIVEN, 0), drive(DRIVEN, 6000)], ['kart']),
  ], planted ? { planted } : {});
  if (r.problem) return { problem: r.problem, failures: [], speed: NaN, rise: NaN, climb: NaN };
  const level: State[] = bodyOf(r.replies[0], 'kart', END, 'the car asleep on level ground, driven at 2,000 N');
  const levelRows = rowsOf(r.replies[0], 'the car asleep on level ground, driven at 2,000 N');
  const slope: State[] = bodyOf(r.replies[1], 'kart', END, 'the car asleep on the 10° slope, driven at 6,000 N');
  const slopeRows = rowsOf(r.replies[1], 'the car asleep on the 10° slope, driven at 6,000 N');
  const failures = [...wakeFailures(levelRows, 'on level ground'), ...wakeFailures(slopeRows, 'on the 10° slope')];
  const speed = -speedDown(level[END]!, LEVEL);
  if (!near(speed, 4, 0.02)) failures.push(`kart: asleep on level ground and driven at 2,000 N, moves ${fmt(speed)} m/s along its heading at 2 s, not 4.00 m/s within 2%`);
  const rise = Math.max(...level.slice(DRIVEN).map((s) => s.pos[1] - level[DRIVEN]!.pos[1]));
  if (rise > 0.005) failures.push(`kart: woken on level ground, its centre rises ${fmt(rise)} m over where it slept, more than 5 mm`);
  const ended = wheelRows(levelRows).filter((x) => x.kind === 'contact_end' && x.step > DRIVEN);
  if (ended.length) failures.push(`kart: woken on level ground, its wheels write ${ended.length} contact_end rows, the first ${rowText(ended[0]!)}`);
  const climb = -speedDown(slope[END]!, UP_10);
  if (!near(climb, CLIMB, 0.02)) failures.push(`kart: asleep on the 10° slope and driven at 6,000 N, climbs at ${fmt(climb)} m/s at 2 s, not (6,000 − 1,000 × 9.81 × sin 10°) × 2 ÷ 1,000 = ${fmt(CLIMB, 3)} m/s within 2%`);
  return { problem: '', failures, speed, rise, climb };
}

describe(`${ID} a drive wakes a sleeping car on the step it applies, and the car drives off as one that was awake`, () => {
  it(`${ID} asleep on level ground and driven at 2,000 N it wakes on that step, reaches 4.00 m/s at 2 s within 2%, never rises more than 5 mm and no wheel writes contact_end; asleep on the 10° slope and driven at 6,000 N it wakes on that step and climbs at 8.59 m/s at 2 s within 2%`, () => {
    const d = driven();
    expect(d.problem, 'deep-physics bakes the two cars driven from sleep').toBe('');
    console.log(`driven from sleep: on level ground ${fmt(d.speed)} m/s at 2 s, its centre rising ${fmt(d.rise)} m; on the 10° slope ${fmt(d.climb)} m/s at 2 s`);
    expect(d.failures, `the two drives from sleep:\n  ${d.failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${ID} (twin: controller_runs_asleep) the planted wrapper of the last criterion reads 3.62 m/s on level ground, hops 0.079 m and fails, naming the body`, () => {
    const d = driven('controller_runs_asleep');
    expect(d.problem, 'deep-physics --planted controller_runs_asleep runs and bakes the two cars driven from sleep').toBe('');
    expect(d.failures.length, 'the planted wrapper is caught: the judge that passes the car driven from sleep finds it off').toBeGreaterThan(0);
    expect(d.failures.some((f) => /^kart: asleep on level ground and driven at 2,000 N, moves /.test(f)), `a failure names the body and its speed on level ground: ${d.failures.join(' | ')}`).toBe(true);
    expect(d.failures.some((f) => /^kart: woken on level ground, its centre rises /.test(f)), `a failure names the body and its hop: ${d.failures.join(' | ')}`).toBe(true);
    expect(near(d.speed, TWIN_SPEED, 0.02), `the planted wrapper reads ${fmt(d.speed)} m/s on level ground at 2 s, the issue's 3.62 m/s within 2%`).toBe(true);
    expect(Math.abs(d.rise - TWIN_HOP), `the planted wrapper hops ${fmt(d.rise)} m, the issue's 0.079 m within 5 mm`).toBeLessThanOrEqual(0.005);
  }, TIMEOUT);
});
