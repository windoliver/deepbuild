// Criterion 3: "`delay(follower, 60)` with a band that allows it returns a speed control; after `apply`, the follower
// passes the threshold 60 s later within 0.5 s, every speed stays inside its band, `separation.exact` passes and
// `conflicts` is empty. With a band too narrow for 60 s it returns a stretch, and for a departure not yet started a
// hold; with neither possible it refuses, naming the band"
//
// Through `deep-logic first_party`, `bake` and `judge` (README: The surface), on criterion 2's approach with its row.
// - The band that allows it (60 to 100 m/s): step 0 asks `conflicts` (the one window); step 1 asks
//   delay(follower, 60) at time 0, applies the control and asks `conflicts` again. By hand the leg entry to final,
//   18,520 m in 200 s, takes 260 s at 71.23 m/s, so the follower is at the threshold at 560 s, not 500 s, and
//   14,816 m behind the leader when it is measured.
// - The band too narrow (80 to 100 m/s), the same piece but for the follower's band. Step 0 asks three delays of
//   60 s: of the follower at 250 s, when it has started and only its last leg, final to threshold, is left: no speed
//   (the band), no stretch (the last leg), no hold (it has started), so it refuses, naming the band at final; of the
//   follower at time 0: the leg entry to final isn't its last, so a stretch; of the departure, not yet started on its
//   one leg, at time 0: a hold. Step 1 applies the stretch and the hold, and separation.exact passes on both.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, arraysAt, bakeCall, bakeOf, logicBin, onHost, prebuild, show } from '../190/helpers.ts';
import { AC, EXACT, INTERFACE, judgeCall, judged, layout, piece, recordOf, rule, separation, slotsOf, windowsOf } from './helpers.ts';
import { KIND, WHY, apart, apply, conflicts, delay, flyAll } from './model.ts';
import { script, scriptWrites } from './programs.ts';
import { APPROACH, CITED, DELAY_TOL, HEAVY_LIGHT, NARROW, WIDE, approach } from './scenes.ts';

prebuild(() => { logicBin(); });

const { leader, follower, departure, span, asked, late } = APPROACH;
const ENTRY = 0, FINAL = 1, THRESHOLD = 2;

