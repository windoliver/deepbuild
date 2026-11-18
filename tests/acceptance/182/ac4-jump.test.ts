// Criterion 4: a jump of height 1 m on flat ground at 120 Hz, with gravity 9.81 m/s², raises the body's lowest point
// by 1.0185 m within 1 mm at its peak, the discrete solution (the jump's step moves it by √(2gh) × the step's length,
// and each later step first lowers its vertical speed by g × the step's length); and a second jump input during the
// flight leaves every step hash equal to a run without it.
//
// The body stands on the floor for 30 steps; the jump is stamped 30, so its step ends in state 31. The rise is read
// from where its lowest point stood before the jump (state 30). The second jump is stamped 50, 20 steps into the flight.
import { describe, expect, test } from 'vitest';
import {
  AC, DT, G, HERO, TIMEOUT, bake, discreteHeights, flatWorld, hashesOf, jump, lowest, none, physics, prebuild, statesOf,
} from './helpers.ts';

prebuild(['shipped']);
const AT = 30;
const STEPS = 200;

describe(`${AC[4]} a 1 m jump peaks at the discrete solution, and a jump in flight changes nothing`, () => {
  test(`${AC[4]} a 1 m jump raises the lowest point 1.0185 m within 1 mm at its peak; a second jump during the flight leaves every step hash equal`, () => {
    const v0 = Math.sqrt(2 * G * 1);
    const heights = discreteHeights(v0, STEPS - AT);
    const want = Math.max(...heights);
    expect(Math.abs(want - 1.0185), `the discrete solution (v0 = √(2gh) = ${v0}, dt = ${DT}) peaks at ${want}, the issue's 1.0185`).toBeLessThan(5e-5);
    const w = flatWorld();
    const [once, twice] = physics([
      bake(w, STEPS, { track: [jump(AT)], read: [HERO] }),
      bake(w, STEPS, { track: [jump(AT), jump(AT + 20)], read: [HERO] }),
    ]);
    const states = statesOf(once!, HERO, 'the jump');
    const rest = lowest(states[AT]!);
    const peak = Math.max(...states.slice(AT + 1).map(lowest)) - rest;
    const out: string[] = [];
    if (Math.abs(peak - want) > 0.001) out.push(`its lowest point rises ${peak.toFixed(5)} m at its peak, not ${want.toFixed(5)} (1.0185) within 1 mm`);
    const [a, b] = [hashesOf(once!, 'the jump'), hashesOf(twice!, 'the jump with a second in flight')];
    const k = a.findIndex((h, i) => h !== b[i]);
    if (a.length !== b.length || k >= 0) out.push(`a second jump stamped ${AT + 20}, in flight, changes the step hash after step ${k} (of ${a.length} and ${b.length} hashes)`);
    none(out, 'rapier3d');
  }, TIMEOUT);
});
