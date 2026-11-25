// AC2 #3265.e9560b44: "A generator that gives one of two floors by the seed's low bit reads 2 distinct of 20 and fails
// at `differ: 0.9`. A planted check that compares each run only with the run before it passes a generator that alternates
// two floors, and fails this test"
//
// The generator (`lowbit`, programs.ts) gives one of two floors by the low bit of the seed its init gets. A run's seed is
// hash(the check's seed, i), so on the check seed PLAIN its floors come in no order and on ALTERNATING they alternate,
// run by run; this suite's own plays read both back.
// - On each seed, through the hub: 2 distinct of 20, and grid.same at differ 0.9, naming depth 1, 20 runs and 2 floors
//   (grid.reach given no `depths`: a depth the runs generated is judged, listed or not). On PLAIN, differ 0.1 passes: 2
//   of 20 is at least that share.
// - The planted check is a planted runner of the plug-in's kit, `previous-run` (README: The surface), which compares
//   each run's floor only with that of the run before it. On the alternating runs it passes, so this criterion's judge
//   (sameWrong) finds fault with it, while the kit's reference fill gives it none; and the kit itself catches the
//   runner: of the kit's cases that set differ, the reference passes each and previous-run fails one with grid.same.
// The wrong programs: the base, which reads no differ; a check that compares a run only with the run before it (it
// passes the alternating runs), one that ignores the ratio and wants every floor distinct or more than one (it fails at
// 0.1, or passes at 0.9), one that judges only listed depths; a kit with no such runner, or whose cases pass it.
import { describe, expect, it } from 'vitest';
import { runKit } from '../../../packages/conformance/src/index.ts';
import { fillOf, reachKit, runFill } from '../556/helpers.ts';
import { AC, DIFFER, TIMEOUT, bench, counted, floorsOf, keep, reachOf, reachSpec, runCheck, sameWrong, told, type Obj } from './helpers.ts';
import { RUNS, SEED, playtest, reach } from './programs.ts';

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

describe(`${AC[2]} two floors in 20 runs fail at differ 0.9, in whatever order the runs give them`, () => {
  it(`${AC[2]} one of two floors by the seed's low bit: 2 distinct of 20, grid.same at 0.9, and a pass at 0.1`, async () => {
    const { pool, hub, play } = await bench();
    const lowbit = keep('lowbit');
    expect(await counted(pool, lowbit, SEED.plain), 'the generator: 2 distinct floors in 20 runs, as this suite plays them').toEqual({ 1: { runs: RUNS, floors: 2 } });
    const r = await runCheck(hub, reachSpec(reach(DIFFER), playtest(lowbit, play, SEED.plain)));
    expect(sameWrong(r, 1, RUNS, 2), `it fails grid.same at differ ${DIFFER}, naming depth 1, 20 runs and 2 floors`).toEqual([]);
    expect(reachOf(r).distinct, 'its result reads 2 distinct at depth 1').toEqual({ 1: 2 });
    const least = await runCheck(hub, reachSpec(reach(2 / RUNS), playtest(lowbit, play, SEED.plain)));
    expect([least.outcome, least.failures], `at differ ${2 / RUNS} the same runs pass: ${told(least)}`).toEqual(['passed', []]);
  }, TIMEOUT);

  it(`${AC[2]} a planted check that compares each run only with the run before it passes the alternating generator, and fails this test`, async () => {
    const { pool, hub, play } = await bench();
    const lowbit = keep('lowbit');
    const grids = (await Promise.all(range(RUNS).map((i) => floorsOf(pool, lowbit, SEED.alternating, i)))).map((fs) => fs.map((f) => f.grid).join());
    expect(grids.every((g, i) => g === grids[i % 2]) && grids[0] !== grids[1], 'on this check seed the 20 runs alternate two floors, as this suite plays them').toBe(true);

    const kit = await reachKit(pool);
    const planted = fillOf(kit, 'previous-run');
    const spec = reachSpec(reach(DIFFER), playtest(lowbit, play, SEED.alternating));
    const wrong = await runFill(planted, spec);
    expect([wrong.outcome, wrong.failures], `the planted check passes the alternating generator: ${told(wrong)}`).toEqual(['passed', []]);
    expect(sameWrong(wrong, 1, RUNS, 2), 'and so fails this test').not.toEqual([]);
    expect(sameWrong(await runFill(fillOf(kit, 'clean'), spec), 1, RUNS, 2), 'the kit\'s reference fill fails it with grid.same, naming depth 1, 20 runs and 2 floors').toEqual([]);
    expect(sameWrong(await runCheck(hub, spec), 1, RUNS, 2), 'and so does grid.reach through the hub').toEqual([]);

    // The kit's own cases that set differ: the reference passes each, the planted check fails one with grid.same.
    const cases = { ...kit, fixtures: (kit['fixtures'] as Obj[]).filter((f) => JSON.stringify(f['input']).includes('"differ"')) };
    const reference = await runKit(cases as never, fillOf(kit, 'clean') as never, { parts: ['fixed'] });
    expect([reference.cases.length > 0, reference.verdict], `the kit has cases that set differ, and its reference passes each: ${JSON.stringify(reference.cases).slice(0, 1500)}`).toEqual([true, 'PASS']);
    const caught = await runKit(cases as never, planted as never, { parts: ['fixed'] });
    expect(caught.cases.some((c) => c.outcome === 'FAIL' && c.codes.includes('grid.same')), `the kit catches previous-run by grid.same: ${JSON.stringify(caught.cases).slice(0, 1500)}`).toBe(true);
  }, TIMEOUT);
});