describe(`${AC[3]} a delay by speed, by path or by hold, or a refusal that names the band`, () => {
  it(`${AC[3]} delay(follower, 60) with a band that allows it returns a speed control; after apply, the follower passes the threshold 60 s later within 0.5 s, every speed stays inside its band, separation.exact passes and conflicts is empty`, () => {
    const scene = approach(WIDE, [HEAVY_LIGHT(CITED)]);
    const before = flyAll(scene);
    const control = delay(scene.movers[follower]!, follower, before[follower]!, APPROACH.delay, asked);
    expect([control.kind, control.from, control.to, Math.abs(control.value - APPROACH.needs) < 1e-9, control.value >= WIDE.min], 'by the model: a speed from entry to final, 18,520 m ÷ 260 s, inside the band').toEqual([KIND.speed, ENTRY, FINAL, true, true]);
    const after = before.map((s, m) => (m === follower ? apply(s, control) : s));
    expect([before[follower]![THRESHOLD]!.time, Math.abs(after[follower]![THRESHOLD]!.time - 560) < 1e-9], 'by hand: at the threshold at 500 s, and at 560 s once delayed').toEqual([APPROACH.threshold, true]);
    expect(Math.abs(apart(after[leader]!, after[follower]!, APPROACH.measured)!.lateral - APPROACH.behindAfter) < 1e-6, 'and 14,816 m behind when the leader is measured').toBe(true);
    expect([conflicts(scene, before, ...span).length, conflicts(scene, after, ...span)], 'by the model: one window before the delay, none after').toEqual([1, []]);

    const S = separation();
    const writes = scriptWrites(3, ['given']);
    layout(writes);
    const program = script({
      name: 'delayed', movers: 3, records: ['given'],
      steps: [[{ op: 'conflicts', span }], [{ op: 'delay', mover: follower, seconds: APPROACH.delay, t: asked, rec: 'given' }, { op: 'apply', rec: 'given' }, { op: 'conflicts', span }]],
    }, INTERFACE);
    const p = piece({ approach: { program, writes, scene, links: [S.ref] } }, [], S.assets);
    const replies = onHost([bakeCall(p, 2), judgeCall(p, 2, span)]);
    const b = bakeOf(replies[0]!, 'the delayed approach\'s bake');
    expect(b.traps, `the approach runs without a trap: ${show(b.traps as never)}`).toEqual([]);
    expect(windowsOf(arraysAt(b, 'approach', 0)).length, 'before the delay the follower is in conflict').toBe(1);
    const arrays = arraysAt(b, 'approach', 1);
    const given = recordOf(arrays, 'given');
    expect([given.ret, given.kind, given.mover, given.from, given.to], `delay(follower, 60) returns a speed control, from entry to final: ${JSON.stringify(given)}`).toEqual([KIND.speed, KIND.speed, follower, ENTRY, FINAL]);
    expect(given.did, 'apply took it').toBe(1);
    const slots = slotsOf(arrays, follower);
    const threshold = slots.find((s) => s.ref === THRESHOLD);
    expect(threshold, `the follower still passes the threshold: ${JSON.stringify(slots)}`).toBeDefined();
    expect(Math.abs(threshold!.time - (APPROACH.threshold + APPROACH.delay)), `the follower passes the threshold at ${threshold!.time} s: 60 s after 500 s, within 0.5 s`).toBeLessThanOrEqual(DELAY_TOL);
    const outside = scene.movers.flatMap((m, i) => slotsOf(arrays, i).slice(0, -1).flatMap((s) => {
      const band = m.band.find((x) => x.fix === m.route[s.ref]?.fix);
      return band && s.speed >= band.min && s.speed <= band.max ? [] : [`${m.id} from ${m.route[s.ref]?.fix}: ${s.speed} m/s, band ${JSON.stringify(band)}`];
    }));
    expect(outside, 'every speed stays inside its band').toEqual([]);
    expect(given.value >= WIDE.min && given.value <= WIDE.max, `the speed it gives, ${given.value} m/s, is inside the band`).toBe(true);
    const exact = rule(judged(replies[1]!, 'approach'), EXACT);
    expect([exact.verdict, exact.fails], `separation.exact passes: ${show(exact.fails as never)}`).toEqual(['PASS', []]);
    expect(windowsOf(arrays), 'conflicts is empty').toEqual([]);
  }, TIMEOUT);

  it(`${AC[3]} with a band too narrow for 60 s it returns a stretch, and for a departure not yet started a hold; with neither possible it refuses, naming the band`, () => {
    const scene = approach(NARROW, [HEAVY_LIGHT(CITED)]), wide = approach(WIDE, [HEAVY_LIGHT(CITED)]);
    expect(scene.movers.map((m, i) => (i === follower ? { ...m, band: [] } : m)), 'the two approach pieces differ in the follower\'s band alone').toEqual(wide.movers.map((m, i) => (i === follower ? { ...m, band: [] } : m)));
    const flown = flyAll(scene);
    expect(APPROACH.needs < NARROW.min && APPROACH.needs >= WIDE.min, 'the speed 60 s needs, 71.23 m/s, is under the narrow band\'s 80 m/s and inside the wide one').toBe(true);
    const model = [delay(scene.movers[follower]!, follower, flown[follower]!, 60, asked), delay(scene.movers[departure]!, departure, flown[departure]!, 60, asked), delay(scene.movers[follower]!, follower, flown[follower]!, 60, late)];
    expect(model.map((c) => [c.kind, c.why, c.mover, c.from]), 'by the rule: a stretch from entry, a hold, and a refusal naming the band at final').toEqual([[KIND.stretch, WHY.none, follower, ENTRY], [KIND.hold, WHY.none, departure, -1], [KIND.refused, WHY.band, follower, FINAL]]);
    expect(flown[follower]![ENTRY]!.time < late && late < flown[follower]![FINAL]!.time && asked < flown[departure]![0]!.time, 'at 250 s the follower is past entry and short of final; at 0 the departure has not started').toBe(true);

    const S = separation();
    const writes = scriptWrites(3, ['refused', 'stretch', 'hold']);
    layout(writes);
    const program = script({
      name: 'narrow', movers: 3, records: ['refused', 'stretch', 'hold'],
      steps: [
        [
          { op: 'delay', mover: follower, seconds: 60, t: late, rec: 'refused' },
          { op: 'delay', mover: follower, seconds: 60, t: asked, rec: 'stretch' },
          { op: 'delay', mover: departure, seconds: 60, t: asked, rec: 'hold' },
        ],
        [{ op: 'apply', rec: 'stretch' }, { op: 'apply', rec: 'hold' }],
      ],
    }, INTERFACE);
    const p = piece({ approach: { program, writes, scene, links: [S.ref] } }, [], S.assets);
    const replies = onHost([bakeCall(p, 2), judgeCall(p, 2, span)]);
    const b = bakeOf(replies[0]!, 'the narrow approach\'s bake');
    expect(b.traps, `the approach runs without a trap: ${show(b.traps as never)}`).toEqual([]);
    const arrays = arraysAt(b, 'approach', 1);
    const stretch = recordOf(arrays, 'stretch'), hold = recordOf(arrays, 'hold'), refused = recordOf(arrays, 'refused');
    expect([stretch.ret, stretch.kind, stretch.mover, stretch.from, stretch.to], `with a band too narrow for 60 s it returns a stretch, leaving at entry and rejoining at final: ${JSON.stringify(stretch)}`).toEqual([KIND.stretch, KIND.stretch, follower, ENTRY, FINAL]);
    expect([hold.ret, hold.kind, hold.mover], `for a departure not yet started it returns a hold: ${JSON.stringify(hold)}`).toEqual([KIND.hold, KIND.hold, departure]);
    expect([refused.ret, refused.kind, refused.why, refused.mover, refused.from], `with neither possible it refuses, naming the band: the follower's at final: ${JSON.stringify(refused)}`).toEqual([KIND.refused, KIND.refused, WHY.band, follower, FINAL]);
    // Each control it returned gives the delay it was asked for: applied, both pass separation.exact.
    expect([stretch.did, hold.did], 'apply took the stretch and the hold').toEqual([1, 1]);
    const exact = rule(judged(replies[1]!, 'approach'), EXACT);
    expect([exact.verdict, exact.fails], `separation.exact passes on the stretch and the hold: ${show(exact.fails as never)}`).toEqual(['PASS', []]);
  }, TIMEOUT);
});
