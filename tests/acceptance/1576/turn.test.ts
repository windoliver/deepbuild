// #1576's turn budget (README): the frames and bytes a session's page gets for one recorded turn, played on a real hub
// as its deep-hook would send it, held to the ceiling recorded in benchmarks/budgets.json (AC3); and AC3's planted
// wrong program (README, Wrong programs). Every number here is a count of frames or bytes, never a time.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { ceilings, cleanup, judgeTurn, onRecord, PAGE_HOOK, PLANT, playTurn, started, stopHubs } from './helpers.ts';

afterEach(stopHubs, 120_000);
afterAll(cleanup, 120_000);

describe('AC3 #1576.054c1375 a turn\'s frames and bytes on a recorded fixture stay at the ceiling', () => {
  it('AC3 #1576.054c1375 the recorded turn of fixtures/turn.jsonl sends the session\'s page no more frames and bytes than the ceiling in benchmarks/budgets.json', async () => {
    const hub = started(await onRecord(undefined));
    expect(judgeTurn(await playTurn(hub), ceilings())).toBeNull();
  }, 1_800_000);

  it(`AC3 #1576.054c1375 (wrong program) the planted ${PLANT.pageFrame} fails it, naming the kind ${PAGE_HOOK}`, async () => {
    const r = await onRecord(undefined, PLANT.pageFrame);
    expect(r.refused ?? null, `the planted wrong program ${PLANT.pageFrame} runs`).toBeNull();
    expect(judgeTurn(await playTurn(r.hub!), ceilings())).toMatch(new RegExp(`: the most frames were of kind ${PAGE_HOOK.replace('.', '\\.')} \\(`));
  }, 1_800_000);
});
