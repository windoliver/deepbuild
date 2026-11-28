import { describe, expect, it } from 'vitest';
import { AC, LIMIT, judge, keep, kitFills, playFill, readRuns, runPlaytest, stage, told, type Obj, type Pool } from './helpers.ts';
import { unseenWrong } from './judges.ts';
import { IDLE, KEY_BEFORE_DOOR, RUNS, SLOW_EXPLORER, playtest } from './programs.ts';

const SHORT = 20;
const ALIVE = { name: 'alive', when: 'hp >= 1', each: true };
const INPUT = { bots: [IDLE, SLOW_EXPLORER], span: { steps: SHORT }, goals: [ALIVE], order: [KEY_BEFORE_DOOR] };

async function doorStaysShut(pool: Pool, at: string, play: Obj): Promise<void> {
  const idle = await readRuns(pool, at, play, { bot: IDLE, b: 0, span: SHORT });
  const slow = await readRuns(pool, at, play, { bot: SLOW_EXPLORER, b: 1, span: SHORT });
  expect([...idle, ...slow].filter((r) => r.door.some((v) => v !== 0)).map((r) => r.test), 'as this suite plays them, no run of the idle policy or of the slow explorer opens the door').toEqual([]);
  expect(slow.some((r) => r.key.some((v) => v !== 0)), 'and the slow explorer takes the key in a run that starts near it').toBe(true);
  expect([...idle, ...slow].filter((r) => r.hp[0]! < 1).map((r) => r.test), 'every run starts with a hit point, so each reaches the goal alive at step 0').toEqual([]);
}

describe(`AC4 ${AC[4]} a rule proves nothing on steps that never happened`, () => {
  it(`AC4 ${AC[4]} with bots that never open the door, the order rule reads INCONCLUSIVE, naming it, never PASS`, async () => {
    const { pool, hub, play } = await stage();
    const clean = keep('clean');
    await doorStaysShut(pool, clean, play);
    const r = await runPlaytest(hub, playtest(clean, play, INPUT));
    expect(unseenWrong(r, KEY_BEFORE_DOOR.name), `door_open is true in no run, so the check reads INCONCLUSIVE (uncounted), naming ${KEY_BEFORE_DOOR.name}, and reports nothing else: ${told(r)}`).toEqual([]);
    expect(r.testsRun, 'both bots\' 20 runs are counted').toBe(2 * RUNS);
    const v = judge(r, 'definition');
    expect([v.outcome, v.requirements[0]?.outcome], `the verdict on a requirement it covers is never PASS: ${JSON.stringify(v.reasons).slice(0, 600)}`).not.toContain('PASS');
  }, LIMIT);

  it(`AC4 ${AC[4]} a planted check that passes a rule whose then never happened fails this test`, async () => {
    const { pool, play } = await stage();
    const clean = keep('clean');
    await doorStaysShut(pool, clean, play);
    const fills = await kitFills(pool);
    const planted = fills.planted('unseen-then-passes');
    const input = playtest(clean, play, INPUT);
    const wrong = await playFill(planted, input);
    expect([wrong.outcome, wrong.failures], `the planted check passes the rule: ${told(wrong)}`).toEqual(['passed', []]);
    expect(unseenWrong(wrong, KEY_BEFORE_DOOR.name), 'and so fails this test').not.toEqual([]);
    const right = await playFill(fills.clean, input);
    expect(unseenWrong(right, KEY_BEFORE_DOOR.name), `the kit's own check reads INCONCLUSIVE on the same input: ${told(right)}`).toEqual([]);
  }, LIMIT);
});
