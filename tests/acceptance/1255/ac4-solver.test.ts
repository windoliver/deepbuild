// Criterion 4: "A planted solver that gives the speed for 60 s even when it's below the band's minimum fails
// `separation.exact`, naming the mover, the fix and the speed"
//
// Through `deep-logic first_party`, `bake` and `judge` (README: The surface): criterion 3's approach with the band too
// narrow for 60 s (80 to 100 m/s), in a piece that asks delay(follower, 60) at time 0 and applies what it is given.
// Linked by its own name, the kit's planted library for separation.exact gives the speed 60 s needs over entry to
// final, 18,520 m ÷ 260 s = 71.23 m/s, under the band's 80 m/s; applied, separation.exact fails, naming the follower,
// entry, where that speed is given, and the speed. The reference library on the same piece gives a stretch, and
// separation.exact passes.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, arraysAt, bakeCall, bakeOf, logicBin, num, onHost, prebuild, show } from '../190/helpers.ts';
import { AC, EXACT, INTERFACE, PLANTED, judgeCall, judged, layout, piece, plantedFor, plantsPack, recordOf, rule, separation, type Assets } from './helpers.ts';
import { KIND } from './model.ts';
import { script, scriptWrites } from './programs.ts';
import { APPROACH, CITED, HEAVY_LIGHT, NARROW, TOL, approach } from './scenes.ts';

prebuild(() => { logicBin(); });

const { follower, span } = APPROACH;
const ENTRY = 0, FINAL = 1;
/** One step: ask delay(follower, 60) at time 0 and apply the control. */
const solve = (module: string) => script({
  name: 'solve', movers: 3, records: ['given'],
  steps: [[{ op: 'delay', mover: follower, seconds: APPROACH.delay, t: APPROACH.asked, rec: 'given' }, { op: 'apply', rec: 'given' }]],
}, module);

describe(`${AC[4]} a solver that leaves the band fails separation.exact`, () => {
  it(`${AC[4]} a planted solver that gives the speed for 60 s even when it's below the band's minimum fails separation.exact, naming the mover, the fix and the speed`, () => {
    const scene = approach(NARROW, [HEAVY_LIGHT(CITED)]);
    expect(Math.abs(APPROACH.needs - 71.23076923076923) < 1e-12 && APPROACH.needs < NARROW.min, 'the speed for 60 s, 18,520 m ÷ 260 s, is under the band\'s 80 m/s').toBe(true);
    expect([scene.movers[follower]!.id, scene.movers[follower]!.route[ENTRY]!.fix, scene.movers[follower]!.band[ENTRY]], 'the follower\'s band at entry is 80 to 100 m/s').toEqual(['follower', 'entry', { fix: 'entry', ...NARROW }]);

    const S = separation();
    const writes = scriptWrites(3, ['given']);
    layout(writes);
    const planted = plantedFor(S, EXACT);
    const assets: Assets = { ...S.assets };
    const plants = plantsPack(planted, PLANTED[EXACT], assets);
    const twin = piece({ approach: { program: solve(`lib:${PLANTED[EXACT].split('@')[0]!}`), writes, scene, links: [{ name: PLANTED[EXACT], asset: planted.sha }] } }, [plants], assets);
    const reference = piece({ approach: { program: solve(INTERFACE), writes, scene, links: [S.ref] } }, [], S.assets);
    const replies = onHost([bakeCall(twin, 1), judgeCall(twin, 1, span), bakeCall(reference, 1), judgeCall(reference, 1, span)]);

    // The planted solver: the speed for 60 s, under the band, applied; separation.exact names it.
    const bad = bakeOf(replies[0]!, 'the approach\'s bake on the planted solver');
    expect(bad.traps, `the planted solver runs without a trap: ${show(bad.traps as never)}`).toEqual([]);
    const given = recordOf(arraysAt(bad, 'approach', 0), 'given');
    expect([given.ret, given.kind, given.mover, given.from, given.to, given.did], `the planted solver gives a speed from entry to final, and it is applied: ${JSON.stringify(given)}`).toEqual([KIND.speed, KIND.speed, follower, ENTRY, FINAL, 1]);
    expect(Math.abs(given.value - APPROACH.needs), `it is the speed for 60 s, ${APPROACH.needs} m/s, below the band's minimum: ${given.value}`).toBeLessThanOrEqual(TOL);
    const failed = rule(judged(replies[1]!, 'approach'), EXACT);
    expect(failed.verdict, `separation.exact fails on the planted solver's run: ${show(failed.fails as never)}`).toBe('FAIL');
    expect(failed.fails.map((f) => [f['mover'], f['fix']]), 'its one fail names the mover, the follower, and the fix, entry').toEqual([['follower', 'entry']]);
    expect(Math.abs(num(failed.fails[0]!['speed'], 'the fail\'s speed') - APPROACH.needs), 'and the speed, 71.23 m/s').toBeLessThanOrEqual(TOL);

    // The reference library on the same piece: a stretch, and separation.exact passes.
    const good = bakeOf(replies[2]!, 'the approach\'s bake on the reference library');
    const stretch = recordOf(arraysAt(good, 'approach', 0), 'given');
    expect([good.traps, stretch.kind, stretch.did], `the reference library gives a stretch, and it is applied: ${JSON.stringify(stretch)}`).toEqual([[], KIND.stretch, 1]);
    const passed = rule(judged(replies[3]!, 'approach'), EXACT);
    expect([passed.verdict, passed.fails], `separation.exact passes on the reference library's run: ${show(passed.fails as never)}`).toEqual(['PASS', []]);
  }, TIMEOUT);
});
