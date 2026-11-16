// #251.acf8ab9a: "Drive and brake: settled on level ground, with its rear wheels driving, a drive of 2,000 N from rest
// reaches 4.00 m/s at 2 s within 2%, and, from rest and asleep, one of −2,000 N wakes it and reaches 4.00 m/s backwards
// at 2 s within 2%; from 10 m/s a brake of 4,000 N, with that drive of 2,000 N still held, stops it 12.5 m on (m × v² ÷
// 2F) within 3%, and it never rolls backwards after; and a planted brake that gives each braking wheel the whole force
// stops it in 3.125 m and fails, naming the body"
//
// The car (README: The car), rear wheels driving, every wheel braking, is set down at its settled height on level
// ground. Forward: sleep off, a drive of 2,000 N stamped at 1 s, its speed along its heading read 2 s later. Backward:
// sleep on (the world's default), left 3 s, by when it has written `rest` and sleeps; a drive of −2,000 N stamped then
// must write `wake` naming it on the step it applies and reach −4.00 m/s 2 s later. Brake: sleep off, started at
// 10 m/s along its heading with a drive of 2,000 N and a brake of 4,000 N both stamped at step 0, so the drive is held
// all through the brake; it stops where its centre reaches its farthest, 12.5 m on, and never comes back more than
// 1 cm. `brake_whole_force_each_wheel` gives each of the four braking wheels the whole 4,000 N.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, SETTLED_Y, TIMEOUT, ask, bakeRun, brake, carWorld, caught, drive, fmt, forward, kart, kartOf, naming, near, none, prebuild,
  rowText, rowsOf, stepAt, type Planted, type State,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[2];
const SPEED = 4;
const SETTLE = stepAt(1);
const ASLEEP = stepAt(3);
const TWO_S = stepAt(2);
const BRAKE_RUN = stepAt(5);
const STOP = 12.5;
const TWIN_STOP = 3.125;
/** "Never rolls backwards": its centre never comes back more than this from the farthest it reached. */
const BACK = 0.01;

function speedFailures(states: State[], at: number, want: number, what: string): string[] {
  const v = forward(states[at]!);
  return near(v, want, 0.02) ? [] : [`${what}: kart moves ${fmt(v)} m/s along its heading at step ${at}, not ${want} m/s within 2%`];
}

describe(`${ID} a drive of ±2,000 N reaches 4 m/s in 2 s from rest, awake or asleep; a brake of 4,000 N stops it 12.5 m on from 10 m/s with the drive still held`, () => {
  it(`${ID} settled with its rear wheels driving, a drive of 2,000 N from rest reaches 4.00 m/s at 2 s, within 2%`, () => {
    const w = carWorld(kart([0, SETTLED_Y, 0], { sleep: false }));
    const [r] = ask([bakeRun(w, SETTLE + TWO_S, [drive(SETTLE, 2000)])]);
    const s = kartOf(r!, SETTLE + TWO_S + 1, 'the settled car driven at 1 s');
    expect(Math.abs(forward(s[SETTLE]!)), 'it is at rest when the drive is stamped').toBeLessThan(0.01);
    none(speedFailures(s, SETTLE + TWO_S, SPEED, 'drive 2,000 N'), 'the drive from rest');
  }, TIMEOUT);

  it(`${ID} from rest and asleep, a drive of −2,000 N wakes it and reaches 4.00 m/s backwards at 2 s, within 2%`, () => {
    const w = carWorld(kart([0, SETTLED_Y, 0]));
    const [r] = ask([bakeRun(w, ASLEEP + TWO_S, [drive(ASLEEP, -2000)])]);
    const s = kartOf(r!, ASLEEP + TWO_S + 1, 'the sleeping car driven backwards');
    const rows = rowsOf(r!, 'the sleeping car driven backwards').filter((x) => x.a === 'kart' && (x.kind === 'rest' || x.kind === 'wake'));
    const before = rows.filter((x) => x.step <= ASLEEP);
    expect(before.at(-1)?.kind, `it sleeps when the drive is stamped at step ${ASLEEP}: its last rest or wake row by then is rest (rows: ${rows.map(rowText).join('; ') || 'none'})`).toBe('rest');
    const woken = rows.filter((x) => x.kind === 'wake' && x.step > ASLEEP);
    expect(woken[0]?.step, `the drive wakes it: a wake row naming kart on the step the drive applies, ${ASLEEP + 1} (rows: ${rows.map(rowText).join('; ')})`).toBe(ASLEEP + 1);
    none(speedFailures(s, ASLEEP + TWO_S, -SPEED, 'drive −2,000 N from sleep'), 'the drive backwards from sleep');
  }, TIMEOUT);

  /** The brake from 10 m/s with the drive held: the distance to where it stops, and whether it ever comes back. */
  function brakeFailures(planted?: Planted): { failures: string[]; stop: number } {
    const w = carWorld(kart([0, SETTLED_Y, 0], { sleep: false, velocity: { linear: [0, 0, 10] } }));
    const [r] = ask([bakeRun(w, BRAKE_RUN, [drive(0, 2000), brake(0, 4000)])], planted, 'the car braked from 10 m/s');
    const z = kartOf(r!, BRAKE_RUN + 1, 'the car braked from 10 m/s').map((x) => x.pos[2]);
    const far = Math.max(...z);
    const at = z.indexOf(far);
    const stop = far - z[0]!;
    const failures: string[] = [];
    if (!near(stop, STOP, 0.03)) failures.push(`kart stops ${fmt(stop)} m on from 10 m/s under a brake of 4,000 N with the drive of 2,000 N held, not ${STOP} m within 3%`);
    if (at === BRAKE_RUN) failures.push(`kart hasn't stopped by step ${BRAKE_RUN}: it is still moving on`);
    const back = z.slice(at).findIndex((x) => x < far - BACK);
    if (back >= 0) failures.push(`kart rolls backwards after stopping at step ${at}: at step ${at + back} it is ${fmt(far - z[at + back]!)} m back`);
    return { failures, stop };
  }

  it(`${ID} from 10 m/s a brake of 4,000 N, with that drive of 2,000 N still held, stops it 12.5 m on, within 3%, and it never rolls backwards after`, () => {
    none(brakeFailures().failures, 'the brake from 10 m/s');
  }, TIMEOUT);

  it(`${ID} (twin: brake_whole_force_each_wheel) a brake that gives each braking wheel the whole force stops it in 3.125 m and fails, naming the body`, () => {
    const { failures, stop } = brakeFailures('brake_whole_force_each_wheel');
    caught(failures, 'brake_whole_force_each_wheel');
    naming(failures, /^kart stops /, 'brake_whole_force_each_wheel\'s failure names the body');
    expect(near(stop, TWIN_STOP, 0.05), `the planted brake stops it in ${fmt(stop)} m, the issue's 3.125 m within 5%`).toBe(true);
  }, TIMEOUT);
});
