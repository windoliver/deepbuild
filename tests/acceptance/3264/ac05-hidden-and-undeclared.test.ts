import { describe, expect, it } from 'vitest';
import { AC, LIMIT, entryCheck, keep, lockPlay, orderBreaks, playtestSpec, ranNoStep, readRuns, runPlaytest, stage, told, type Obj } from './helpers.ts';
import { missingWrong, orderWrong } from './judges.ts';
import { EXPLORER, IDLE, KEY_BEFORE_DOOR, MODEL, TIMER_STEP, crawlerPlay, playtest } from './programs.ts';

const FEW = 6;
const SHORT = 40;
const HIDDEN = 'has_key';
const SHOWN = 'door_open';
const UNDECLARED = 'mana';
const ON_UNDECLARED: [string, Obj][] = [
  ['an always rule', { always: [{ name: 'mana_holds', when: `${UNDECLARED} >= 0` }] }],
  ['an order rule', { order: [{ name: 'key_before_spell', first: 'has_key', then: `${UNDECLARED} >= 1` }] }],
];

describe(`AC5 ${AC[5]} a rule may read a hidden name, and one on a name the interface doesn't declare is refused`, () => {
  it(`AC5 ${AC[5]} an order rule on the hidden has_key passes the fixture and fails the timer twin, a model bot's runs too, and no prompt the model gets holds has_key`, async () => {
    const { pool } = await stage();
    const play = await lockPlay(crawlerPlay({ hidden: [HIDDEN] }));
    const clean = keep('clean');
    const timer = keep('timer');
    const asked: Obj[] = [];
    const check = await entryCheck({
      play: pool.direct,
      ask: async (name, request) => { asked.push({ name, ...request }); return { status: 200, body: 'pass' }; },
    });
    const input = (at: string): Obj => playtest(at, play, { bots: [MODEL, EXPLORER], runs: FEW, span: { steps: SHORT }, order: [KEY_BEFORE_DOOR] });
    const still = orderBreaks(await readRuns(pool, timer, play, { bot: IDLE, b: 0, runs: FEW, span: SHORT }));
    const walked = orderBreaks(await readRuns(pool, timer, play, { bot: EXPLORER, b: 1, runs: FEW, span: SHORT }));
    expect([[...still.breaks.values()], still.together, walked.together], `on the twin, as this suite plays it, a unit that never moves sees the door open at step ${TIMER_STEP} with no key, in each run`)
      .toEqual([Array<number>(FEW).fill(TIMER_STEP), [], []]);

    const failed = await check(playtestSpec(input(timer)));
    expect(orderWrong(failed, KEY_BEFORE_DOOR.name, new Map([...still.breaks, ...walked.breaks])), `the rule reads the hidden name: the twin fails playtest.order in each run whose door opens first, the model bot's among them: ${told(failed)}`).toEqual([]);
    const passed = await check(playtestSpec(input(clean)));
    expect([passed.outcome, passed.failures], `and the fixture passes under the same rule: ${told(passed)}`).toEqual(['passed', []]);

    const prompts = asked.map((a) => String(a['prompt']));
    expect(prompts.length, 'the model bot was asked through the plug-in\'s source').toBeGreaterThan(0);
    expect(prompts.filter((p) => p.includes(HIDDEN)).map((p) => p.slice(0, 400)), `no prompt holds ${HIDDEN} or its value`).toEqual([]);
    expect(prompts.filter((p) => !p.includes(SHOWN)).map((p) => p.slice(0, 400)), `while each holds ${SHOWN}, a name the brief doesn't hide`).toEqual([]);
  }, LIMIT);

  it(`AC5 ${AC[5]} a rule on a name the interface doesn't declare fails play.missing, naming it, before any run`, async () => {
    const { pool, hub, play } = await stage();
    const clean = keep('clean');
    for (const [what, rules] of ON_UNDECLARED) {
      const before = pool.log.length;
      const r = await runPlaytest(hub, playtest(clean, play, rules));
      expect(r.outcome, `${what} on ${UNDECLARED} is never passed: ${told(r)}`).not.toBe('passed');
      expect(missingWrong(r, UNDECLARED), `${what} on ${UNDECLARED} fails play.missing, naming it, with no run counted: ${told(r)}`).toEqual([]);
      expect(pool.log.slice(before).filter((p) => !ranNoStep(p)).map((p) => `a play of ${String(p.reply['steps'])} steps`), `and none was played for ${what}`).toEqual([]);
    }
  }, LIMIT);
});
