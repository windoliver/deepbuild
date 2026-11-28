import { describe, expect, it } from 'vitest';
import { EXIT, nokeyFacts, walledFacts } from './floors.ts';
import { TIMEOUT, bench, floorOfRun, judge, keep, none, publishes, reachSpec, runCheck } from './helpers.ts';
import { INCONCLUSIVE, SKIPPED, UNREACHED, inconclusiveWrong, noSkippedWrong, onlyInconclusiveWrong, unreachedOnceWrong } from './judges.ts';
import { RUNS, playtest, reach, type Need } from './programs.ts';

const ID = 'AC3 #3263.d8cd5e67';
const NEEDS: Need[] = [{ goal: 'exit', through: ['key'] }];

describe(`${ID} an exit the plain search doesn't reach stays one failure, and a need with nothing to close is INCONCLUSIVE`, () => {
  it(`${ID} a floor whose exit is walled in fails grid.unreached once with no grid.skipped, and a floor with no key cell reads the need INCONCLUSIVE, naming the floor and the class key, never PASS`, async () => {
    none(walledFacts(), 'the walled floor, by this suite\'s own search: its exit is unreached with its key, every open cell reached');
    none(nokeyFacts(), 'the floor with no key cell, by this suite\'s own search: its exit is reached, and it holds no key cell to close');
    const { pool, hub, play } = await bench();
    const walled = keep('walled');
    const nokey = keep('nokey');
    await publishes(pool, walled, 'walled');
    await publishes(pool, nokey, 'nokey');

    const unreached = await runCheck(hub, reachSpec(reach(NEEDS), playtest(walled, play)));
    for (let i = 0; i < RUNS; i++) {
      expect(unreachedOnceWrong(unreached, { ...floorOfRun(i), goal: EXIT }), `run ${i}'s walled floor fails ${UNREACHED} once, naming the exit, and nothing else of that floor fails`).toEqual([]);
    }
    expect(noSkippedWrong(unreached, RUNS), `the walled floor's result holds no ${SKIPPED}, and one failure a floor: its need isn't judged`).toEqual([]);

    const unsure = await runCheck(hub, reachSpec(reach(NEEDS), playtest(nokey, play)));
    for (let i = 0; i < RUNS; i++) {
      expect(inconclusiveWrong(unsure, { ...floorOfRun(i), through: 'key' }), `run ${i}'s floor with no key cell reads the need INCONCLUSIVE: the outcome uncounted, a failure starting ${INCONCLUSIVE} that names the run, its seed, its depth and the class key`).toEqual([]);
    }
    expect(onlyInconclusiveWrong(unsure, RUNS), 'and nothing else is reported: the floor passes every other criterion').toEqual([]);
    const v = judge(unsure, 'definition');
    expect([v.outcome, v.requirements[0]?.outcome], `the verdict on a requirement it covers is never PASS: ${JSON.stringify(v.reasons).slice(0, 600)}`).not.toContain('PASS');
  }, TIMEOUT);
});
