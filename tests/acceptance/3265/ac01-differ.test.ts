// AC1 #3265.757907b5: "On a fixture generator played with `piece_seed: run`, 20 runs give 20 distinct floors at depth 1
// and `differ: 0.9` passes. Its twin, which reads no seed, gives 1 distinct floor and fails `grid.same`, naming depth 1,
// 20 runs and 1 floor. The twin passes on the merge base, and that run is shown"
//
// The generator (`clean`, programs.ts) lays its seed's bits out as its floor; its twin `blind` reads no seed. Both reach
// their exit on every floor, so reach alone passes each. This suite's own plays of the 20 run seeds count their floors:
// 20 of 20 and 1 of 20. Through the hub, on the real replica:
// - clean with differ 0.9 passes, 20 runs read, distinct {1: 20};
// - blind with no differ passes (no default: a hand-made level's brief sets none);
// - blind with differ 0.9 fails, with grid.same alone, naming depth 1, 20 runs and 1 floor, distinct {1: 1}.
// The plug-in's manifest lists the code, as it lists each code its kinds raise, and holds its files' digest.
// The wrong programs: the base, which reads no differ (blind passes; its run goes in BASE-FAILURE.txt), a check with a
// default (blind without differ fails), one that counts runs and not floors.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAYTEST_DIR } from '../556/helpers.ts';
import { AC, DIFFER, TIMEOUT, bench, counted, keep, reachOf, reachSpec, runCheck, sameWrong, told } from './helpers.ts';
import { RUNS, SEED, playtest, reach } from './programs.ts';

describe(`${AC[1]} a generator whose 20 runs give 20 floors passes differ 0.9, and its twin that reads no seed fails grid.same`, () => {
  it(`${AC[1]} 20 distinct floors at depth 1 pass; 1 floor in 20 runs fails grid.same, naming depth 1, 20 runs and 1 floor`, async () => {
    const { pool, hub, play } = await bench();
    const clean = keep('clean');
    const blind = keep('blind');
    expect(await counted(pool, clean, SEED.plain), 'the generator: 20 distinct floors in 20 runs, as this suite plays them').toEqual({ 1: { runs: RUNS, floors: RUNS } });
    expect(await counted(pool, blind, SEED.plain), 'its twin: 1 distinct floor in 20 runs').toEqual({ 1: { runs: RUNS, floors: 1 } });

    const passed = await runCheck(hub, reachSpec(reach(DIFFER, [1]), playtest(clean, play, SEED.plain)));
    expect(passed.outcome, `the generator passes grid.reach with differ ${DIFFER}: ${told(passed)}`).toBe('passed');
    expect([passed.testsRun, passed.failures, reachOf(passed).coverage, reachOf(passed).distinct], 'over 20 runs, 20 distinct floors at depth 1').toEqual([RUNS, [], { 1: RUNS }, { 1: RUNS }]);

    const without = await runCheck(hub, reachSpec(reach(undefined, [1]), playtest(blind, play, SEED.plain)));
    expect(without.outcome, `the twin passes with no differ, which has no default: ${told(without)}`).toBe('passed');

    const same = await runCheck(hub, reachSpec(reach(DIFFER, [1]), playtest(blind, play, SEED.plain)));
    expect(same.outcome, `the twin that reads no seed fails grid.reach with differ ${DIFFER}: ${told(same)}`).toBe('failed');
    expect(sameWrong(same, 1, RUNS, 1), 'with grid.same, naming depth 1, 20 runs and 1 floor').toEqual([]);
    expect(same.failures.filter((f) => !f.message.startsWith('grid.same')).map((f) => f.message), 'and nothing else fails').toEqual([]);
    expect([reachOf(same).coverage, reachOf(same).distinct], 'its result counts 1 distinct floor in 20 runs').toEqual([{ 1: RUNS }, { 1: 1 }]);
    const manifest = JSON.parse(readFileSync(join(PLAYTEST_DIR, 'deepbuild.json'), 'utf8')) as { codes: string[]; digest: string };
    expect(manifest.codes, 'the plug-in\'s manifest lists the code').toContain('grid.same');
    expect(manifest.digest, 'and its digest is its files\', so the host installs the plug-in as it ships').toBe((await import('../../../packages/extension-host/src/index.ts')).packageDigest(PLAYTEST_DIR));
  }, TIMEOUT);
});
