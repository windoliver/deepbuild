import { describe, expect, it } from 'vitest';
import { AC, LIMIT, keep, manifestCodes, orderBreaks, readRuns, replayed, runPlaytest, stage, told } from './helpers.ts';
import { orderBreak, orderWrong } from './judges.ts';
import { EXPLORER, KEY_BEFORE_DOOR, RUNS, TIMER_STEP, playtest } from './programs.ts';

const RULE = { order: [KEY_BEFORE_DOOR] };

describe(`AC2 ${AC[2]} order: has_key before door_open holds on the crawler and fails its twin whose door also opens on a timer`, () => {
  it(`AC2 ${AC[2]} the twin fails playtest.order, naming the run and the first step door_open is true with has_key still 0; the fixture, whose door uses its key up, passes`, async () => {
    const { pool, hub, play } = await stage();
    const clean = keep('clean');
    const timer = keep('timer');
    const kept = await readRuns(pool, clean, play, { bot: EXPLORER });
    const held = orderBreaks(kept);
    expect([[...held.breaks.keys()], held.together], 'the fixture, as this suite plays its 20 runs: the key is taken at a step before the door opens').toEqual([[], []]);
    expect(kept.filter((r) => !r.door.some((open, k) => open !== 0 && r.key[k] === 0)).map((r) => r.test), 'and the door uses the key up, so has_key reads 0 again while door_open reads 1').toEqual([]);
    const runs = await readRuns(pool, timer, play, { bot: EXPLORER });
    const twin = orderBreaks(runs);
    expect(twin.together, 'the twin: in no run do the key and the door come at one step').toEqual([]);
    expect(twin.breaks.size > 0 && twin.breaks.size < RUNS, `its door opens before the key is taken in some runs and not in all: ${[...twin.breaks.keys()].join(', ')}`).toBe(true);
    expect([...new Set(twin.breaks.values())], `each of them at step ${TIMER_STEP}, its timer's`).toEqual([TIMER_STEP]);
    for (const r of runs.filter((x) => twin.breaks.has(x.test))) {
      const again = await replayed(pool, timer, r);
      expect(orderBreak(again.key, again.door), `${r.test}: its track played again without its bot opens the door first at step ${TIMER_STEP} too`).toEqual({ step: TIMER_STEP });
    }

    const failed = await runPlaytest(hub, playtest(timer, play, RULE));
    expect(failed.outcome, `under order: has_key then door_open the twin fails: ${told(failed)}`).toBe('failed');
    expect(orderWrong(failed, KEY_BEFORE_DOOR.name, twin.breaks), `with playtest.order for each run whose door opens first, naming the run, that step and its replay's step: ${told(failed)}`).toEqual([]);
    expect(failed.failures.filter((f) => !f.message.startsWith('playtest.order')).map((f) => f.message), 'and nothing else fails').toEqual([]);
    expect(failed.testsRun, 'its 20 runs are counted').toBe(RUNS);

    const passed = await runPlaytest(hub, playtest(clean, play, RULE));
    expect([passed.outcome, passed.testsRun, passed.failures], `under the same rule the fixture passes over 20 runs: ${told(passed)}`).toEqual(['passed', RUNS, []]);
    expect(manifestCodes(), 'the plug-in\'s manifest lists the code').toContain('playtest.order');
  }, LIMIT);
});
