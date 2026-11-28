import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAYTEST_DIR } from '../556/helpers.ts';
import { OPENED, floorOf, indexOf, lockedFacts, openedFacts, said } from './floors.ts';
import { TIMEOUT, bench, keep, none, publishes, reachSpec, runCheck, skipOf } from './helpers.ts';
import { SKIPPED, floorsTold, onlySkippedWrong, passedWrong, skippedWrong, told } from './judges.ts';
import { RUNS, playtest, reach, type Need } from './programs.ts';

const ID = 'AC1 #3263.07996a8a';
const NEEDS: Need[] = [{ goal: 'exit', through: ['key'] }];

describe(`${ID} a need proves the exit can't be reached without the key, and fails a floor whose opened wall lets a route skip it`, () => {
  it(`${ID} the locked 9 × 9 floor passes its need; its twin with one wall cell beside the door opened passes every other criterion and fails grid.skipped, naming the run, the seed, the exit and a route across the opened cell`, async () => {
    none(lockedFacts(), 'the locked floor, by this suite\'s own search: its exit lies behind a locked door, its key in a side room');
    none(openedFacts(), 'its twin, by this suite\'s own search: one wall cell beside the door is open, and every route that skips the key crosses it');
    const { pool, hub, play } = await bench();
    const locked = keep('locked');
    const opened = keep('opened');
    await publishes(pool, locked, 'locked');
    await publishes(pool, opened, 'opened');

    const kept = await runCheck(hub, reachSpec(reach(NEEDS), playtest(locked, play)));
    expect(passedWrong(kept, RUNS), 'the locked floor passes grid.reach with needs: [{goal: exit, through: [key]}]').toEqual([]);

    const plain = await runCheck(hub, reachSpec(reach(), playtest(opened, play)));
    expect(passedWrong(plain, RUNS), 'the twin passes every other criterion of grid.reach: with no needs it passes').toEqual([]);

    const skipped = await runCheck(hub, reachSpec(reach(NEEDS), playtest(opened, play)));
    expect(skipped.outcome, `the twin fails grid.reach with needs: [{goal: exit, through: [key]}]: ${told(skipped)}; floors: ${floorsTold(skipped)}`).toBe('failed');
    const twin = floorOf('opened');
    const crossing = [{ what: `the opened cell ${said(OPENED)}`, cells: [indexOf(twin, OPENED)] }];
    for (let i = 0; i < RUNS; i++) {
      expect(skippedWrong(skipped, skipOf(i, twin, ['key'], crossing)), `run ${i}'s floor fails ${SKIPPED} once, naming the run, its seed, its depth, the exit and a route across ${said(OPENED)}`).toEqual([]);
    }
    expect(onlySkippedWrong(skipped, RUNS), `and nothing but ${SKIPPED} fails: each floor still has every goal and every open cell reached`).toEqual([]);

    const manifest = JSON.parse(readFileSync(join(PLAYTEST_DIR, 'deepbuild.json'), 'utf8')) as { codes?: string[] };
    expect(manifest.codes, 'the plug-in\'s manifest lists the code among its codes').toContain(SKIPPED);
  }, TIMEOUT);
});
