// Criterion 1: "Two movers on straight crossing routes at fixture speeds: `closest` gives the analytic smallest
// distance and its time within 1e-6 m and 1e-6 s. On a fixture whose pair is under its 5,556 m minimum for 0.6 s
// between two whole seconds, `conflicts` returns that window within 1e-6 s, and the planted once-a-second library
// returns none and fails `separation.clear`, naming the pair"
//
// Through `deep-logic first_party`, `bake` and `judge` (README: The surface), a piece linking separation@1's reference
// library through the interface, and the same piece linking the kit's planted library for separation.clear by its own
// name.
// - The crossing (scenes.ts: CROSSING): by hand, 2,400 m at 107.2 s, inside the span and not zero. The model gives it
//   and its wrong twin, a sampler at whole seconds, doesn't.
// - The breach (scenes.ts: BREACH): by hand, under 5,556 m from 100.2 s to 100.8 s. The piece keeps watch: step 0 asks
//   `conflicts`; step 1 applies its own fix, a hold of north by 120 s, when the state holds a window, and asks again.
//   On the reference library it finds the window, holds north and is clear, so separation.clear passes; on the planted
//   library it finds none, holds nothing, and separation.clear fails, naming the pair, its window and no row.
// - That the planted library is the once-a-second one, not one that finds nothing: on the crossing, where the pair is
//   under the minimum for 40 s, its window runs from second 88 to second 127, the whole seconds inside the true one.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, arr, arraysAt, bakeCall, bakeOf, logicBin, num, onHost, prebuild, show } from '../190/helpers.ts';
import {
  AC, CLEAR, INTERFACE, PLANTED, closestOf, judgeCall, judged, layout, piece, plantedFor, plantsPack, rule, separation, windowsDiffer, windowsOf, type Assets,
} from './helpers.ts';
import { KIND, WHY, apply, closest, conflicts, flyAll, sampledClosest, sampledConflicts } from './model.ts';
import { script, scriptWrites } from './programs.ts';
import { BREACH, CROSSING, LATERAL, TOL } from './scenes.ts';

prebuild(() => { logicBin(); });

const WRITES = scriptWrites(2);
/** The crossing's piece's program: one step that asks `closest` of the pair and `conflicts`, both over the span. */
const crossingProgram = (module: string) => script({ name: 'crossing', movers: 2, steps: [[{ op: 'closest', a: 0, b: 1, span: CROSSING.span }, { op: 'conflicts', span: CROSSING.span }]] }, module);
/** The breach's piece's program: watch at step 0, then hold north when a window was found and watch again. */
const keeperProgram = (module: string) => script({
  name: 'keeper', movers: 2,
  steps: [[{ op: 'conflicts', span: BREACH.span }], [{ op: 'hold_if_conflict', ...BREACH.hold }, { op: 'conflicts', span: BREACH.span }]],
}, module);

