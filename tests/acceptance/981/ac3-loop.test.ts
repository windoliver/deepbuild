// Criterion 3: "Four vehicles set on a loop of four junctions so that each waits for the next: the loop is broken at the
// step it forms, every vehicle reaches its goal, and `lanes.stuck` passes with a 60 s limit."
//
// Through `deep-logic first_party`, `bake` and `judge` (README: The surface): the loop scene (scenes.ts: LOOP) at 10 Hz,
// vehicle i from park.i to park.(i + 2) round two sides of the square N0..N3, vehicles 1 to 3 sent at step 0 and
// vehicle 0 at step 10, linking the reference library through lanes@1. fixtures.ts (loopRun) works the timeline: 1, 2
// and 3 fail at step 78 on the next one's side and come to rest at step 98; vehicle 0's ask for N1 at step 88 closes the
// loop 0 → 1 → 2 → 3 → 0, and vehicle 0, the lowest ID, takes its detour at once. "Broken at the step it forms": vehicle 0
// runs its rest-to-rest profile over the detour unbroken, within 1e-6 m at every step; a loop broken a step late or
// more would have it braking toward N1 first, and one never broken leaves every vehicle short of its goal. The wrong
// program for lanes.stuck: the straight edge with vehicle 0 parked at rack.b for good and vehicle 1 sent there, which
// waits from step 102 on and fails lanes.stuck at step 702, past 60 s.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, bakeCall, bakeOf, logicBin, num, onHost, prebuild } from '../190/helpers.ts';
import { LOOP_STEPS, STUCK_STEPS, loopFixture, loopGoal, loopRun, stuckRun } from './fixtures.ts';
import { AC, INTERFACE, carry, fixtureDiffers, fixturePiece, gap, judgeCall, judged, lanes, layout, nums, offBy, piece, rule, series } from './helpers.ts';
import { dispatchProgram, lanesWrites } from './programs.ts';
import { LOOP, LOOP_V0_AT, STATE, STRAIGHT, TOL, bay } from './scenes.ts';

prebuild(() => { logicBin(); });

describe(`${AC[3]} a loop of waiting vehicles is broken where it forms`, () => {
  it(`${AC[3]} four vehicles set on a loop of four junctions so that each waits for the next: the loop is broken at the step it forms, every vehicle reaches its goal, and lanes.stuck passes with a 60 s limit`, () => {
    const r = loopRun();
    expect([r.ask, r.ask0, r.rests, r.v3goes, r.arrives0], 'by the reservation rule 1 to 3 fail at step 78 and rest at 98, vehicle 0 closes the loop at 88, 3 goes at 108, 0 reaches park.2 at 252').toEqual([78, 88, 98, 108, 252]);

    const L = lanes();
    const writes = lanesWrites(4);
    layout(writes);
    const program = dispatchProgram('loop', INTERFACE, [0, 1, 2, 3].map((i) => bay(LOOP, `park.${i}`)),
      [1, 2, 3, 0].map((v) => ({ at: v === 0 ? LOOP_V0_AT : 0, v, bay: loopGoal(v) })), 1 / LOOP.rate);
    const f = loopFixture({ program, writes, scene: LOOP });
    const p = fixturePiece(f, L.ref, carry({ ...L.assets }, program));
    const [bake, judge] = onHost([bakeCall(p, f.steps), judgeCall(p, f.steps)]);
    const b = bakeOf(bake!, 'the loop\'s bake');
    expect(fixtureDiffers(b, f), 'the loop fixture\'s expectations hold within 1e-6 m').toEqual([]);
    const pos = [0, 1, 2, 3].map((v) => nums(series(b, 'fixture', 'pos'), v));
    const states = series(b, 'fixture', 'state').map((s) => s.map((x) => num(x, 'a state')));

    // Each waits for the next: 1, 2 and 3 at rest at their next junction's zone, waiting, when the loop has formed.
    for (let k = r.rests + 1; k < r.v3goes; k++) {
      [1, 2, 3].forEach((v, i) => {
        expect(gap(pos[v]![k]!, r.waiting[i]!), `vehicle ${v} waits at its junction's zone at step ${k}: ${JSON.stringify(pos[v]![k])}`).toBeLessThanOrEqual(TOL);
        expect(states[k]![v], `vehicle ${v} is waiting at step ${k}`).toBe(STATE.waiting);
      });
    }
    // Broken at the step it forms: vehicle 0 never brakes for N1, and runs the detour's profile at every step.
    expect(offBy(pos[0]!, (k) => r.v0(k), TOL, 'vehicle 0'), 'vehicle 0 runs its rest-to-rest profile over the detour, within 1e-6 m at every step').toEqual([]);
    expect(states.map((s) => s[0]).filter((s) => s === STATE.waiting), 'vehicle 0 never waits').toEqual([]);
    // Every vehicle reaches its goal.
    const last = LOOP_STEPS - 1;
    [0, 1, 2, 3].forEach((v) => {
      const goal = LOOP.bays[`park.${(v + 2) % 4}`]!;
      expect(gap(pos[v]![last]!, goal), `vehicle ${v} is at park.${(v + 2) % 4}: ${JSON.stringify(pos[v]![last])}`).toBeLessThanOrEqual(TOL);
      expect(states[last]![v], `vehicle ${v} is parked there`).toBe(STATE.parked);
    });
    const stuck = rule(judged(judge!, 'fixture'), 'lanes.stuck');
    expect([stuck.verdict, stuck.steps, stuck.fails], 'lanes.stuck passes with its 60 s limit').toEqual(['PASS', LOOP_STEPS, []]);
  }, TIMEOUT);

  it(`${AC[3]} lanes.stuck fails a run in which a vehicle waits past 60 s, naming it and the step`, () => {
    const r = stuckRun();
    const L = lanes();
    const writes = lanesWrites(2);
    layout(writes);
    const program = dispatchProgram('stuck', INTERFACE, [bay(STRAIGHT, 'rack.b'), bay(STRAIGHT, 'park.a')], [{ at: 0, v: 1, bay: bay(STRAIGHT, 'rack.b') }], 1 / STRAIGHT.rate);
    const p = piece({ fixture: { program, writes, scene: STRAIGHT, links: [L.ref] } }, [], carry({ ...L.assets }, program));
    const [bake, judge] = onHost([bakeCall(p, STUCK_STEPS), judgeCall(p, STUCK_STEPS)]);
    const b = bakeOf(bake!, 'the stuck run\'s bake');
    const pos = nums(series(b, 'fixture', 'pos'), 1);
    const states = series(b, 'fixture', 'state').map((s) => num(s[1], 'a state'));
    expect(states.indexOf(STATE.waiting), 'vehicle 1 waits from step 102, when it comes to rest').toBe(r.waits);
    for (let k = r.waits; k < STUCK_STEPS; k++) expect(gap(pos[k]!, r.stop), `vehicle 1 waits at 16.5 m at step ${k}`).toBeLessThanOrEqual(TOL);
    const stuck = rule(judged(judge!, 'fixture'), 'lanes.stuck');
    expect(stuck.verdict, 'lanes.stuck fails').toBe('FAIL');
    expect([stuck.fails[0]!['vehicle'], stuck.fails[0]!['step']], 'its first fail names vehicle 1 and step 702, when its wait passes 60 s').toEqual([1, r.fails]);
    expect(num(stuck.fails[0]!['waited'], 'the fail\'s waited'), 'having waited past 60 s').toBeGreaterThan(60);
  }, TIMEOUT);
});
