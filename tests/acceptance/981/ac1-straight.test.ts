// Criterion 1: "A vehicle on a straight 20 m edge with a 2 m/s limit, speeding up and slowing down at 1 m/s², goes from
// rest to rest in 12 s (2 s up over 2 m, 8 s at 2 m/s over 16 m, 2 s down over 2 m), within one step, and its position
// array matches that profile within 1e-6 m at every step."
//
// Through `deep-logic first_party` and `bake` (README: The surface): the straight scene (scenes.ts: STRAIGHT) at 10 Hz,
// its one vehicle (top speed 3 m/s, so the edge's 2 m/s limit is what holds it) sent from park.a to rack.b at step 0,
// linking lanes@1's reference library through the interface. The profile is worked in fixtures.ts (straightRun) and is
// the fixture's expectation at every step. The wrong programs shown failing: a library that integrates by semi-implicit
// Euler, and one that drives at the vehicle's own top speed past the limit.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, bakeCall, bakeOf, logicBin, onHost, prebuild } from '../190/helpers.ts';
import { STRAIGHT_STEPS, straightFixture, straightRun } from './fixtures.ts';
import { AC, INTERFACE, carry, fixtureDiffers, fixturePiece, gap, lanes, layout, nums, offBy, series } from './helpers.ts';
import { dispatchProgram, lanesWrites } from './programs.ts';
import { STRAIGHT, TOL, bay, profile } from './scenes.ts';

prebuild(() => { logicBin(); });

const DT = 1 / STRAIGHT.rate;
/** A wrong program's positions: v += a·dt then s += v·dt each step (braking from 18 m), or the profile at 3 m/s. */
function euler(): number[][] {
  let s = 0, v = 0;
  return Array.from({ length: STRAIGHT_STEPS }, () => { v = s < 18 ? Math.min(v + DT, 2) : Math.max(v - DT, 0); s = Math.min(s + v * DT, 20); return [s, 0]; });
}
/** When a run of positions leaves the start and when it is at the goal for good: the rest-to-rest time it shows. */
function restToRest(pos: number[][]): number {
  const moved = pos.findIndex((p) => gap(p, [0, 0]) > 1e-9);
  const arrived = pos.findIndex((_, k) => pos.slice(k).every((q) => gap(q, [20, 0]) <= TOL));
  return (arrived + 1) * DT - moved * DT;
}

describe(`${AC[1]} a vehicle runs the rest-to-rest profile on a straight edge`, () => {
  it(`${AC[1]} a vehicle on a straight 20 m edge with a 2 m/s limit, 1 m/s² each way, goes from rest to rest in 12 s within one step, its position within 1e-6 m of the profile at every step`, () => {
    const r = straightRun();
    expect(r.arrival, 'by the profile it is at rest at rack.b at the end of step 119 (12 s)').toBe(119);
    expect(Math.abs(restToRest(r.pos) - 12), 'the profile itself reads 12 s rest to rest').toBeLessThan(1e-9);
    expect(offBy(euler(), (k) => r.pos[k]!, TOL, 'Euler'), 'a semi-implicit Euler run misses the profile by more than 1e-6 m').not.toEqual([]);
    const fast = profile(20, 3, 1, 1);
    expect(offBy(r.pos.map((_, k) => [fast.at((k + 1) * DT), 0]), (k) => r.pos[k]!, TOL, '3 m/s'), 'a run at 3 m/s past the limit misses it too').not.toEqual([]);

    const L = lanes();
    const writes = lanesWrites(1);
    layout(writes);
    const program = dispatchProgram('straight', INTERFACE, [bay(STRAIGHT, 'park.a')], [{ at: 0, v: 0, bay: bay(STRAIGHT, 'rack.b') }], DT);
    const f = straightFixture({ program, writes, scene: STRAIGHT });
    const [reply] = onHost([bakeCall(fixturePiece(f, L.ref, carry({ ...L.assets }, program)), f.steps)]);
    const b = bakeOf(reply!, 'the straight run\'s bake');
    expect(fixtureDiffers(b, f), 'the straight fixture\'s expectations hold within 1e-6 m').toEqual([]);
    const pos = nums(series(b, 'fixture', 'pos'), 0);
    expect(offBy(pos, (k) => r.pos[k]!, TOL, 'pos'), 'its position is the profile\'s within 1e-6 m at every step').toEqual([]);
    const shown = restToRest(pos);
    expect(Math.abs(shown - 12), `it goes from rest to rest in ${shown} s: 12 s within one step (${DT} s)`).toBeLessThanOrEqual(DT + 1e-9);
  }, TIMEOUT);
});