describe(`${AC[1]} closest approach and a breach between two samples, in closed form`, () => {
  it(`${AC[1]} two movers on straight crossing routes at fixture speeds: closest gives the analytic smallest distance and its time within 1e-6 m and 1e-6 s`, () => {
    const flown = flyAll(CROSSING.scene);
    const want = closest(flown[0]!, flown[1]!, ...CROSSING.span)!;
    expect([Math.abs(want.dist - 2400) < 1e-9, Math.abs(want.time - 107.2) < 1e-9], `the model gives the case worked by hand, 2,400 m at 107.2 s: ${JSON.stringify(want)}`).toEqual([true, true]);
    expect(CROSSING.closest.time > CROSSING.span[0] && CROSSING.closest.time < CROSSING.span[1] && CROSSING.closest.dist > 0, 'the smallest distance is inside the span and not zero').toBe(true);
    const wrong = sampledClosest(flown[0]!, flown[1]!, ...CROSSING.span)!;
    expect(Math.abs(wrong.dist - 2400) > TOL && Math.abs(wrong.time - 107.2) > TOL, `the model's wrong twin, a sampler at whole seconds, misses both: ${JSON.stringify(wrong)}`).toBe(true);

    const S = separation();
    layout(WRITES);
    const program = crossingProgram(INTERFACE);
    const [reply] = onHost([bakeCall(piece({ crossing: { program, writes: WRITES, scene: CROSSING.scene, links: [S.ref] } }, [], S.assets), 1)]);
    const b = bakeOf(reply!, 'the crossing\'s bake');
    expect(b.traps, `the crossing runs without a trap: ${show(b.traps as never)}`).toEqual([]);
    const got = closestOf(arraysAt(b, 'crossing', 0));
    expect([got.a, got.b], 'the closest pair is the two movers').toEqual([0, 1]);
    expect(Math.abs(got.dist - CROSSING.closest.dist), `closest gives ${got.dist} m: 2,400 m within 1e-6 m`).toBeLessThanOrEqual(TOL);
    expect(Math.abs(got.time - CROSSING.closest.time), `closest gives its time as ${got.time} s: 107.2 s within 1e-6 s`).toBeLessThanOrEqual(TOL);
    // The same run's `conflicts`: the true window, which the next test's planted library must miss the ends of.
    expect(windowsDiffer(windowsOf(arraysAt(b, 'crossing', 0)), conflicts(CROSSING.scene, flown, ...CROSSING.span), TOL), 'and conflicts gives the 40 s the pair is under 5,556 m, in closed form').toEqual([]);
  }, TIMEOUT);

  it(`${AC[1]} on a fixture whose pair is under its 5,556 m minimum for 0.6 s between two whole seconds, conflicts returns that window within 1e-6 s, and the planted once-a-second library returns none and fails separation.clear, naming the pair`, () => {
    // The breach by the model: the window worked by hand, strictly between the seconds 100 and 101, which a sampler never sees.
    const flown = flyAll(BREACH.scene);
    const want = conflicts(BREACH.scene, flown, ...BREACH.span);
    expect(want.map((w) => [w.a, w.b, w.min, w.row]), 'the breach is one window of the pair under the table\'s 5,556 m').toEqual([[0, 1, LATERAL, -1]]);
    const { from, to } = want[0]!;
    expect([Math.abs(from - BREACH.window.from) < 1e-9, Math.abs(to - BREACH.window.to) < 1e-9], `the model gives the window worked by hand, 100.2 s to 100.8 s: ${from} to ${to}`).toEqual([true, true]);
    expect(Math.floor(from) === Math.floor(to) && from > Math.floor(from) && to < Math.floor(from) + 1 && Math.abs(to - from - 0.6) < 1e-9, 'it lasts 0.6 s, strictly between two whole seconds').toBe(true);
    expect(sampledConflicts(BREACH.scene, flown, ...BREACH.span), 'a sampler at whole seconds finds no window in it').toEqual([]);
    // The piece's own fix clears it: north held 120 s passes 8,844.5 m from east.
    const held = [flown[0]!, apply(flown[1]!, { kind: KIND.hold, mover: BREACH.hold.mover, from: -1, to: -1, value: BREACH.hold.seconds, why: WHY.none })];
    expect(conflicts(BREACH.scene, held, ...BREACH.span), 'with north held 120 s the pair is clear').toEqual([]);
    expect(Math.abs(closest(held[0]!, held[1]!, ...BREACH.span)!.dist - BREACH.passAfter), 'held, they pass 14,400 m less the first pass apart').toBeLessThan(1e-6);
    // The crossing by the sampler: the whole seconds inside the true window.
    const across = flyAll(CROSSING.scene);
    const sampled = sampledConflicts(CROSSING.scene, across, ...CROSSING.span);
    const exact = conflicts(CROSSING.scene, across, ...CROSSING.span);
    expect(sampled.map((w) => [w.from, w.to]), 'on the crossing a sampler\'s window is seconds 88 to 127').toEqual([[88, 127]]);
    expect(exact.map((w) => [Math.abs(w.from - (107.2 - CROSSING.half)) < 1e-9, Math.abs(w.to - (107.2 + CROSSING.half)) < 1e-9]), 'and the true one 107.2 s less and plus √(5556² − 2400²) ÷ 250 s').toEqual([[true, true]]);

    const S = separation();
    layout(WRITES);
    const planted = plantedFor(S, CLEAR);
    const assets: Assets = { ...S.assets };
    const plants = plantsPack(planted, PLANTED[CLEAR], assets);
    const own = { name: PLANTED[CLEAR], asset: planted.sha }, module = `lib:${PLANTED[CLEAR].split('@')[0]!}`;
    const reference = piece({ breach: { program: keeperProgram(INTERFACE), writes: WRITES, scene: BREACH.scene, links: [S.ref] } }, [], S.assets);
    const twin = piece({ breach: { program: keeperProgram(module), writes: WRITES, scene: BREACH.scene, links: [own] } }, [plants], assets);
    const twinAcross = piece({ crossing: { program: crossingProgram(module), writes: WRITES, scene: CROSSING.scene, links: [own] } }, [plants], assets);
    const replies = onHost([bakeCall(reference, 2), judgeCall(reference, 2, BREACH.span), bakeCall(twin, 2), judgeCall(twin, 2, BREACH.span), bakeCall(twinAcross, 1)]);

    // The reference library: the window, then none once north is held, and separation.clear passes.
    const ref = bakeOf(replies[0]!, 'the breach\'s bake on the reference library');
    expect(ref.traps, `the breach runs without a trap: ${show(ref.traps as never)}`).toEqual([]);
    expect(windowsDiffer(windowsOf(arraysAt(ref, 'breach', 0)), want, TOL), 'conflicts returns the 0.6 s window within 1e-6 s').toEqual([]);
    expect(windowsOf(arraysAt(ref, 'breach', 1)), 'the piece held north, and conflicts is then empty').toEqual([]);
    const passed = rule(judged(replies[1]!, 'breach'), CLEAR);
    expect([passed.verdict, passed.fails], `separation.clear passes on the reference library's run: ${show(passed.fails as never)}`).toEqual(['PASS', []]);

    // The planted library: no window at either step, so nothing is held, and separation.clear fails, naming the pair.
    const bad = bakeOf(replies[2]!, 'the breach\'s bake on the planted library');
    expect(bad.traps, `the planted library runs without a trap: ${show(bad.traps as never)}`).toEqual([]);
    expect([windowsOf(arraysAt(bad, 'breach', 0)), windowsOf(arraysAt(bad, 'breach', 1))], 'the planted once-a-second library returns none').toEqual([[], []]);
    const failed = rule(judged(replies[3]!, 'breach'), CLEAR);
    expect(failed.verdict, `separation.clear fails on the planted library's run: ${show(failed.fails as never)}`).toBe('FAIL');
    expect(failed.fails.map((f) => [f['pair'], f['row']]), 'its one fail names the pair, east and north, and no row').toEqual([[['east', 'north'], null]]);
    const window = arr(failed.fails[0]!['window'], 'the fail\'s window').map((x) => num(x, 'a window end'));
    expect(window.length === 2 && Math.abs(window[0]! - from) <= TOL && Math.abs(window[1]! - to) <= TOL, `and its window, ${from} s to ${to} s within 1e-6 s: ${JSON.stringify(window)}`).toBe(true);

    // It is the once-a-second library: on the crossing it gives the whole seconds inside the true window.
    const across2 = bakeOf(replies[4]!, 'the crossing\'s bake on the planted library');
    expect(windowsDiffer(windowsOf(arraysAt(across2, 'crossing', 0)), sampled, 1e-9), 'on the crossing the planted library\'s window runs from second 88 to second 127').toEqual([]);
  }, TIMEOUT);
});
