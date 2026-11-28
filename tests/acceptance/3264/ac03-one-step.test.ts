import { describe, expect, it } from 'vitest';
import { AC, LIMIT, keep, kitFills, playFill, readRuns, runPlaytest, stage, told, type Obj, type Pool } from './helpers.ts';
import { alwaysWrong, type Break } from './judges.ts';
import { BLIP_STEP, EXPLORER, NEVER_NEGATIVE, playtest } from './programs.ts';

const FEW = 3;
const LONG = 900;
const INPUT = { always: [NEVER_NEGATIVE], runs: FEW, span: { steps: LONG } };

async function oneStepBreaks(pool: Pool, at: string, play: Obj): Promise<Map<string, Break>> {
  const runs = await readRuns(pool, at, play, { bot: EXPLORER, runs: FEW, span: LONG });
  for (const r of runs) {
    expect(r.hp.slice(BLIP_STEP - 1, BLIP_STEP + 2), `${r.test}, as this suite plays it: hp reads 4, -1 and 4 at steps ${BLIP_STEP - 1} to ${BLIP_STEP + 1}`).toEqual([4, -1, 4]);
    expect(r.hp.filter((v) => v < 0).length, `${r.test}: and below 0 at no other step`).toBe(1);
    const goals = [r.door.findIndex((v) => v !== 0), r.won.findIndex((v) => v !== 0)];
    expect(goals.every((step) => step >= 0 && step < BLIP_STEP - 1), `${r.test}: it reaches each goal before step ${BLIP_STEP - 1}, at steps ${goals.join(' and ')}`).toBe(true);
  }
  return new Map(runs.map((r) => [r.test, { step: BLIP_STEP, values: { hp: -1 } }]));
}

describe(`AC3 ${AC[3]} a fault that lasts one step is found`, () => {
  it(`AC3 ${AC[3]} the twin whose hp reads -1 at step 811 alone, with 4 on either side, fails always: hp >= 0 at step 811`, async () => {
    const { pool, hub, play } = await stage();
    const blip = keep('blip');
    const breaks = await oneStepBreaks(pool, blip, play);
    const failed = await runPlaytest(hub, playtest(blip, play, INPUT));
    expect(failed.outcome, `the twin fails: ${told(failed)}`).toBe('failed');
    expect(alwaysWrong(failed, NEVER_NEGATIVE.name, breaks), `with playtest.always for each run, naming step ${BLIP_STEP} and hp -1: ${told(failed)}`).toEqual([]);
    expect(failed.failures.filter((f) => !f.message.startsWith('playtest.always')).map((f) => f.message), 'and nothing else fails').toEqual([]);
  }, LIMIT);

  it(`AC3 ${AC[3]} a planted check that reads only the steps where a goal is judged passes the twin, and fails this test`, async () => {
    const { pool, play } = await stage();
    const blip = keep('blip');
    const breaks = await oneStepBreaks(pool, blip, play);
    const fills = await kitFills(pool);
    const planted = fills.planted('goal-steps-only');
    const input = playtest(blip, play, INPUT);
    const wrong = await playFill(planted, input);
    expect([wrong.outcome, wrong.failures], `the planted check passes the twin: ${told(wrong)}`).toEqual(['passed', []]);
    expect(alwaysWrong(wrong, NEVER_NEGATIVE.name, breaks), 'and so fails this test').not.toEqual([]);
    const right = await playFill(fills.clean, input);
    expect(alwaysWrong(right, NEVER_NEGATIVE.name, breaks), `the kit's own check fails the twin at step ${BLIP_STEP}, on the same input: ${told(right)}`).toEqual([]);
  }, LIMIT);
});
