// Criterion 2: "Two vehicles reach one junction at the same step: the lower ID goes first, the other stops at the zone
// boundary before the junction within 1e-6 m and goes at the step the first leaves the zone after the junction.
// `lanes.clear` passes at every step."
//
// Through `deep-logic first_party`, `bake` and `judge` (README: The surface): the merge scene (scenes.ts: MERGE) at 10
// Hz, vehicle 0 from park.w and vehicle 1 from park.s, 20 m from the junction J each, both onto c1, linking the
// reference library through lanes@1. fixtures.ts (mergeRun) works the timeline: both ask for J at step 88; vehicle 1
// comes to rest at (0, −2.25), its front at J's zone 1.25 m out; vehicle 0's rear passes the end of c1.0, the zone
// after J, inside step 133, and vehicle 1 goes in that step. The wrong program for lanes.clear, the planted library
// that enters a held zone, is criterion 6's (ac6-refusals.test.ts).
import { describe, expect, it } from 'vitest';
import { TIMEOUT, bakeCall, bakeOf, logicBin, num, onHost, prebuild } from '../190/helpers.ts';
import { MERGE_STEPS, mergeFixture, mergeRun } from './fixtures.ts';
import { AC, INTERFACE, carry, fixtureDiffers, fixturePiece, gap, judgeCall, judged, lanes, layout, nums, rule, series } from './helpers.ts';
import { dispatchProgram, lanesWrites } from './programs.ts';
import { MERGE, STATE, TOL, bay, pathZones } from './scenes.ts';

prebuild(() => { logicBin(); });

describe(`${AC[2]} two vehicles at one junction`, () => {
  it(`${AC[2]} two vehicles reach one junction at the same step: the lower ID goes first, the other stops at the zone boundary before it within 1e-6 m and goes at the step the first leaves the zone after it; lanes.clear passes at every step`, () => {
    const r = mergeRun();
    expect([r.ask, r.rests, r.goes], 'by the reservation rule both ask for J at step 88, vehicle 1 is at rest by step 108 and goes at step 133').toEqual([88, 108, 133]);
    const after = pathZones(MERGE, 'c1').zones[0]!;
    expect(after, 'c1.0, the zone after J, runs 1.25 m to 3.75 m along c1').toEqual([1.25, 3.75]);

    const L = lanes();
    const writes = lanesWrites(2);
    layout(writes);
    const program = dispatchProgram('merge', INTERFACE, [bay(MERGE, 'park.w'), bay(MERGE, 'park.s')],
      [{ at: 0, v: 0, bay: bay(MERGE, 'dock.e') }, { at: 0, v: 1, bay: bay(MERGE, 'rack.m') }], 1 / MERGE.rate);
    const f = mergeFixture({ program, writes, scene: MERGE });
    const p = fixturePiece(f, L.ref, carry({ ...L.assets }, program));
    const [bake, judge] = onHost([bakeCall(p, f.steps), judgeCall(p, f.steps)]);
    const b = bakeOf(bake!, 'the merge\'s bake');
    expect(fixtureDiffers(b, f), 'the merge fixture\'s expectations hold within 1e-6 m').toEqual([]);
    const pos = [0, 1].map((v) => nums(series(b, 'fixture', 'pos'), v));
    const states = series(b, 'fixture', 'state').map((s) => s.map((x) => num(x, 'a state')));
    const start = [MERGE.bays['park.w']!, MERGE.bays['park.s']!];

    // The same step: until they ask, the two have come exactly as far, each from its own bay.
    const apart = Array.from({ length: r.ask }, (_, k) => Math.abs(gap(pos[0]![k]!, start[0]!) - gap(pos[1]![k]!, start[1]!))).filter((d) => d > 1e-9);
    expect(apart, 'the two run the same distance until they reach J\'s zone').toEqual([]);
    // The lower ID goes first: vehicle 0 never waits, and it is past J while vehicle 1 waits short of it.
    expect(states.map((s) => s[0]).filter((s) => s === STATE.waiting), 'vehicle 0 never waits').toEqual([]);
    expect(pos[0]![r.goes - 1]![0], 'vehicle 0 is past J when vehicle 1 last waits').toBeGreaterThan(0);
    // The other stops at the zone boundary before J within 1e-6 m, and waits there.
    const waits = Array.from({ length: r.goes - r.rests - 1 }, (_, i) => r.rests + 1 + i);
    for (const k of waits) {
      expect(gap(pos[1]![k]!, r.stopAt), `vehicle 1 at step ${k} is at (0, −2.25), its front at J's zone, within 1e-6 m: ${JSON.stringify(pos[1]![k])}`).toBeLessThanOrEqual(TOL);
      expect(states[k]![1], `vehicle 1 is waiting at step ${k}`).toBe(STATE.waiting);
    }
    // It goes at the step the first leaves the zone after J: vehicle 0's rear first past 3.75 m.
    const leaves = pos[0]!.findIndex((q) => q[0]! - MERGE.vehicle.length / 2 > after[1] + 1e-9);
    expect(leaves, 'vehicle 0\'s rear leaves c1.0 at step 133').toBe(r.goes);
    expect(gap(pos[1]![leaves - 1]!, r.stopAt), 'vehicle 1 is still at the boundary the step before').toBeLessThanOrEqual(TOL);
    expect(gap(pos[1]![leaves]!, r.stopAt), 'and moves at the step vehicle 0 leaves c1.0').toBeGreaterThan(1e-9);
    expect(states[leaves]![1], 'driving again').toBe(STATE.driving);

    const clear = rule(judged(judge!, 'fixture'), 'lanes.clear');
    expect([clear.verdict, clear.steps, clear.fails], 'lanes.clear passes at every step of the run').toEqual(['PASS', MERGE_STEPS, []]);
  }, TIMEOUT);
});
