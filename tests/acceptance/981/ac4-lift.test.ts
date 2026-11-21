// Criterion 4: "A vehicle with a lift of 1 m/s raises its forks from 0.1 m to the 5.4 m rack level in 5.3 s within one
// step. While it carries a load, the load sits on the forks within 1e-6 m at every step; after `set_down` it stays at
// the rack level's pose."
//
// Through `deep-logic first_party` and `bake` (README: The surface): the lift scene (scenes.ts: LIFT) at 10 Hz, one
// vehicle with a 1 m/s mast, linking the reference library through lanes@1, run by programs.ts's liftProgram: forks to
// 0.1 m, `carry`, to rack.r, forks to 5.4 m, `set_down`, forks to 0.1 m, on to dock.d; it writes its phase. The forks'
// point is the vehicle's front centre at the fork height (README: Arrays); the rack level's pose is that point when the
// load is set down, (11.1, 5.4, 0) as [x, height, y]. The wrong program shown failing: a load that stays on the forks
// after set_down, which the run's own forks, lowered and driven to dock.d, put far from that pose.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, bakeCall, bakeOf, logicBin, num, onHost, prebuild } from '../190/helpers.ts';
import { LIFT_STEPS, forksPoint, liftFixture, liftRun } from './fixtures.ts';
import { AC, INTERFACE, carry, fixtureDiffers, fixturePiece, gap, lanes, layout, nums, series } from './helpers.ts';
import { lanesWrites, liftProgram } from './programs.ts';
import { FORKS_LOW, LIFT, RACK_LEVEL, STATE, TOL, bay } from './scenes.ts';

prebuild(() => { logicBin(); });

const DT = 1 / LIFT.rate;

describe(`${AC[4]} a vehicle's lift carries a load to a rack level`, () => {
  it(`${AC[4]} forks rise from 0.1 m to 5.4 m at 1 m/s in 5.3 s within one step; a carried load sits on the forks within 1e-6 m at every step, and after set_down stays at the rack level's pose`, () => {
    const r = liftRun();
    expect(Math.abs(r.rise - 5.3), 'by first principles 5.3 m at 1 m/s is 5.3 s').toBeLessThan(1e-12);
    expect(gap(r.pose, [11.1, RACK_LEVEL, 0]), 'and the load set down sits 1 m past rack.r, at 5.4 m').toBeLessThan(1e-12);

    const L = lanes();
    const writes = lanesWrites(1, { phase: { type: 'i32' } });
    const program = liftProgram(INTERFACE, layout(writes), bay(LIFT, 'park.p'), bay(LIFT, 'rack.r'), bay(LIFT, 'dock.d'), RACK_LEVEL, FORKS_LOW);
    const f = liftFixture({ program, writes, scene: LIFT });
    const [reply] = onHost([bakeCall(fixturePiece(f, L.ref, carry({ ...L.assets }, program)), f.steps)]);
    const b = bakeOf(reply!, 'the lift\'s bake');
    expect(fixtureDiffers(b, f), 'the lift fixture\'s expectations hold within 1e-6 m').toEqual([]);
    const pos = nums(series(b, 'fixture', 'pos'), 0);
    const heading = series(b, 'fixture', 'heading').map((h) => num(h[0], 'a heading'));
    const fork = series(b, 'fixture', 'fork').map((h) => num(h[0], 'a fork height'));
    const load = nums(series(b, 'fixture', 'load'), 0);
    const state = series(b, 'fixture', 'state').map((s) => num(s[0], 'a state'));
    const phase = series(b, 'fixture', 'phase').map((s) => num(s[0], 'a phase'));
    const first = (p: number): number => phase.indexOf(p);
    expect([1, 2, 3, 4].map(first).every((k, i, ks) => k > 0 && (i === 0 || k > ks[i - 1]!)), `the program went through all its phases: ${JSON.stringify([1, 2, 3, 4].map(first))}`).toBe(true);

    // The rise: from 0.1 m the step before phase 2 to 5.4 m, in 5.3 s within one step.
    const up = first(2);
    expect(Math.abs(fork[up - 1]! - FORKS_LOW), 'the forks are at 0.1 m when the rise starts').toBeLessThanOrEqual(TOL);
    const top = fork.findIndex((h, k) => k >= up && h >= RACK_LEVEL - TOL);
    const rise = (top + 1 - up) * DT;
    expect(Math.abs(rise - r.rise), `the forks reach 5.4 m in ${rise} s: 5.3 s within one step`).toBeLessThanOrEqual(DT + 1e-9);
    expect(state.slice(up, top).every((s) => s === STATE.lifting), 'the vehicle is lifting while they rise').toBe(true);

    // While carried, from the step it takes the load to the step it sets it down, the load is at the forks' point.
    const half = LIFT.vehicle.length / 2;
    const off: string[] = [];
    for (let k = first(1); k < first(3); k++) {
      const want = forksPoint(pos[k]!, heading[k]!, fork[k]!, half);
      if (!(gap(load[k]!, want) <= TOL)) off.push(`step ${k}: ${JSON.stringify(load[k])}, the forks at ${JSON.stringify(want)}`);
    }
    expect(off.slice(0, 20), 'the load sits on the forks within 1e-6 m at every step it is carried').toEqual([]);
    // After set_down it stays at the rack level's pose, while the forks go down and the vehicle drives on.
    const moved = load.slice(first(3)).map((q, i) => [first(3) + i, gap(q, r.pose)] as const).filter(([, d]) => !(d <= TOL));
    expect(moved.slice(0, 20), 'after set_down the load stays at (11.1, 5.4, 0) at every step').toEqual([]);
    const end = LIFT_STEPS - 1;
    expect([gap(pos[end]!, LIFT.bays['dock.d']!) <= TOL, Math.abs(fork[end]! - FORKS_LOW) <= TOL], 'the vehicle ends at dock.d with its forks at 0.1 m').toEqual([true, true]);
    expect(gap(forksPoint(pos[end]!, heading[end]!, fork[end]!, half), r.pose), 'a load kept on the forks would be far from the rack level\'s pose').toBeGreaterThan(1);
  }, TIMEOUT);
});
