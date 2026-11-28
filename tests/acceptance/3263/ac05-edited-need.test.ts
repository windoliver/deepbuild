import { describe, expect, it } from 'vitest';
import { EXIT, OPENED, START, floorOf, indexOf, needFact, openedFacts } from './floors.ts';
import { TIMEOUT, bench, keep, none, publishes, reachSpec, runCheck } from './helpers.ts';
import { passedWrong, refusedWrong, told } from './judges.ts';
import { RUNS, playtest, reach, type Need } from './programs.ts';

const ID = 'AC5 #3263.a31661e1';
const EDITED: Need = { goal: 'exit', through: ['key', OPENED] };
const BY_AGENT: Need = { ...EDITED, by: 'agent' };

describe(`${ID} a need the working agent's session edited is no need of the brief's`, () => {
  it(`${ID} a run whose need the working agent's session edited is refused, naming the need, where the same need from the definition passes`, async () => {
    none(openedFacts(), 'the twin with one wall cell opened, by this suite\'s own search');
    const twin = floorOf('opened');
    const fact = needFact(twin, [indexOf(twin, START)], [indexOf(twin, EXIT)], EDITED.through);
    expect(fact, 'the edit closes the opened cell beside the key: with both closed the exit is unreached, so a check that takes the edited need as the brief\'s passes the twin').toEqual({ goal: true, through: 2, closedGoal: false });
    const { pool, hub, play } = await bench();
    const opened = keep('opened');
    await publishes(pool, opened, 'opened');

    const defined = await runCheck(hub, reachSpec(reach([EDITED]), playtest(opened, play)));
    expect(passedWrong(defined, RUNS), 'the need as a definition gives it passes the twin').toEqual([]);

    const edited = await runCheck(hub, reachSpec(reach([BY_AGENT]), playtest(opened, play)));
    expect(edited.outcome, `the run whose need the working agent's session edited (by: agent) is refused, never passed: ${told(edited)}`).not.toBe('passed');
    expect(refusedWrong(edited, { goal: 'exit', through: ['key'] }), 'a failure says the run is refused and names the edited need by its goal and the class of its through').toEqual([]);
  }, TIMEOUT);
});
