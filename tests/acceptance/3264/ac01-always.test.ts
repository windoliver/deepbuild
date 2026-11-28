import { describe, expect, it } from 'vitest';
import { AC, LIMIT, hpBreaks, hubOver, keep, manifestCodes, readRuns, replayed, replaysNeverBelow, runPlaytest, stage, told, type Obj, type Pool, type Reading } from './helpers.ts';
import { alwaysWrong, firstBelow, type Break } from './judges.ts';
import { EXPLORER, NEVER_NEGATIVE, PATH, RUNS, TRAP_TAKES, WOUNDED_HP, playtest } from './programs.ts';

const RULE = { always: [NEVER_NEGATIVE] };

async function twinBreaks(pool: Pool, at: string, play: Obj): Promise<{ runs: Reading[]; breaks: Map<string, Break> }> {
  const runs = await readRuns(pool, at, play, { bot: EXPLORER });
  const breaks = hpBreaks(runs);
  expect(breaks.size > 0 && breaks.size < RUNS, `the twin, as this suite plays its 20 runs: hp reads below 0 in some runs and not in all: ${[...breaks.keys()].join(', ')}`).toBe(true);
  for (const r of runs.filter((x) => breaks.has(x.test))) {
    const { step } = breaks.get(r.test)!;
    expect([r.hp[step - 1], r.hp[step]], `${r.test}: at step ${step} its trap takes ${TRAP_TAKES} from a unit at ${WOUNDED_HP}`).toEqual([WOUNDED_HP, WOUNDED_HP - TRAP_TAKES]);
    expect(firstBelow((await replayed(pool, at, r)).hp, 0)?.step, `${r.test}: its track played again without its bot reads below 0 first at step ${step} too`).toBe(step);
  }
  return { runs, breaks };
}

describe(`AC1 ${AC[1]} always: hp >= 0 holds over the crawler's 20 runs and fails its twin at the step hp goes below 0`, () => {
  it(`AC1 ${AC[1]} the twin whose trap takes 5 from a unit at 2 passes with no rule and fails playtest.always, naming the run, the step and hp -3, its replay at the same step; the fixture passes`, async () => {
    const { pool, hub, play } = await stage();
    const clean = keep('clean');
    const spikes = keep('spikes');
    const kept = await readRuns(pool, clean, play, { bot: EXPLORER });
    expect(kept.filter((r) => Math.min(...r.hp) < 0).map((r) => r.test), 'the fixture, as this suite plays its 20 runs: hp never reads below 0').toEqual([]);
    expect(kept.some((r) => Math.min(...r.hp) === 0), 'and its trap leaves a unit at 2 at 0').toBe(true);
    const { runs, breaks } = await twinBreaks(pool, spikes, play);
    expect(runs.filter((r) => !r.door.some((v) => v !== 0) || !r.won.some((v) => v !== 0)).map((r) => r.test), 'every run of the twin opens the door and reaches the exit').toEqual([]);

    const bare = await runPlaytest(hub, playtest(spikes, play));
    expect([bare.outcome, bare.testsRun, bare.failures], `with no rule the twin passes, its 20 runs reaching every goal: ${told(bare)}`).toEqual(['passed', RUNS, []]);
    const failed = await runPlaytest(hub, playtest(spikes, play, RULE));
    expect(failed.outcome, `under always: hp >= 0 the twin fails: ${told(failed)}`).toBe('failed');
    expect(alwaysWrong(failed, NEVER_NEGATIVE.name, breaks), `with playtest.always for each run that goes below 0, naming the run, the step, hp -3 and its replay's step: ${told(failed)}`).toEqual([]);
    expect(failed.failures.filter((f) => !f.message.startsWith('playtest.always')).map((f) => f.message), 'and nothing else fails').toEqual([]);
    expect(failed.testsRun, 'its 20 runs are counted').toBe(RUNS);

    const passed = await runPlaytest(hub, playtest(clean, play, RULE));
    expect([passed.outcome, passed.testsRun, passed.failures], `under always: hp >= 0 the fixture passes over 20 runs: ${told(passed)}`).toEqual(['passed', RUNS, []]);
    expect(manifestCodes(), 'the plug-in\'s manifest lists the code').toContain('playtest.always');
  }, LIMIT);

  it(`AC1 ${AC[1]} a replay that never reads below 0 is not reported as failing at the run's step`, async () => {
    const { pool, hub, play } = await stage();
    const spikes = keep('spikes');
    const { breaks } = await twinBreaks(pool, spikes, play);
    const input = playtest(spikes, play, RULE);
    const honest = await runPlaytest(hub, input);
    expect(alwaysWrong(honest, NEVER_NEGATIVE.name, breaks), `the twin fails playtest.always, each failure naming its replay's step: ${told(honest)}`).toEqual([]);
    const held = await runPlaytest(await hubOver(replaysNeverBelow(pool, PATH.hp, 0)), input);
    expect(held.outcome, `a run that fails the rule fails the check, whatever its replay reads: ${told(held)}`).toBe('failed');
    for (const test of breaks.keys()) {
      const said = honest.failures.filter((f) => f.test === test).map((f) => f.message);
      expect(held.failures.filter((f) => f.test === test && said.includes(f.message)).map((f) => f.message), `${test}: of a replay that never reads below 0 the check says nothing it says of one that fails at the run's step`).toEqual([]);
    }
  }, LIMIT);
});
