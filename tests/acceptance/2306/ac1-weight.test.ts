// #2306.9d2f70ed: "In a new fixture at 120 Hz and 4 substeps, #251's fixture car (1,000 kg on four wheels, a 2.5 m
// wheelbase and a 1.6 m track, springs of 2 Hz with damping ratio 0.3, rest 0.3 m, travel 0.2 m) is set down on a
// dynamic slab of 100 kg, 8 × 0.2 × 6 m, lying on static ground. Over the fourth second the slab's `contact_impulse`
// reads (1,000 + 100) × 9.81 = 10,791 N times the step's length within 1%. A planted wrapper that leaves the backend's
// controller as it is reads 981 N and fails, naming the slab"
//
// The car (README: The fixtures, the weight) is set down settled on the slab, sleep off, and baked 4 s at 120 Hz. The
// slab's `contact_impulse` (#2009's body state: the size of the summed contact impulses it took over the step, N·s) at
// each of the steps 361 to 480, the fourth second, is read as a force by dividing by the step's length, 1/120 s, and must
// be 10,791 N within 1% at every one of them. The ground under the slab is what holds it and the car up; the car's
// chassis never touches the slab, so its weight reaches the slab only through the wheels. `controller_as_is` gives the
// slab nothing, so it carries its own 981 N.
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DT, LOAD, SLAB_WEIGHT, TIMEOUT, ask, bakeOf, bodyOf, caught, fmt, naming, near, none, prebuild, stepAt, weightWorld,
  type Planted,
} from './helpers.ts';

prebuild();

const ID = CRITERIA[1];
const FROM = stepAt(3) + 1;
const TO = stepAt(4);

/** The slab's contact_impulse over the fourth second as forces (N), and the judge's failures. */
function weighed(planted?: Planted): { failures: string[]; forces: number[] } {
  const [r] = ask([bakeOf(weightWorld(), TO, [], ['kart', 'slab'])], planted, 'the car set down on the slab');
  const slab = bodyOf(r, 'slab', TO, 'the car set down on the slab');
  const forces = slab.slice(FROM, TO + 1).map((s, i) => {
    expect(s.contactImpulse, `the slab's state after step ${FROM + i} carries contact_impulse`).not.toBeNull();
    return s.contactImpulse! / DT;
  });
  const off = forces.map((f, i) => ({ f, k: FROM + i })).filter(({ f }) => !near(f, LOAD, 0.01));
  const worst = off.reduce<{ f: number; k: number } | null>((w, x) => (w && Math.abs(w.f - LOAD) >= Math.abs(x.f - LOAD) ? w : x), null);
  const failures = worst
    ? [`slab: its contact_impulse reads ${fmt(worst.f)} N times the step's length at step ${worst.k} (${off.length} of the fourth second's ${forces.length} steps off), not (1,000 + 100) × 9.81 = ${fmt(LOAD)} N within 1%`]
    : [];
  return { failures, forces };
}

describe(`${ID} a car's weight reaches the dynamic slab under its wheels and the ground under the slab`, () => {
  it(`${ID} over the fourth second the slab's contact_impulse reads 10,791 N times the step's length, within 1%`, () => {
    none(weighed().failures, 'the slab\'s contact_impulse over the fourth second');
  }, TIMEOUT);

  it(`${ID} (twin: controller_as_is) a wrapper that leaves the backend's controller as it is reads 981 N and fails, naming the slab`, () => {
    const { failures, forces } = weighed('controller_as_is');
    caught(failures, 'controller_as_is');
    naming(failures, /^slab: /, 'controller_as_is\'s failure names the slab');
    for (const f of forces) expect(near(f, SLAB_WEIGHT, 0.01), `the planted wrapper's slab carries ${fmt(f)} N, its own 981 N within 1%`).toBe(true);
  }, TIMEOUT);
});
